"""Tests for JSONL → SQLite migration."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from server.migrations.jsonl_to_sqlite import (
    INBOX_NAME,
    create_inbox_workspace,
    create_schema,
    is_migrated,
    migrate_documents,
    migrate_events,
    migrate_moves,
    run_migration,
)
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MovePlan,
    UiDocumentRecord,
)


def _make_conn(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _sample_record(*, record_id: str = "rec-1", title: str = "Test Doc") -> UiDocumentRecord:
    return UiDocumentRecord(
        id=record_id,
        request_id="req-1",
        title=title,
        summary="A test document",
        mime_type="application/pdf",
        source_modality="text",
        kind="receipt",
        document_type="receipt",
        template="receipt",
        source_path="/tmp/test.pdf",
        created_at="2025-01-01T00:00:00+00:00",
        updated_at="2025-01-01T00:00:00+00:00",
        classification=DocumentClassification(
            document_type="receipt",
            template="receipt",
            title=title,
            summary="A test document",
            tags=["test"],
            language="sv",
            confidence=0.95,
        ),
        extraction=ExtractionResult(
            fields={"vendor": "IKEA", "amount": "199.00"},
            field_confidence={"vendor": 0.9, "amount": 0.85},
            missing_fields=[],
        ),
        move_plan=MovePlan(
            rule_name="receipts",
            destination="/tmp/receipts/2025/01",
            auto_move_allowed=True,
            reason="rule_matched",
        ),
        tags=["test", "receipt"],
        status="ready",
        move_status="not_requested",
        warnings=["low_confidence"],
    )


# ------------------------------------------------------------------
# Schema creation
# ------------------------------------------------------------------

class TestCreateSchema:
    def test_creates_all_tables(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)

        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert "workspace" in tables
        assert "document" in tables
        assert "move_history" in tables
        assert "engagement_event" in tables
        assert "file_relation" in tables
        assert "entity" in tables
        assert "file_entity" in tables
        assert "document_fts" in tables
        conn.close()

    def test_idempotent(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)
        create_schema(conn)  # second call should not raise
        conn.close()


# ------------------------------------------------------------------
# Inbox workspace
# ------------------------------------------------------------------

class TestInboxWorkspace:
    def test_creates_inbox(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)
        inbox_id = create_inbox_workspace(conn)

        row = conn.execute(
            "SELECT * FROM workspace WHERE id = ?", (inbox_id,)
        ).fetchone()
        assert row is not None
        assert row["name"] == INBOX_NAME
        assert row["is_inbox"] == 1
        conn.close()

    def test_unique_inbox_constraint(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)
        create_inbox_workspace(conn)
        with pytest.raises(sqlite3.IntegrityError):
            create_inbox_workspace(conn)
        conn.close()


# ------------------------------------------------------------------
# Document migration
# ------------------------------------------------------------------

class TestMigrateDocuments:
    def test_migrates_records(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)
        inbox_id = create_inbox_workspace(conn)

        jsonl_path = tmp_path / "docs.jsonl"
        record = _sample_record()
        jsonl_path.write_text(record.model_dump_json() + "\n", encoding="utf-8")

        count = migrate_documents(conn, path=jsonl_path, inbox_id=inbox_id)
        assert count == 1

        row = conn.execute("SELECT * FROM document WHERE id = ?", (record.id,)).fetchone()
        assert row is not None
        assert row["title"] == "Test Doc"
        assert row["workspace_id"] == inbox_id
        assert row["kind"] == "receipt"
        assert row["retryable"] == 0
        assert json.loads(row["tags"]) == ["test", "receipt"]

        classification = json.loads(row["classification"])
        assert classification["confidence"] == 0.95

        extraction = json.loads(row["extraction"])
        assert extraction["fields"]["vendor"] == "IKEA"
        conn.close()

    def test_deduplicates_last_wins(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)
        inbox_id = create_inbox_workspace(conn)

        r1 = _sample_record(record_id="dup-1", title="First Version")
        r2 = _sample_record(record_id="dup-1", title="Second Version")

        jsonl_path = tmp_path / "docs.jsonl"
        jsonl_path.write_text(
            r1.model_dump_json() + "\n" + r2.model_dump_json() + "\n",
            encoding="utf-8",
        )

        count = migrate_documents(conn, path=jsonl_path, inbox_id=inbox_id)
        assert count == 1

        row = conn.execute("SELECT title FROM document WHERE id = 'dup-1'").fetchone()
        assert row["title"] == "Second Version"
        conn.close()

    def test_skips_malformed_lines(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)
        inbox_id = create_inbox_workspace(conn)

        record = _sample_record()
        jsonl_path = tmp_path / "docs.jsonl"
        jsonl_path.write_text(
            "this is not json\n" + record.model_dump_json() + "\n",
            encoding="utf-8",
        )

        count = migrate_documents(conn, path=jsonl_path, inbox_id=inbox_id)
        assert count == 1
        conn.close()

    def test_empty_file(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)
        inbox_id = create_inbox_workspace(conn)

        jsonl_path = tmp_path / "docs.jsonl"
        jsonl_path.write_text("", encoding="utf-8")

        count = migrate_documents(conn, path=jsonl_path, inbox_id=inbox_id)
        assert count == 0
        conn.close()

    def test_missing_file(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)
        inbox_id = create_inbox_workspace(conn)

        count = migrate_documents(
            conn, path=tmp_path / "nonexistent.jsonl", inbox_id=inbox_id
        )
        assert count == 0
        conn.close()

    def test_fts_populated(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)
        inbox_id = create_inbox_workspace(conn)

        jsonl_path = tmp_path / "docs.jsonl"
        record = _sample_record(title="Kvitto från IKEA")
        jsonl_path.write_text(record.model_dump_json() + "\n", encoding="utf-8")
        migrate_documents(conn, path=jsonl_path, inbox_id=inbox_id)

        fts_rows = conn.execute(
            "SELECT * FROM document_fts WHERE document_fts MATCH 'IKEA'"
        ).fetchall()
        assert len(fts_rows) == 1
        conn.close()


# ------------------------------------------------------------------
# Move history migration
# ------------------------------------------------------------------

class TestMigrateMoves:
    def test_migrates_entries(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)
        inbox_id = create_inbox_workspace(conn)

        # Insert a document first (FK constraint)
        record = _sample_record()
        jsonl_docs = tmp_path / "docs.jsonl"
        jsonl_docs.write_text(record.model_dump_json() + "\n", encoding="utf-8")
        migrate_documents(conn, path=jsonl_docs, inbox_id=inbox_id)

        from server.document_registry import MoveHistoryEntry

        entry = MoveHistoryEntry(
            undo_token="mv_abc123",
            request_id="req-1",
            record_id="rec-1",
            from_path="/tmp/a.pdf",
            to_path="/tmp/b.pdf",
            created_at="2025-01-01T00:00:00+00:00",
        )
        jsonl_moves = tmp_path / "moves.jsonl"
        jsonl_moves.write_text(entry.model_dump_json() + "\n", encoding="utf-8")

        count = migrate_moves(conn, path=jsonl_moves)
        assert count == 1

        row = conn.execute(
            "SELECT * FROM move_history WHERE undo_token = 'mv_abc123'"
        ).fetchone()
        assert row is not None
        assert row["from_path"] == "/tmp/a.pdf"
        conn.close()

    def test_missing_file(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)
        count = migrate_moves(conn, path=tmp_path / "nonexistent.jsonl")
        assert count == 0
        conn.close()


# ------------------------------------------------------------------
# Engagement events migration
# ------------------------------------------------------------------

class TestMigrateEvents:
    def test_migrates_events(self, tmp_path: Path) -> None:
        conn = _make_conn(tmp_path / "test.db")
        create_schema(conn)

        event_json = json.dumps({
            "id": "evt-1",
            "name": "share_brief_created",
            "surface": "search",
            "timestamp": "2025-01-01T00:00:00+00:00",
            "metadata": {"query": "test"},
        })
        jsonl_path = tmp_path / "events.jsonl"
        jsonl_path.write_text(event_json + "\n", encoding="utf-8")

        count = migrate_events(conn, path=jsonl_path)
        assert count == 1

        row = conn.execute("SELECT * FROM engagement_event WHERE id = 'evt-1'").fetchone()
        assert row is not None
        assert row["name"] == "share_brief_created"
        assert json.loads(row["metadata"]) == {"query": "test"}
        conn.close()


# ------------------------------------------------------------------
# Full migration orchestrator
# ------------------------------------------------------------------

class TestRunMigration:
    def test_full_migration(self, tmp_path: Path) -> None:
        db_path = tmp_path / "brain.db"
        docs_path = tmp_path / "docs.jsonl"
        moves_path = tmp_path / "moves.jsonl"
        events_path = tmp_path / "events.jsonl"

        record = _sample_record()
        docs_path.write_text(record.model_dump_json() + "\n", encoding="utf-8")

        run_migration(
            db_path=db_path,
            documents_path=docs_path,
            move_history_path=moves_path,
            events_path=events_path,
        )

        conn = _make_conn(db_path)
        assert conn.execute("SELECT COUNT(*) FROM workspace").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM document").fetchone()[0] == 1

        inbox = conn.execute(
            "SELECT * FROM workspace WHERE is_inbox = 1"
        ).fetchone()
        assert inbox["name"] == INBOX_NAME
        conn.close()

    def test_idempotent(self, tmp_path: Path) -> None:
        db_path = tmp_path / "brain.db"
        docs_path = tmp_path / "docs.jsonl"
        moves_path = tmp_path / "moves.jsonl"
        events_path = tmp_path / "events.jsonl"

        record = _sample_record()
        docs_path.write_text(record.model_dump_json() + "\n", encoding="utf-8")

        run_migration(
            db_path=db_path,
            documents_path=docs_path,
            move_history_path=moves_path,
            events_path=events_path,
        )
        # Second run should be a no-op
        run_migration(
            db_path=db_path,
            documents_path=docs_path,
            move_history_path=moves_path,
            events_path=events_path,
        )

        conn = _make_conn(db_path)
        assert conn.execute("SELECT COUNT(*) FROM document").fetchone()[0] == 1
        conn.close()

    def test_is_migrated_before_and_after(self, tmp_path: Path) -> None:
        db_path = tmp_path / "brain.db"
        conn = _make_conn(db_path)
        assert is_migrated(conn) is False

        create_schema(conn)
        assert is_migrated(conn) is False  # schema exists but no inbox

        create_inbox_workspace(conn)
        assert is_migrated(conn) is True
        conn.close()
