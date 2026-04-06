"""Tests for degraded mode: Ollama unavailable → pending → retry recovery.

Verifies:
  (a) OllamaServiceError during classification → document persisted as pending_classification
  (b) Retry of a pending document → successful processing when Ollama is back
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

import pytest

from server.clients.ollama_client import OllamaServiceError
from server.document_registry import DocumentRegistry
from server.migrations.migrate import ensure_schema
from server.migrations.jsonl_to_sqlite import create_inbox_workspace
from server.pipelines.process_pipeline import DocumentProcessPipeline
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MovePlan,
)


# -- Fakes -------------------------------------------------------------------

class OllamaDownClassifier:
    """Classifier that always raises OllamaServiceError."""

    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        raise OllamaServiceError(
            code="ollama_unavailable",
            retryable=True,
            upstream="connection refused",
            message="Ollama is not reachable",
        )

    async def classify_image(self, image_bytes: bytes, mime_type: str, request_id: str) -> DocumentClassification:
        raise OllamaServiceError(
            code="ollama_unavailable",
            retryable=True,
            upstream="connection refused",
            message="Ollama is not reachable",
        )


class WorkingClassifier:
    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        return DocumentClassification(
            document_type="receipt",
            template="receipt",
            title="ICA Kvitto 2025-03-15",
            summary="Kvitto från ICA Maxi",
            tags=["kvitto"],
            language="sv",
            confidence=0.91,
        )

    async def classify_image(self, image_bytes: bytes, mime_type: str, request_id: str) -> DocumentClassification:
        raise AssertionError("image path not expected")


class SimpleExtractor:
    async def extract(self, text: str, classification: DocumentClassification, request_id: str) -> ExtractionResult:
        return ExtractionResult(
            fields={"vendor": "ICA Maxi", "amount": "140,40 kr"},
            field_confidence={"vendor": 0.9, "amount": 0.9},
            missing_fields=[],
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


# -- Tests -------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ollama_unavailable_persists_pending_document(tmp_path: Path) -> None:
    """When Ollama is down, ingest should persist the document as pending_classification."""
    db_path = tmp_path / "degraded.db"
    registry = DocumentRegistry(db_path=db_path)
    ensure_schema(registry.conn)
    create_inbox_workspace(registry.conn)

    realtime = FakeRealtimeManager()
    pipeline = DocumentProcessPipeline(
        classifier=OllamaDownClassifier(),
        extractor=SimpleExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=realtime,
    )

    response = await pipeline.process_upload(
        filename="kvitto-ica.txt",
        content=b"ICA Maxi Lindhagen\nTotalt: 140,40 kr",
        content_type="text/plain",
        execute_move=False,
        source_path="/tmp/staged/kvitto-ica.txt",
        client_id="test-client",
    )

    # ── Verify response status ──
    assert response.status == "pending_classification"
    assert response.retryable is True
    assert response.error_code == "ollama_unavailable"
    assert response.record_id is not None

    # ── Verify document persisted in registry ──
    persisted = registry.get_document(record_id=response.record_id)
    assert persisted is not None
    assert persisted.status == "pending_classification"
    assert persisted.retryable is True
    assert persisted.error_code == "ollama_unavailable"
    assert persisted.source_path == "/tmp/staged/kvitto-ica.txt"

    # ── Verify it appears in pending list ──
    pending = registry.list_pending_retryable()
    assert len(pending) == 1
    assert pending[0].id == response.record_id

    # ── Verify WebSocket events include the failure event ──
    failed_events = [e for e in realtime.events if e.get("type") == "job.failed"]
    assert len(failed_events) == 1
    assert failed_events[0]["retryable"] is True
    assert failed_events[0]["record_id"] == response.record_id


@pytest.mark.asyncio
async def test_retry_recovers_pending_document(tmp_path: Path) -> None:
    """A pending document should recover when retried with a working classifier."""
    db_path = tmp_path / "retry.db"
    registry = DocumentRegistry(db_path=db_path)
    ensure_schema(registry.conn)
    create_inbox_workspace(registry.conn)

    realtime = FakeRealtimeManager()
    search = FakeSearchPipeline()

    # Step 1: Create a pending document (Ollama down)
    down_pipeline = DocumentProcessPipeline(
        classifier=OllamaDownClassifier(),
        extractor=SimpleExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=realtime,
    )

    # Write content to a real file so retry can read it
    staged_file = tmp_path / "kvitto-ica.txt"
    staged_file.write_text("ICA Maxi Lindhagen\nTotalt: 140,40 kr")

    pending_response = await down_pipeline.process_upload(
        filename="kvitto-ica.txt",
        content=staged_file.read_bytes(),
        content_type="text/plain",
        execute_move=False,
        source_path=str(staged_file),
        client_id="test-client",
    )
    assert pending_response.status == "pending_classification"
    old_record_id = pending_response.record_id

    # Step 2: Retry with a working classifier (Ollama is back)
    up_pipeline = DocumentProcessPipeline(
        classifier=WorkingClassifier(),
        extractor=SimpleExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=realtime,
        search_pipeline=search,
    )

    retry_response = await up_pipeline.reprocess_pending(
        record_id=old_record_id,
        content=staged_file.read_bytes(),
        filename="kvitto-ica.txt",
        content_type="text/plain",
        source_path=str(staged_file),
        client_id="test-client",
    )

    # Wait for background indexing
    await asyncio.sleep(0.1)

    # ── Verify retry succeeded ──
    assert retry_response.classification.document_type == "receipt"
    assert retry_response.classification.confidence == 0.91
    assert retry_response.extraction is not None
    assert retry_response.extraction.fields.get("vendor") == "ICA Maxi"

    # ── Verify old pending record was deleted ──
    old_record = registry.get_document(record_id=old_record_id)
    assert old_record is None, "old pending record should be deleted after retry"

    # ── Verify new record exists and is completed ──
    new_record = registry.get_document(record_id=retry_response.record_id)
    assert new_record is not None
    assert new_record.status == "completed"

    # ── Verify pending list is now empty ──
    pending = registry.list_pending_retryable()
    assert len(pending) == 0

    # ── Verify search pipeline got the document ──
    assert len(search.documents) == 1


@pytest.mark.asyncio
async def test_retry_when_ollama_still_down_stays_pending(tmp_path: Path) -> None:
    """If Ollama is still down during retry, a new pending record is created."""
    db_path = tmp_path / "retry_fail.db"
    registry = DocumentRegistry(db_path=db_path)
    ensure_schema(registry.conn)
    create_inbox_workspace(registry.conn)

    realtime = FakeRealtimeManager()
    pipeline = DocumentProcessPipeline(
        classifier=OllamaDownClassifier(),
        extractor=SimpleExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=realtime,
    )

    staged_file = tmp_path / "doc.txt"
    staged_file.write_text("Some document content")

    # First ingest: pending
    first = await pipeline.process_upload(
        filename="doc.txt",
        content=staged_file.read_bytes(),
        content_type="text/plain",
        execute_move=False,
        source_path=str(staged_file),
        client_id="test-client",
    )
    assert first.status == "pending_classification"

    # Retry: still pending (Ollama still down)
    second = await pipeline.reprocess_pending(
        record_id=first.record_id,
        content=staged_file.read_bytes(),
        filename="doc.txt",
        content_type="text/plain",
        source_path=str(staged_file),
        client_id="test-client",
    )
    assert second.status == "pending_classification"
    assert second.retryable is True

    # Old record should be gone, new one should exist
    assert registry.get_document(record_id=first.record_id) is None
    assert registry.get_document(record_id=second.record_id) is not None

    # Still exactly 1 pending document
    pending = registry.list_pending_retryable()
    assert len(pending) == 1
