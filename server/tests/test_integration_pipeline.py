"""Critical-path integration test.

Exercises the full connected pipeline:
  ingest → classify → extract → entity extract → workspace suggest → persist → index

Uses controlled fakes for LLM components but a real DocumentRegistry and
real workspace to verify the orchestration glue.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from server.document_registry import DocumentRegistry
from server.migrations.migrate import ensure_schema
from server.migrations.jsonl_to_sqlite import create_inbox_workspace
from server.pipelines.process_pipeline import DocumentProcessPipeline
from server.schemas import (
    DocumentClassification,
    EntityExtractionResult,
    ExtractedEntity,
    ExtractionResult,
    MovePlan,
)
from server.workspace_registry import WorkspaceRegistry


# -- Controlled fakes -------------------------------------------------------

class FakeClassifier:
    def __init__(self) -> None:
        self.call_count = 0

    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        self.call_count += 1
        return DocumentClassification(
            document_type="invoice",
            template="invoice",
            title="Faktura FV-2025-0047",
            summary="Konsultfaktura från Konsultbolaget AB",
            tags=["faktura", "konsult"],
            language="sv",
            confidence=0.92,
        )

    async def classify_image(self, image_bytes: bytes, mime_type: str, request_id: str) -> DocumentClassification:
        raise AssertionError("image path not expected")


class FakeExtractor:
    def __init__(self) -> None:
        self.call_count = 0

    async def extract(
        self, text: str, classification: DocumentClassification, request_id: str,
    ) -> ExtractionResult:
        self.call_count += 1
        return ExtractionResult(
            fields={
                "invoice_number": "FV-2025-0047",
                "amount": "59 187,50 kr",
                "due_date": "2025-03-31",
                "sender": "Konsultbolaget AB",
                "recipient": "Acme Sverige AB",
            },
            field_confidence={
                "invoice_number": 0.95,
                "amount": 0.95,
                "due_date": 0.95,
                "sender": 0.90,
                "recipient": 0.85,
            },
            missing_fields=[],
        )


class FakeEntityExtractor:
    def __init__(self) -> None:
        self.call_count = 0

    async def extract(self, *, text: str, request_id: str) -> EntityExtractionResult:
        self.call_count += 1
        return EntityExtractionResult(entities=[
            ExtractedEntity(name="Konsultbolaget AB", entity_type="company", context="Från: Konsultbolaget AB"),
            ExtractedEntity(name="Acme Sverige AB", entity_type="company", context="Till: Acme Sverige AB"),
            ExtractedEntity(name="59 187,50 kr", entity_type="amount", context="Att betala: 59 187,50 kr"),
            ExtractedEntity(name="2025-03-31", entity_type="date", context="Förfaller: 2025-03-31"),
        ])


class FakeWorkspaceSuggester:
    def __init__(self, *, target_workspace_name: str, confidence: float = 0.85) -> None:
        self._target = target_workspace_name
        self._confidence = confidence
        self.call_count = 0

    async def suggest(
        self,
        *,
        title: str,
        summary: str,
        document_type: str,
        entities: list[object],
        workspaces: list[object],
        request_id: str,
    ) -> object:
        from server.pipelines.workspace_suggester import SuggestionResult

        self.call_count += 1
        # Find the workspace ID from the provided list (workspaces are dicts from pipeline)
        workspace_id = None
        for ws in workspaces:
            name = ws.get("name") if isinstance(ws, dict) else getattr(ws, "name", None)
            ws_id = ws.get("id") if isinstance(ws, dict) else getattr(ws, "id", None)
            if name == self._target:
                workspace_id = ws_id
                break
        return SuggestionResult(
            workspace_id=workspace_id,
            workspace_name=self._target,
            confidence=self._confidence,
            reason="Entity overlap: Konsultbolaget AB",
            auto_assigned=self._confidence >= 0.8,
        )


class FakeOrganizer:
    def plan_move(self, filename: str, classification: DocumentClassification) -> MovePlan:
        return MovePlan(reason="workspace_pending")


class FakeRealtimeManager:
    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []

    async def emit_to_client(self, client_id: str, event: dict[str, object]) -> None:
        self.events.append(event)


class FakeSearchPipeline:
    def __init__(self) -> None:
        self.documents: list[object] = []

    def upsert_document(self, document: object) -> None:
        self.documents.append(document)


# -- The test ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_full_pipeline_classify_extract_entity_suggest_persist_index(tmp_path: Path) -> None:
    """Verify the full connected orchestration from ingest to index."""
    db_path = tmp_path / "integration.db"
    registry = DocumentRegistry(db_path=db_path)
    ensure_schema(registry.conn)
    create_inbox_workspace(registry.conn)

    workspace_registry = WorkspaceRegistry(conn=registry.conn)
    target_ws = workspace_registry.create_workspace(
        name="Konsultfakturor",
        description="Fakturor från konsulter",
    )

    classifier = FakeClassifier()
    extractor = FakeExtractor()
    entity_extractor = FakeEntityExtractor()
    suggester = FakeWorkspaceSuggester(target_workspace_name="Konsultfakturor")
    realtime = FakeRealtimeManager()
    search = FakeSearchPipeline()

    pipeline = DocumentProcessPipeline(
        classifier=classifier,
        extractor=extractor,
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=realtime,
        search_pipeline=search,
        entity_extractor=entity_extractor,
        workspace_suggester=suggester,
        workspace_registry=workspace_registry,
    )

    document_text = (
        "Faktura\nFakturanr: FV-2025-0047\nDatum: 2025-03-01\nFörfaller: 2025-03-31\n"
        "Från: Konsultbolaget AB\nTill: Acme Sverige AB\n"
        "Konsulttjänster februari 2025: 45 000,00 kr\nResekostnader: 2 350,00 kr\n"
        "Att betala: 59 187,50 kr"
    )

    response = await pipeline.process_upload(
        filename="faktura-fv-2025-0047.txt",
        content=document_text.encode("utf-8"),
        content_type="text/plain",
        execute_move=False,
        source_path=None,
        client_id="test-client",
    )

    # Wait for background indexing task to finish
    await asyncio.sleep(0.1)

    # ── Verify classification ──
    assert response.classification.document_type == "invoice"
    assert response.classification.confidence == 0.92
    assert classifier.call_count == 1

    # ── Verify extraction ──
    assert response.extraction is not None
    assert response.extraction.fields["invoice_number"] == "FV-2025-0047"
    assert response.extraction.fields["amount"] == "59 187,50 kr"
    assert extractor.call_count == 1

    # ── Verify entity extraction was invoked ──
    assert entity_extractor.call_count == 1

    # ── Verify entities persisted in database ──
    entities = registry.get_entities_for_document(record_id=response.record_id)
    entity_names = {e["name"] for e in entities}
    assert "Konsultbolaget AB" in entity_names
    assert "Acme Sverige AB" in entity_names

    # ── Verify workspace suggestion was invoked ──
    assert suggester.call_count == 1

    # ── Verify document was auto-assigned to the target workspace ──
    persisted = registry.get_document(record_id=response.record_id)
    assert persisted is not None
    assert persisted.workspace_id == target_ws.id

    # ── Verify document was sent to search pipeline for indexing ──
    assert len(search.documents) == 1
    indexed = search.documents[0]
    assert indexed.doc_id == response.record_id
    assert indexed.title == "Faktura FV-2025-0047"

    # ── Verify WebSocket events included job lifecycle ──
    event_types = [e.get("type") for e in realtime.events]
    assert "job.started" in event_types
    assert "job.completed" in event_types

    # ── Verify indexing status transition ──
    # After indexing completes, status should be "completed"
    refreshed = registry.get_document(record_id=response.record_id)
    assert refreshed is not None
    assert refreshed.status == "completed"
