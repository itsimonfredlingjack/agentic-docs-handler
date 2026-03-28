"""Tests for entity extraction pipeline: parser, normalization, persistence, and integration."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from server.document_registry import DocumentRegistry
from server.migrations.jsonl_to_sqlite import create_inbox_workspace, create_schema
from server.pipelines.entity_extractor import (
    EntityExtractionError,
    EntityExtractor,
    _normalize_and_deduplicate,
    _normalize_name,
)
from server.schemas import (
    DocumentClassification,
    EntityExtractionResult,
    ExtractedEntity,
    UiDocumentRecord,
)


# ------------------------------------------------------------------
# Normalization and deduplication
# ------------------------------------------------------------------

class TestNormalizeName:
    def test_strips_whitespace(self) -> None:
        assert _normalize_name("  Anders Johansson  ") == "Anders Johansson"

    def test_collapses_internal_spaces(self) -> None:
        assert _normalize_name("Anders   Johansson") == "Anders Johansson"

    def test_handles_empty_string(self) -> None:
        assert _normalize_name("") == ""


class TestNormalizeAndDeduplicate:
    def test_deduplicates_by_name_and_type(self) -> None:
        result = EntityExtractionResult(entities=[
            ExtractedEntity(name="IKEA", entity_type="company", context="Köpt på IKEA"),
            ExtractedEntity(name="ikea", entity_type="company", context="IKEA kvitto"),
        ])
        deduped = _normalize_and_deduplicate(result)
        assert len(deduped.entities) == 1
        assert deduped.entities[0].name == "IKEA"

    def test_keeps_longer_context(self) -> None:
        result = EntityExtractionResult(entities=[
            ExtractedEntity(name="Nordea", entity_type="company", context="kort"),
            ExtractedEntity(name="Nordea", entity_type="company", context="Handpenning via Nordea den 12 feb"),
        ])
        deduped = _normalize_and_deduplicate(result)
        assert "Handpenning" in deduped.entities[0].context

    def test_keeps_longer_name_variant(self) -> None:
        result = EntityExtractionResult(entities=[
            ExtractedEntity(name="A. Johansson", entity_type="person", context="ctx1"),
            ExtractedEntity(name="a. johansson", entity_type="person", context="ctx2 longer context here"),
        ])
        deduped = _normalize_and_deduplicate(result)
        assert len(deduped.entities) == 1
        assert deduped.entities[0].name == "A. Johansson"

    def test_different_types_not_deduped(self) -> None:
        result = EntityExtractionResult(entities=[
            ExtractedEntity(name="Stockholm", entity_type="place", context="i Stockholm"),
            ExtractedEntity(name="Stockholm", entity_type="company", context="Stockholm AB"),
        ])
        deduped = _normalize_and_deduplicate(result)
        assert len(deduped.entities) == 2

    def test_filters_short_names(self) -> None:
        result = EntityExtractionResult(entities=[
            ExtractedEntity(name="A", entity_type="person", context="short"),
            ExtractedEntity(name="AB", entity_type="company", context="ok"),
        ])
        deduped = _normalize_and_deduplicate(result)
        assert len(deduped.entities) == 1
        assert deduped.entities[0].name == "AB"

    def test_caps_at_30(self) -> None:
        entities = [
            ExtractedEntity(name=f"Entity {i}", entity_type="topic", context=f"ctx {i}")
            for i in range(40)
        ]
        result = EntityExtractionResult(entities=entities)
        deduped = _normalize_and_deduplicate(result)
        assert len(deduped.entities) == 30


# ------------------------------------------------------------------
# EntityExtractor with mocked LLM
# ------------------------------------------------------------------

class TestEntityExtractor:
    @pytest.fixture()
    def extractor(self) -> EntityExtractor:
        mock_client = AsyncMock()
        return EntityExtractor(
            ollama_client=mock_client,
            system_prompt="test prompt",
            temperature=0.1,
        )

    @pytest.mark.asyncio()
    async def test_valid_json_returns_result(self, extractor: EntityExtractor) -> None:
        response_json = json.dumps({
            "entities": [
                {"name": "Anders Johansson", "entity_type": "person", "context": "Anders Johansson undertecknade"},
                {"name": "IKEA", "entity_type": "company", "context": "Kvitto från IKEA"},
                {"name": "2025-03-15", "entity_type": "date", "context": "Daterat 2025-03-15"},
            ]
        })
        extractor.ollama_client.chat_json_with_meta = AsyncMock(return_value={
            "content": response_json,
            "prompt_payload": {},
            "latency_ms": 100,
            "prompt_name": "entity_extraction",
            "input_modality": "text",
            "request_id": "req-1",
        })

        result = await extractor.extract(text="Kvitto från IKEA, Anders Johansson 2025-03-15", request_id="req-1")

        assert len(result.entities) == 3
        assert result.entities[0].name == "Anders Johansson"
        assert result.entities[0].entity_type == "person"

    @pytest.mark.asyncio()
    async def test_empty_text_returns_empty(self, extractor: EntityExtractor) -> None:
        result = await extractor.extract(text="", request_id="req-1")
        assert result.entities == []

    @pytest.mark.asyncio()
    async def test_invalid_json_raises(self, extractor: EntityExtractor) -> None:
        extractor.ollama_client.chat_json_with_meta = AsyncMock(return_value={
            "content": "not json at all",
            "prompt_payload": {},
            "latency_ms": 100,
            "prompt_name": "entity_extraction",
            "input_modality": "text",
            "request_id": "req-1",
        })

        with pytest.raises(EntityExtractionError):
            await extractor.extract(text="some text", request_id="req-1")

    @pytest.mark.asyncio()
    async def test_prose_wrapped_json_still_parses(self, extractor: EntityExtractor) -> None:
        """LLM sometimes wraps JSON in prose text."""
        response = 'Here are the entities:\n\n{"entities": [{"name": "Nordea", "entity_type": "company", "context": "via Nordea"}]}\n\nHope that helps!'
        extractor.ollama_client.chat_json_with_meta = AsyncMock(return_value={
            "content": response,
            "prompt_payload": {},
            "latency_ms": 100,
            "prompt_name": "entity_extraction",
            "input_modality": "text",
            "request_id": "req-1",
        })

        result = await extractor.extract(text="handpenning via Nordea", request_id="req-1")
        assert len(result.entities) == 1
        assert result.entities[0].name == "Nordea"


# ------------------------------------------------------------------
# Persistence (DocumentRegistry entity methods)
# ------------------------------------------------------------------

def _make_registry(tmp_path: Path) -> DocumentRegistry:
    db_path = tmp_path / "test.db"
    registry = DocumentRegistry(db_path=db_path)
    create_schema(registry.conn)
    create_inbox_workspace(registry.conn)
    return registry


def _sample_doc(record_id: str = "doc-1") -> UiDocumentRecord:
    return UiDocumentRecord(
        id=record_id,
        request_id=f"req-{record_id}",
        title="Test Doc",
        summary="Summary",
        mime_type="application/pdf",
        source_modality="text",
        kind="receipt",
        document_type="receipt",
        template="receipt",
        created_at="2025-01-01T00:00:00+00:00",
        updated_at="2025-01-01T00:00:00+00:00",
        classification=DocumentClassification(
            document_type="receipt", template="receipt",
            title="Test Doc", summary="Summary",
            tags=[], language="sv", confidence=0.9,
        ),
    )


class TestEntityPersistence:
    def test_upsert_and_retrieve(self, tmp_path: Path) -> None:
        registry = _make_registry(tmp_path)
        registry.upsert_document(_sample_doc("doc-1"))

        entities = [
            ExtractedEntity(name="IKEA", entity_type="company", context="Köpt på IKEA"),
            ExtractedEntity(name="Anders Johansson", entity_type="person", context="Av Anders Johansson"),
        ]
        count = registry.upsert_entities(file_id="doc-1", entities=entities)
        assert count == 2

        stored = registry.get_entities_for_document(record_id="doc-1")
        assert len(stored) == 2
        names = {e["name"] for e in stored}
        assert "IKEA" in names
        assert "Anders Johansson" in names

    def test_entity_dedup_across_documents(self, tmp_path: Path) -> None:
        registry = _make_registry(tmp_path)
        registry.upsert_document(_sample_doc("doc-1"))
        registry.upsert_document(_sample_doc("doc-2"))

        entities = [ExtractedEntity(name="Nordea", entity_type="company", context="via Nordea")]
        registry.upsert_entities(file_id="doc-1", entities=entities)
        registry.upsert_entities(file_id="doc-2", entities=entities)

        # Only one entity row should exist
        entity_count = registry.conn.execute("SELECT COUNT(*) FROM entity").fetchone()[0]
        assert entity_count == 1

        # But two file_entity links
        link_count = registry.conn.execute("SELECT COUNT(*) FROM file_entity").fetchone()[0]
        assert link_count == 2

    def test_empty_entities_returns_zero(self, tmp_path: Path) -> None:
        registry = _make_registry(tmp_path)
        assert registry.upsert_entities(file_id="doc-1", entities=[]) == 0

    def test_get_entities_for_nonexistent_doc(self, tmp_path: Path) -> None:
        registry = _make_registry(tmp_path)
        assert registry.get_entities_for_document(record_id="nonexistent") == []

    def test_context_updates_on_re_extraction(self, tmp_path: Path) -> None:
        """Re-extracting entities for the same doc should update context."""
        registry = _make_registry(tmp_path)
        registry.upsert_document(_sample_doc("doc-1"))

        registry.upsert_entities(
            file_id="doc-1",
            entities=[ExtractedEntity(name="IKEA", entity_type="company", context="old context")],
        )
        registry.upsert_entities(
            file_id="doc-1",
            entities=[ExtractedEntity(name="IKEA", entity_type="company", context="new updated context")],
        )

        stored = registry.get_entities_for_document(record_id="doc-1")
        assert len(stored) == 1
        assert stored[0]["context"] == "new updated context"
