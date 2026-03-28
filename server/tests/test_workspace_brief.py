"""Tests for workspace brief generation pipeline."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from server.document_registry import DocumentRegistry
from server.migrations.jsonl_to_sqlite import create_inbox_workspace, create_schema
from server.pipelines.workspace_brief import (
    WorkspaceBriefPipeline,
    _aggregate_entities,
    _build_brief_context,
    _collect_topics,
)
from server.schemas import (
    DocumentClassification,
    ExtractedEntity,
    UiDocumentRecord,
)
from server.workspace_registry import WorkspaceRegistry


def _setup(tmp_path: Path) -> tuple[DocumentRegistry, WorkspaceRegistry]:
    db_path = tmp_path / "test.db"
    doc_reg = DocumentRegistry(db_path=db_path)
    create_schema(doc_reg.conn)
    create_inbox_workspace(doc_reg.conn)
    ws_reg = WorkspaceRegistry(conn=doc_reg.conn)
    return doc_reg, ws_reg


def _sample_doc(
    record_id: str,
    *,
    title: str = "Test Doc",
    summary: str = "A test document",
    document_type: str = "receipt",
    tags: list[str] | None = None,
) -> UiDocumentRecord:
    return UiDocumentRecord(
        id=record_id,
        request_id=f"req-{record_id}",
        title=title,
        summary=summary,
        mime_type="application/pdf",
        source_modality="text",
        kind="receipt",
        document_type=document_type,
        template=document_type,
        created_at="2025-01-01T00:00:00+00:00",
        updated_at="2025-01-01T00:00:00+00:00",
        classification=DocumentClassification(
            document_type=document_type,
            template=document_type,
            title=title,
            summary=summary,
            tags=tags or ["test"],
            language="sv",
            confidence=0.9,
        ),
    )


# ------------------------------------------------------------------
# Topic collection
# ------------------------------------------------------------------

class TestCollectTopics:
    def test_collects_and_deduplicates(self) -> None:
        docs = [
            _sample_doc("d1", tags=["kvitto", "mat"]),
            _sample_doc("d2", tags=["Kvitto", "transport"]),
        ]
        topics = _collect_topics(docs)
        assert "kvitto" in topics or "Kvitto" in topics
        assert len([t for t in topics if t.lower() == "kvitto"]) == 1

    def test_orders_by_frequency(self) -> None:
        docs = [
            _sample_doc("d1", tags=["kvitto", "mat"]),
            _sample_doc("d2", tags=["mat", "transport"]),
            _sample_doc("d3", tags=["mat", "kvitto"]),
        ]
        topics = _collect_topics(docs)
        assert topics[0].lower() == "mat"  # most frequent (3 occurrences)

    def test_empty_docs(self) -> None:
        assert _collect_topics([]) == []


# ------------------------------------------------------------------
# Entity aggregation
# ------------------------------------------------------------------

class TestAggregateEntities:
    def test_aggregates_across_documents(self, tmp_path: Path) -> None:
        doc_reg, _ = _setup(tmp_path)
        doc_reg.upsert_document(_sample_doc("d1"))
        doc_reg.upsert_document(_sample_doc("d2"))

        doc_reg.upsert_entities(
            file_id="d1",
            entities=[ExtractedEntity(name="IKEA", entity_type="company", context="IKEA kvitto")],
        )
        doc_reg.upsert_entities(
            file_id="d2",
            entities=[ExtractedEntity(name="IKEA", entity_type="company", context="Köp på IKEA Kungens Kurva")],
        )

        docs = [_sample_doc("d1"), _sample_doc("d2")]
        aggregated = _aggregate_entities(doc_reg, docs)

        assert len(aggregated) == 1
        assert aggregated[0]["name"] == "IKEA"
        # Should keep longer context
        assert "Kungens Kurva" in aggregated[0]["context"]

    def test_sorts_people_first(self, tmp_path: Path) -> None:
        doc_reg, _ = _setup(tmp_path)
        doc_reg.upsert_document(_sample_doc("d1"))

        doc_reg.upsert_entities(
            file_id="d1",
            entities=[
                ExtractedEntity(name="Stockholm", entity_type="place", context="i Stockholm"),
                ExtractedEntity(name="Anders", entity_type="person", context="Anders sa"),
                ExtractedEntity(name="Nordea", entity_type="company", context="via Nordea"),
            ],
        )

        docs = [_sample_doc("d1")]
        aggregated = _aggregate_entities(doc_reg, docs)

        types_in_order = [e["entity_type"] for e in aggregated]
        assert types_in_order == ["person", "company", "place"]


# ------------------------------------------------------------------
# Brief context building
# ------------------------------------------------------------------

class TestBuildBriefContext:
    def test_includes_files_and_entities(self) -> None:
        docs = [_sample_doc("d1", title="Kvitto IKEA", summary="Matinköp")]
        entities = [{"name": "IKEA", "entity_type": "company", "context": "IKEA kvitto"}]

        context = _build_brief_context(docs, entities)

        assert "FILER" in context
        assert "Kvitto IKEA" in context
        assert "ENTITETER" in context
        assert "IKEA" in context
        assert "STATISTIK" in context


# ------------------------------------------------------------------
# Full pipeline with mocked LLM
# ------------------------------------------------------------------

class TestWorkspaceBriefPipeline:
    @pytest.mark.asyncio()
    async def test_generates_and_persists_brief(self, tmp_path: Path) -> None:
        doc_reg, ws_reg = _setup(tmp_path)
        ws = ws_reg.create_workspace(name="Testprojekt")

        # Add a document to the workspace
        doc_reg.upsert_document(_sample_doc("d1", title="Köpeavtal", tags=["avtal", "bostad"]))
        ws_reg.move_files_to_workspace(file_ids=["d1"], workspace_id=ws.id)
        doc_reg.upsert_entities(
            file_id="d1",
            entities=[ExtractedEntity(name="Nordea", entity_type="company", context="via Nordea")],
        )

        mock_client = AsyncMock()
        mock_client.chat_text = AsyncMock(return_value="Ett projekt om bostadsköp med Nordea.")

        pipeline = WorkspaceBriefPipeline(
            ollama_client=mock_client,
            system_prompt="test prompt",
            document_registry=doc_reg,
            workspace_registry=ws_reg,
        )

        result = await pipeline.generate(workspace_id=ws.id)

        assert result["ai_brief"] == "Ett projekt om bostadsköp med Nordea."
        assert any(e["name"] == "Nordea" for e in result["ai_entities"])
        assert "avtal" in result["ai_topics"] or "bostad" in result["ai_topics"]

        # Verify persisted
        updated = ws_reg.get_workspace(workspace_id=ws.id)
        assert updated is not None
        assert updated.ai_brief == "Ett projekt om bostadsköp med Nordea."

    @pytest.mark.asyncio()
    async def test_empty_workspace_produces_empty_brief(self, tmp_path: Path) -> None:
        doc_reg, ws_reg = _setup(tmp_path)
        ws = ws_reg.create_workspace(name="Tom workspace")

        mock_client = AsyncMock()

        pipeline = WorkspaceBriefPipeline(
            ollama_client=mock_client,
            system_prompt="test prompt",
            document_registry=doc_reg,
            workspace_registry=ws_reg,
        )

        result = await pipeline.generate(workspace_id=ws.id)

        assert result["ai_brief"] == ""
        assert result["ai_entities"] == []
        assert result["ai_topics"] == []
        mock_client.chat_text.assert_not_called()

    @pytest.mark.asyncio()
    async def test_llm_failure_degrades_gracefully(self, tmp_path: Path) -> None:
        doc_reg, ws_reg = _setup(tmp_path)
        ws = ws_reg.create_workspace(name="Fail test")

        doc_reg.upsert_document(_sample_doc("d1", tags=["test"]))
        ws_reg.move_files_to_workspace(file_ids=["d1"], workspace_id=ws.id)

        mock_client = AsyncMock()
        mock_client.chat_text = AsyncMock(side_effect=RuntimeError("LLM down"))

        pipeline = WorkspaceBriefPipeline(
            ollama_client=mock_client,
            system_prompt="test prompt",
            document_registry=doc_reg,
            workspace_registry=ws_reg,
        )

        result = await pipeline.generate(workspace_id=ws.id)

        # Brief empty but entities/topics still populated
        assert result["ai_brief"] == ""
        assert "test" in result["ai_topics"]

    @pytest.mark.asyncio()
    async def test_unknown_workspace_raises(self, tmp_path: Path) -> None:
        doc_reg, ws_reg = _setup(tmp_path)
        mock_client = AsyncMock()

        pipeline = WorkspaceBriefPipeline(
            ollama_client=mock_client,
            system_prompt="test prompt",
            document_registry=doc_reg,
            workspace_registry=ws_reg,
        )

        with pytest.raises(KeyError, match="unknown_workspace_id"):
            await pipeline.generate(workspace_id="nonexistent")
