"""Tests for workspace timeline event model.

Verifies:
  (a) Events are persisted and retrieved in correct order
  (b) Events are cleaned up when workspace is deleted
  (c) document_added event is emitted during AI auto-assignment in the pipeline
  (d) The timeline API returns correct data
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from server.document_registry import DocumentRegistry
from server.migrations.migrate import ensure_schema
from server.migrations.jsonl_to_sqlite import create_inbox_workspace
from server.workspace_event_log import WorkspaceEventLog
from server.workspace_registry import WorkspaceRegistry
from server.pipelines.process_pipeline import DocumentProcessPipeline
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MovePlan,
)


# -- Fakes for pipeline test -------------------------------------------------

class FakeClassifier:
    def __init__(self, *, workspace_name: str = "Testprojekt") -> None:
        self._ws_name = workspace_name

    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        return DocumentClassification(
            document_type="report", template="report",
            title="Kvartalsrapport Q1", summary="Rapport om Q1",
            tags=["rapport"], language="sv", confidence=0.91,
        )

    async def classify_image(self, *a, **kw):
        raise AssertionError("not expected")


class FakeExtractor:
    async def extract(self, text, classification, request_id) -> ExtractionResult:
        return ExtractionResult(fields={"author": "Test"}, field_confidence={"author": 0.9}, missing_fields=[])


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


class FakeWorkspaceSuggester:
    """Always suggests the given workspace with high confidence."""
    def __init__(self, *, target_name: str):
        self._target = target_name

    async def suggest(self, *, title, summary, document_type, entities, workspaces, request_id):
        from server.pipelines.workspace_suggester import SuggestionResult
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
            confidence=0.88,
            reason="test match",
            auto_assigned=True,
        )


# -- Unit tests for WorkspaceEventLog ----------------------------------------

def test_event_persistence_and_order(tmp_path: Path) -> None:
    """Events should be persisted and returned newest-first."""
    import sqlite3
    db_path = tmp_path / "events.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)

    log = WorkspaceEventLog(conn=conn)
    ws_id = "ws-test-1"

    log.emit(workspace_id=ws_id, event_type="workspace_created", title="Workspace skapad")
    log.emit(workspace_id=ws_id, event_type="document_added", title="Dokument tillagt: rapport.pdf")
    log.emit(workspace_id=ws_id, event_type="brief_updated", title="AI-sammanfattning uppdaterad")

    events = log.list_events(workspace_id=ws_id)
    assert len(events) == 3
    # Newest first
    assert events[0]["event_type"] == "brief_updated"
    assert events[1]["event_type"] == "document_added"
    assert events[2]["event_type"] == "workspace_created"

    # Different workspace has no events
    other_events = log.list_events(workspace_id="ws-other")
    assert len(other_events) == 0

    conn.close()


def test_event_cleanup_on_workspace_delete(tmp_path: Path) -> None:
    """Events should be deleted when workspace is deleted."""
    import sqlite3
    db_path = tmp_path / "cleanup.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)

    log = WorkspaceEventLog(conn=conn)
    ws_id = "ws-cleanup"

    log.emit(workspace_id=ws_id, event_type="workspace_created", title="Created")
    log.emit(workspace_id=ws_id, event_type="document_added", title="Added")
    assert len(log.list_events(workspace_id=ws_id)) == 2

    deleted = log.delete_workspace_events(workspace_id=ws_id)
    assert deleted == 2
    assert len(log.list_events(workspace_id=ws_id)) == 0

    conn.close()


# -- Integration test: pipeline emits document_added event -------------------

@pytest.mark.asyncio
async def test_pipeline_emits_document_added_on_auto_assignment(tmp_path: Path) -> None:
    """When AI auto-assigns a document, a document_added event should be emitted."""
    db_path = tmp_path / "pipeline_events.db"
    registry = DocumentRegistry(db_path=db_path)
    ensure_schema(registry.conn)
    create_inbox_workspace(registry.conn)

    workspace_registry = WorkspaceRegistry(conn=registry.conn)
    target_ws = workspace_registry.create_workspace(name="Rapporter", description="Rapporter och PM")

    event_log = WorkspaceEventLog(conn=registry.conn)
    search = FakeSearchPipeline()

    pipeline = DocumentProcessPipeline(
        classifier=FakeClassifier(),
        extractor=FakeExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=FakeRealtimeManager(),
        search_pipeline=search,
        workspace_suggester=FakeWorkspaceSuggester(target_name="Rapporter"),
        workspace_registry=workspace_registry,
        workspace_event_log=event_log,
    )

    await pipeline.process_upload(
        filename="rapport-q1.txt",
        content=b"Kvartalsrapport Q1 2025",
        content_type="text/plain",
        execute_move=False,
        source_path=None,
        client_id="test",
    )

    await asyncio.sleep(0.1)

    events = event_log.list_events(workspace_id=target_ws.id)
    assert len(events) >= 1
    added_events = [e for e in events if e["event_type"] == "document_added"]
    assert len(added_events) == 1
    assert "Kvartalsrapport Q1" in added_events[0]["title"]


# -- API test: timeline endpoint returns events ------------------------------

def test_timeline_api_returns_events(tmp_path: Path) -> None:
    """GET /workspaces/{id}/timeline should return events."""
    from server.main import create_app

    db_path = tmp_path / "api_events.db"

    # Build a minimal app for testing
    doc_registry = DocumentRegistry(db_path=db_path)
    ensure_schema(doc_registry.conn)
    create_inbox_workspace(doc_registry.conn)

    ws_registry = WorkspaceRegistry(conn=doc_registry.conn)
    ws = ws_registry.create_workspace(name="API Test", description="test")

    event_log = WorkspaceEventLog(conn=doc_registry.conn)
    event_log.emit(workspace_id=ws.id, event_type="workspace_created", title="Workspace skapad: API Test")
    event_log.emit(workspace_id=ws.id, event_type="document_added", title="Dokument tillagt: test.pdf")

    app = create_app(
        document_registry=doc_registry,
        pipeline=_FakePipeline(),
        readiness_probe=lambda: {"ready": True, "checks": {}},
    )

    # The event log is created inside create_app from the same conn, but we
    # pre-inserted events directly.  The timeline endpoint should find them.
    client = TestClient(app)
    response = client.get(f"/workspaces/{ws.id}/timeline?limit=10")
    assert response.status_code == 200
    data = response.json()
    assert len(data["events"]) == 2
    assert data["events"][0]["event_type"] == "document_added"  # newest first
    assert data["events"][1]["event_type"] == "workspace_created"

    doc_registry.close()


class _FakePipeline:
    """Minimal fake to satisfy create_app pipeline parameter."""
    pass
