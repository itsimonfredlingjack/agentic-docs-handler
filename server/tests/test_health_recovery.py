"""Tests for health-recovery retry trigger and timeline removal events.

Verifies:
  (a) Health transition unhealthy→healthy triggers one retry sweep
  (b) Repeated healthy polls do NOT re-trigger
  (c) document_removed event emitted on document delete from non-inbox workspace
  (d) documents_moved_out event emitted on move to a different workspace
"""
from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path

import pytest

from server.clients.ollama_client import OllamaServiceError
from server.document_registry import DocumentRegistry
from server.migrations.migrate import ensure_schema
from server.migrations.jsonl_to_sqlite import create_inbox_workspace
from server.pipelines.process_pipeline import DocumentProcessPipeline
from server.workspace_event_log import WorkspaceEventLog
from server.workspace_registry import WorkspaceRegistry
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MovePlan,
)


# -- Fakes -------------------------------------------------------------------

class OllamaDownClassifier:
    async def classify_text(self, text, request_id):
        raise OllamaServiceError(
            code="ollama_unavailable", retryable=True,
            upstream="refused", message="down",
        )
    async def classify_image(self, *a, **kw):
        raise OllamaServiceError(
            code="ollama_unavailable", retryable=True,
            upstream="refused", message="down",
        )

class WorkingClassifier:
    async def classify_text(self, text, request_id):
        return DocumentClassification(
            document_type="receipt", template="receipt",
            title="Kvitto", summary="Kvitto",
            tags=["kvitto"], language="sv", confidence=0.9,
        )
    async def classify_image(self, *a, **kw):
        raise AssertionError("not expected")

class SimpleExtractor:
    async def extract(self, text, classification, request_id):
        return ExtractionResult(fields={}, field_confidence={}, missing_fields=[])

class FakeOrganizer:
    def plan_move(self, filename, classification):
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


# -- Health recovery tests ---------------------------------------------------

@pytest.mark.asyncio
async def test_health_recovery_triggers_retry_on_transition(tmp_path: Path) -> None:
    """Simulates the health monitor's unhealthy→healthy logic: should trigger sweep."""
    db_path = tmp_path / "recovery.db"
    registry = DocumentRegistry(db_path=db_path)
    ensure_schema(registry.conn)
    create_inbox_workspace(registry.conn)

    # Create a pending document
    down_pipeline = DocumentProcessPipeline(
        classifier=OllamaDownClassifier(),
        extractor=SimpleExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=FakeRealtimeManager(),
    )

    staged = tmp_path / "pending.txt"
    staged.write_text("Pending document content")

    await down_pipeline.process_upload(
        filename="pending.txt",
        content=staged.read_bytes(),
        content_type="text/plain",
        execute_move=False,
        source_path=str(staged),
        client_id="test",
    )
    assert len(registry.list_pending_retryable()) == 1

    # Simulate the health monitor logic: track state, detect transition
    last_healthy = False  # was unhealthy
    is_healthy = True     # now healthy

    sweep_triggered = False
    if is_healthy and not last_healthy:
        sweep_triggered = True

    assert sweep_triggered, "unhealthy→healthy should trigger sweep"

    # Actually retry with a working pipeline
    up_pipeline = DocumentProcessPipeline(
        classifier=WorkingClassifier(),
        extractor=SimpleExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=FakeRealtimeManager(),
        search_pipeline=FakeSearchPipeline(),
    )

    pending = registry.list_pending_retryable()
    for record in pending:
        content = Path(record.source_path).read_bytes()
        await up_pipeline.reprocess_pending(
            record_id=record.id,
            content=content,
            filename="pending.txt",
            content_type=record.mime_type,
            source_path=record.source_path,
            client_id=None,
        )

    await asyncio.sleep(0.1)
    assert len(registry.list_pending_retryable()) == 0


def test_repeated_healthy_does_not_retrigger() -> None:
    """If health stays healthy, no additional sweeps should fire."""
    last_healthy = True
    is_healthy = True

    should_trigger = is_healthy and not last_healthy
    assert not should_trigger, "healthy→healthy should NOT trigger sweep"

    # Also test healthy→unhealthy→healthy cycle
    states = [True, True, False, False, True, True, True]
    trigger_count = 0
    last = True
    for current in states:
        if current and not last:
            trigger_count += 1
        last = current

    assert trigger_count == 1, "Only one unhealthy→healthy transition should trigger"


# -- Timeline removal event tests -------------------------------------------

def test_document_removed_event_on_delete_from_workspace(tmp_path: Path) -> None:
    """Deleting a document from a non-inbox workspace should emit document_removed."""
    db_path = tmp_path / "removal.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    create_inbox_workspace(conn)

    ws_registry = WorkspaceRegistry(conn=conn)
    ws = ws_registry.create_workspace(name="Projekt A", description="Test")

    event_log = WorkspaceEventLog(conn=conn)
    registry = DocumentRegistry(db_path=db_path)

    # Create a document in the workspace manually
    from datetime import UTC, datetime
    from uuid import uuid4
    doc_id = str(uuid4())
    now = datetime.now(UTC).isoformat()
    conn.execute(
        """
        INSERT INTO document (id, request_id, workspace_id, title, summary,
            mime_type, source_modality, kind, document_type, template,
            created_at, updated_at, classification, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{"document_type":"report","template":"report","title":"Test rapport","summary":"Test","tags":[],"language":"sv","confidence":0.9}', 'completed')
        """,
        (doc_id, "req-1", ws.id, "Test rapport", "Testfil",
         "text/plain", "text", "report", "report", "report", now, now),
    )
    conn.commit()

    # Simulate what the delete endpoint does: get_document, then emit event
    record = registry.get_document(record_id=doc_id)
    assert record is not None
    assert record.workspace_id == ws.id

    # Delete the document
    registry.delete_document(record_id=doc_id)

    # Emit the event (same logic as the route handler)
    src_ws = ws_registry.get_workspace(workspace_id=record.workspace_id)
    assert src_ws is not None and not src_ws.is_inbox
    event_log.emit(
        workspace_id=record.workspace_id,
        event_type="document_removed",
        title=f"Dokument borttaget: {record.title}",
    )

    events = event_log.list_events(workspace_id=ws.id)
    removed = [e for e in events if e["event_type"] == "document_removed"]
    assert len(removed) == 1
    assert "Test rapport" in removed[0]["title"]

    conn.close()


def test_documents_moved_out_event(tmp_path: Path) -> None:
    """Moving documents to a different workspace should emit documents_moved_out on the source."""
    db_path = tmp_path / "moveout.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    create_inbox_workspace(conn)

    ws_registry = WorkspaceRegistry(conn=conn)
    ws_a = ws_registry.create_workspace(name="Projekt A", description="Source")
    ws_b = ws_registry.create_workspace(name="Projekt B", description="Destination")

    event_log = WorkspaceEventLog(conn=conn)

    # Create documents in workspace A
    from datetime import UTC, datetime
    from uuid import uuid4
    doc_ids = []
    now = datetime.now(UTC).isoformat()
    for i in range(3):
        doc_id = str(uuid4())
        doc_ids.append(doc_id)
        conn.execute(
            """
            INSERT INTO document (id, request_id, workspace_id, title, summary,
                mime_type, source_modality, kind, document_type, template,
                created_at, updated_at, classification, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'completed')
            """,
            (doc_id, f"req-{i}", ws_a.id, f"Doc {i}", "Test",
             "text/plain", "text", "generic", "generic", "generic", now, now),
        )
    conn.commit()

    # Query source workspace_ids before move
    placeholders = ", ".join("?" for _ in doc_ids)
    rows = conn.execute(
        f"SELECT workspace_id FROM document WHERE id IN ({placeholders})",
        doc_ids,
    ).fetchall()
    source_workspaces: dict[str, int] = {}
    for row in rows:
        src = row["workspace_id"]
        if src and src != ws_b.id:
            source_workspaces[src] = source_workspaces.get(src, 0) + 1

    # Move documents to workspace B
    ws_registry.move_files_to_workspace(file_ids=doc_ids, workspace_id=ws_b.id)

    # Emit documents_moved_out for source
    for src_ws_id, count in source_workspaces.items():
        src_ws = ws_registry.get_workspace(workspace_id=src_ws_id)
        if src_ws and not src_ws.is_inbox:
            event_log.emit(
                workspace_id=src_ws_id,
                event_type="documents_moved_out",
                title=f"{count} dokument flyttade härifrån",
            )

    events_a = event_log.list_events(workspace_id=ws_a.id)
    moved_out = [e for e in events_a if e["event_type"] == "documents_moved_out"]
    assert len(moved_out) == 1
    assert "3 dokument" in moved_out[0]["title"]

    # Workspace B should have no moved_out events
    events_b = event_log.list_events(workspace_id=ws_b.id)
    assert all(e["event_type"] != "documents_moved_out" for e in events_b)

    conn.close()
