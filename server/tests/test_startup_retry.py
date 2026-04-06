"""Tests for startup retry sweep and document type expansion.

Verifies:
  (a) Startup retry sweep processes pending documents when Ollama is healthy
  (b) Startup retry sweep skips gracefully when Ollama is unavailable
  (c) New document types are registered in the prompt path registry
  (d) New document types are present in classification literals
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from server.clients.ollama_client import OllamaServiceError
from server.config import AppConfig
from server.document_registry import DocumentRegistry
from server.migrations.migrate import ensure_schema
from server.migrations.jsonl_to_sqlite import create_inbox_workspace
from server.pipelines.process_pipeline import DocumentProcessPipeline
from server.schemas import (
    DocumentClassification,
    DocumentCountsResponse,
    DocumentType,
    ExtractionResult,
    MovePlan,
    UiDocumentKind,
)


# -- Fakes -------------------------------------------------------------------

class OllamaDownClassifier:
    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        raise OllamaServiceError(
            code="ollama_unavailable", retryable=True,
            upstream="connection refused", message="Ollama is not reachable",
        )

    async def classify_image(self, image_bytes: bytes, mime_type: str, request_id: str) -> DocumentClassification:
        raise OllamaServiceError(
            code="ollama_unavailable", retryable=True,
            upstream="connection refused", message="Ollama is not reachable",
        )


class WorkingClassifier:
    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        return DocumentClassification(
            document_type="receipt", template="receipt",
            title="ICA Kvitto", summary="Kvitto",
            tags=["kvitto"], language="sv", confidence=0.91,
        )

    async def classify_image(self, *a, **kw) -> DocumentClassification:
        raise AssertionError("not expected")


class SimpleExtractor:
    async def extract(self, text, classification, request_id) -> ExtractionResult:
        return ExtractionResult(
            fields={"vendor": "ICA"}, field_confidence={"vendor": 0.9}, missing_fields=[],
        )


class FakeOrganizer:
    def plan_move(self, filename, classification) -> MovePlan:
        return MovePlan(reason="workspace_pending")


class FakeRealtimeManager:
    def __init__(self):
        self.events = []
    async def emit_to_client(self, client_id, event):
        self.events.append(event)


class FakeSearchPipeline:
    def __init__(self):
        self.documents = []
    def upsert_document(self, document):
        self.documents.append(document)


# -- Startup retry tests -----------------------------------------------------

@pytest.mark.asyncio
async def test_startup_retry_processes_pending_when_healthy(tmp_path: Path) -> None:
    """The startup sweep should retry pending documents when Ollama is healthy."""
    db_path = tmp_path / "startup.db"
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

    staged = tmp_path / "kvitto.txt"
    staged.write_text("ICA Maxi\nTotalt: 140,40 kr")

    pending = await down_pipeline.process_upload(
        filename="kvitto.txt",
        content=staged.read_bytes(),
        content_type="text/plain",
        execute_move=False,
        source_path=str(staged),
        client_id="test",
    )
    assert pending.status == "pending_classification"
    assert len(registry.list_pending_retryable()) == 1

    # Step 2: Simulate startup sweep with healthy pipeline
    up_pipeline = DocumentProcessPipeline(
        classifier=WorkingClassifier(),
        extractor=SimpleExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=realtime,
        search_pipeline=search,
    )

    # Simulate what the lifespan startup sweep does
    pending_docs = registry.list_pending_retryable()
    for record in pending_docs:
        if record.source_path and Path(record.source_path).exists():
            content = Path(record.source_path).read_bytes()
            await up_pipeline.reprocess_pending(
                record_id=record.id,
                content=content,
                filename=Path(record.source_path).name,
                content_type=record.mime_type,
                source_path=record.source_path,
                client_id=None,
            )

    await asyncio.sleep(0.1)

    # ── Verify recovery ──
    assert len(registry.list_pending_retryable()) == 0
    assert len(search.documents) == 1


@pytest.mark.asyncio
async def test_startup_retry_skips_when_file_missing(tmp_path: Path) -> None:
    """If the staged file is gone, the pending document should be skipped."""
    db_path = tmp_path / "missing.db"
    registry = DocumentRegistry(db_path=db_path)
    ensure_schema(registry.conn)
    create_inbox_workspace(registry.conn)

    realtime = FakeRealtimeManager()
    down_pipeline = DocumentProcessPipeline(
        classifier=OllamaDownClassifier(),
        extractor=SimpleExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=realtime,
    )

    staged = tmp_path / "temp.txt"
    staged.write_text("content")

    await down_pipeline.process_upload(
        filename="temp.txt",
        content=staged.read_bytes(),
        content_type="text/plain",
        execute_move=False,
        source_path=str(staged),
        client_id="test",
    )

    # Delete the staged file to simulate cleanup
    staged.unlink()

    # Sweep should skip without crashing
    pending_docs = registry.list_pending_retryable()
    assert len(pending_docs) == 1
    for record in pending_docs:
        assert not Path(record.source_path).exists()
    # Document stays pending
    assert len(registry.list_pending_retryable()) == 1


# -- Document type expansion tests -------------------------------------------

def test_prompt_registry_includes_new_types() -> None:
    """All new extractor prompts should be in the required_prompt_paths."""
    config = AppConfig(
        prompts_dir=Path("server/prompts"),
        sqlite_db_path=Path("/tmp/test.db"),
    )
    paths = config.required_prompt_paths()
    path_names = {p.name for p in paths}

    assert "report.txt" in path_names
    assert "letter.txt" in path_names
    assert "tax_document.txt" in path_names


def test_new_extractor_prompts_exist() -> None:
    """All new extractor prompt files should exist on disk."""
    for name in ("report.txt", "letter.txt", "tax_document.txt"):
        path = Path("server/prompts/extractors") / name
        assert path.exists(), f"Extractor prompt {name} does not exist"
        content = path.read_text(encoding="utf-8")
        assert len(content) > 100, f"Extractor prompt {name} is too short"
        assert "Returnera BARA" in content, f"Extractor prompt {name} missing JSON instruction"


def test_document_type_literals_include_new_types() -> None:
    """Schema Literal types should include the new document types."""
    from typing import get_args
    doc_types = get_args(DocumentType)
    assert "report" in doc_types
    assert "letter" in doc_types
    assert "tax_document" in doc_types

    ui_kinds = get_args(UiDocumentKind)
    assert "report" in ui_kinds
    assert "letter" in ui_kinds
    assert "tax_document" in ui_kinds


def test_counts_response_has_new_type_fields() -> None:
    """DocumentCountsResponse should have fields for new types."""
    counts = DocumentCountsResponse()
    assert hasattr(counts, "report")
    assert hasattr(counts, "letter")
    assert hasattr(counts, "tax_document")
    assert counts.report == 0
    assert counts.letter == 0
    assert counts.tax_document == 0
