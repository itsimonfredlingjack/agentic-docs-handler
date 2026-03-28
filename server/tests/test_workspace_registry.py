"""Tests for WorkspaceRegistry CRUD operations."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from server.document_registry import DocumentRegistry
from server.migrations.jsonl_to_sqlite import create_inbox_workspace, create_schema
from server.schemas import (
    DocumentClassification,
    UiDocumentRecord,
)
from server.workspace_registry import WorkspaceRegistry


def _setup(tmp_path: Path) -> tuple[sqlite3.Connection, WorkspaceRegistry, DocumentRegistry]:
    db_path = tmp_path / "test.db"
    doc_reg = DocumentRegistry(db_path=db_path)
    create_schema(doc_reg.conn)
    create_inbox_workspace(doc_reg.conn)
    ws_reg = WorkspaceRegistry(conn=doc_reg.conn)
    return doc_reg.conn, ws_reg, doc_reg


def _sample_doc(record_id: str) -> UiDocumentRecord:
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


class TestCreateWorkspace:
    def test_creates_and_retrieves(self, tmp_path: Path) -> None:
        _, ws_reg, _ = _setup(tmp_path)
        ws = ws_reg.create_workspace(name="Legal Case", cover_color="#5856d6")
        assert ws.name == "Legal Case"
        assert ws.cover_color == "#5856d6"
        assert ws.is_inbox is False

        fetched = ws_reg.get_workspace(workspace_id=ws.id)
        assert fetched is not None
        assert fetched.name == "Legal Case"

    def test_get_nonexistent(self, tmp_path: Path) -> None:
        _, ws_reg, _ = _setup(tmp_path)
        assert ws_reg.get_workspace(workspace_id="nonexistent") is None


class TestGetInbox:
    def test_returns_inbox(self, tmp_path: Path) -> None:
        _, ws_reg, _ = _setup(tmp_path)
        inbox = ws_reg.get_inbox()
        assert inbox.is_inbox is True
        assert inbox.name == "Inkorg"


class TestListWorkspaces:
    def test_lists_with_file_counts(self, tmp_path: Path) -> None:
        _, ws_reg, doc_reg = _setup(tmp_path)
        inbox = ws_reg.get_inbox()

        # Add docs to inbox
        doc_reg.upsert_document(_sample_doc("d1"))
        doc_reg.upsert_document(_sample_doc("d2"))

        # Create another workspace and move one doc
        ws = ws_reg.create_workspace(name="Tax 2025")
        ws_reg.move_files_to_workspace(file_ids=["d1"], workspace_id=ws.id)

        result = ws_reg.list_workspaces()
        assert len(result.workspaces) == 2

        # Inbox first (is_inbox DESC ordering)
        inbox_resp = result.workspaces[0]
        assert inbox_resp.is_inbox is True
        assert inbox_resp.file_count == 1  # d2 remains

        tax_resp = result.workspaces[1]
        assert tax_resp.name == "Tax 2025"
        assert tax_resp.file_count == 1  # d1 moved here


class TestUpdateWorkspace:
    def test_updates_fields(self, tmp_path: Path) -> None:
        _, ws_reg, _ = _setup(tmp_path)
        ws = ws_reg.create_workspace(name="Old Name")
        updated = ws_reg.update_workspace(
            workspace_id=ws.id, name="New Name", description="Updated desc"
        )
        assert updated.name == "New Name"
        assert updated.description == "Updated desc"

    def test_unknown_workspace_raises(self, tmp_path: Path) -> None:
        _, ws_reg, _ = _setup(tmp_path)
        with pytest.raises(KeyError, match="unknown_workspace_id"):
            ws_reg.update_workspace(workspace_id="fake", name="X")

    def test_no_op_when_no_fields(self, tmp_path: Path) -> None:
        _, ws_reg, _ = _setup(tmp_path)
        ws = ws_reg.create_workspace(name="Test")
        same = ws_reg.update_workspace(workspace_id=ws.id)
        assert same.name == "Test"


class TestDeleteWorkspace:
    def test_moves_files_to_inbox_then_deletes(self, tmp_path: Path) -> None:
        _, ws_reg, doc_reg = _setup(tmp_path)
        ws = ws_reg.create_workspace(name="Temp")

        doc_reg.upsert_document(_sample_doc("d1"))
        ws_reg.move_files_to_workspace(file_ids=["d1"], workspace_id=ws.id)

        ws_reg.delete_workspace(workspace_id=ws.id)

        assert ws_reg.get_workspace(workspace_id=ws.id) is None
        # d1 should be back in inbox
        inbox = ws_reg.get_inbox()
        result = ws_reg.list_workspaces()
        inbox_resp = [w for w in result.workspaces if w.is_inbox][0]
        assert inbox_resp.file_count == 1

    def test_cannot_delete_inbox(self, tmp_path: Path) -> None:
        _, ws_reg, _ = _setup(tmp_path)
        inbox = ws_reg.get_inbox()
        with pytest.raises(ValueError, match="cannot_delete_inbox"):
            ws_reg.delete_workspace(workspace_id=inbox.id)

    def test_unknown_workspace_raises(self, tmp_path: Path) -> None:
        _, ws_reg, _ = _setup(tmp_path)
        with pytest.raises(KeyError, match="unknown_workspace_id"):
            ws_reg.delete_workspace(workspace_id="fake")


class TestMoveFiles:
    def test_moves_between_workspaces(self, tmp_path: Path) -> None:
        _, ws_reg, doc_reg = _setup(tmp_path)
        ws_a = ws_reg.create_workspace(name="A")
        ws_b = ws_reg.create_workspace(name="B")

        doc_reg.upsert_document(_sample_doc("d1"))
        doc_reg.upsert_document(_sample_doc("d2"))
        ws_reg.move_files_to_workspace(file_ids=["d1", "d2"], workspace_id=ws_a.id)

        moved = ws_reg.move_files_to_workspace(file_ids=["d1"], workspace_id=ws_b.id)
        assert moved == 1

        result = ws_reg.list_workspaces()
        a_resp = [w for w in result.workspaces if w.name == "A"][0]
        b_resp = [w for w in result.workspaces if w.name == "B"][0]
        assert a_resp.file_count == 1
        assert b_resp.file_count == 1

    def test_unknown_workspace_raises(self, tmp_path: Path) -> None:
        _, ws_reg, _ = _setup(tmp_path)
        with pytest.raises(KeyError, match="unknown_workspace_id"):
            ws_reg.move_files_to_workspace(file_ids=["d1"], workspace_id="fake")
