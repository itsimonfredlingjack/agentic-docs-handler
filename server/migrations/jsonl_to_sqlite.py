"""One-time migration from JSONL persistence to SQLite.

Reads ui_documents.jsonl, move_history.jsonl, and engagement_events.jsonl,
creates the SQLite schema, and populates the tables.  JSONL files are NOT
deleted — they remain as backups.

Can be run as a script:  python -m server.migrations.jsonl_to_sqlite
Or called programmatically during app startup via run_migration().
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from server.document_registry import MoveHistoryEntry
from server.schemas import EngagementEventRecord, UiDocumentRecord

logger = logging.getLogger(__name__)

_SCHEMA_PATH = Path(__file__).parent / "schema.sql"
_BATCH_SIZE = 100

INBOX_NAME = "Inkorg"


def utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

def is_migrated(conn: sqlite3.Connection) -> bool:
    """Return True if the database already has the schema and an inbox workspace."""
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM workspace WHERE is_inbox = 1"
        ).fetchone()
        return row is not None and row[0] > 0
    except sqlite3.OperationalError:
        return False


def run_migration(
    *,
    db_path: Path,
    documents_path: Path,
    move_history_path: Path,
    events_path: Path,
) -> None:
    """Orchestrate the full JSONL-to-SQLite migration."""
    logger.info("Starting JSONL → SQLite migration (db: %s)", db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
        create_schema(conn)
        if is_migrated(conn):
            logger.info("Migration already completed — skipping.")
            return

        inbox_id = create_inbox_workspace(conn)

        doc_count = migrate_documents(conn, path=documents_path, inbox_id=inbox_id)
        move_count = migrate_moves(conn, path=move_history_path)
        event_count = migrate_events(conn, path=events_path)

        logger.info(
            "Migration complete: %d documents, %d moves, %d events",
            doc_count, move_count, event_count,
        )
    finally:
        conn.close()


# ------------------------------------------------------------------
# Schema
# ------------------------------------------------------------------

def create_schema(conn: sqlite3.Connection) -> None:
    """Execute the DDL from schema.sql."""
    ddl = _SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(ddl)


# ------------------------------------------------------------------
# Inbox workspace
# ------------------------------------------------------------------

def create_inbox_workspace(conn: sqlite3.Connection) -> str:
    """Insert the inbox workspace and return its id."""
    now = utcnow_iso()
    inbox_id = str(uuid4())
    conn.execute(
        """
        INSERT INTO workspace (id, name, description, is_inbox, created_at, updated_at)
        VALUES (?, ?, '', 1, ?, ?)
        """,
        (inbox_id, INBOX_NAME, now, now),
    )
    conn.commit()
    logger.info("Created inbox workspace: %s", inbox_id)
    return inbox_id


# ------------------------------------------------------------------
# Document migration
# ------------------------------------------------------------------

def migrate_documents(
    conn: sqlite3.Connection,
    *,
    path: Path,
    inbox_id: str,
) -> int:
    """Read ui_documents.jsonl, deduplicate, and INSERT into document table."""
    if not path.exists():
        logger.info("No documents JSONL found at %s — skipping.", path)
        return 0

    records: dict[str, UiDocumentRecord] = {}
    skipped = 0
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = UiDocumentRecord.model_validate_json(line)
            records[record.id] = record
        except Exception:
            skipped += 1
            logger.warning("Skipped malformed document JSONL line %d", lineno)

    if skipped:
        logger.warning("Skipped %d malformed document lines total", skipped)

    rows = [_document_to_row(record, inbox_id) for record in records.values()]
    _batch_insert(
        conn,
        "document",
        _DOCUMENT_COLUMNS,
        rows,
    )
    logger.info("Migrated %d documents (%d duplicates collapsed)", len(rows), skipped)
    return len(rows)


def _document_to_row(record: UiDocumentRecord, inbox_id: str) -> tuple:
    """Convert a UiDocumentRecord to a tuple matching _DOCUMENT_COLUMNS."""
    return (
        record.id,
        record.request_id,
        inbox_id,
        record.title,
        record.summary,
        record.mime_type,
        record.source_modality,
        record.kind,
        record.document_type,
        record.template,
        record.source_path,
        record.created_at,
        record.updated_at,
        record.classification.model_dump_json(),
        record.extraction.model_dump_json() if record.extraction else None,
        record.transcription.model_dump_json() if record.transcription else None,
        record.move_plan.model_dump_json() if record.move_plan else None,
        record.move_result.model_dump_json() if record.move_result else None,
        json.dumps(record.tags),
        record.status,
        record.undo_token,
        record.move_status,
        1 if record.retryable else 0,
        record.error_code,
        json.dumps(record.warnings),
        record.diagnostics.model_dump_json() if record.diagnostics else None,
        record.thumbnail_data,
    )


_DOCUMENT_COLUMNS = (
    "id", "request_id", "workspace_id", "title", "summary",
    "mime_type", "source_modality", "kind", "document_type", "template",
    "source_path", "created_at", "updated_at",
    "classification", "extraction", "transcription",
    "move_plan", "move_result", "tags", "status", "undo_token",
    "move_status", "retryable", "error_code", "warnings",
    "diagnostics", "thumbnail_data",
)


# ------------------------------------------------------------------
# Move history migration
# ------------------------------------------------------------------

def migrate_moves(conn: sqlite3.Connection, *, path: Path) -> int:
    """Read move_history.jsonl, deduplicate, and INSERT into move_history table."""
    if not path.exists():
        logger.info("No move history JSONL found at %s — skipping.", path)
        return 0

    entries: dict[str, MoveHistoryEntry] = {}
    skipped = 0
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            entry = MoveHistoryEntry.model_validate_json(line)
            entries[entry.undo_token] = entry
        except Exception:
            skipped += 1
            logger.warning("Skipped malformed move JSONL line %d", lineno)

    if skipped:
        logger.warning("Skipped %d malformed move lines total", skipped)

    rows = [_move_to_row(entry) for entry in entries.values()]
    _batch_insert(conn, "move_history", _MOVE_COLUMNS, rows)
    logger.info("Migrated %d move history entries", len(rows))
    return len(rows)


def _move_to_row(entry: MoveHistoryEntry) -> tuple:
    return (
        entry.undo_token,
        entry.request_id,
        entry.record_id,
        entry.client_id,
        entry.from_path,
        entry.to_path,
        entry.created_at,
        entry.executor,
        entry.finalized_at,
        entry.finalize_error,
        entry.undone_at,
    )


_MOVE_COLUMNS = (
    "undo_token", "request_id", "record_id", "client_id",
    "from_path", "to_path", "created_at", "executor",
    "finalized_at", "finalize_error", "undone_at",
)


# ------------------------------------------------------------------
# Engagement events migration
# ------------------------------------------------------------------

def migrate_events(conn: sqlite3.Connection, *, path: Path) -> int:
    """Read engagement_events.jsonl and INSERT into engagement_event table."""
    if not path.exists():
        logger.info("No engagement events JSONL found at %s — skipping.", path)
        return 0

    rows: list[tuple] = []
    skipped = 0
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            event = EngagementEventRecord.model_validate_json(line)
            rows.append((
                event.id,
                event.name,
                event.surface,
                event.timestamp,
                json.dumps(event.metadata),
            ))
        except Exception:
            skipped += 1
            logger.warning("Skipped malformed event JSONL line %d", lineno)

    if skipped:
        logger.warning("Skipped %d malformed event lines total", skipped)

    _batch_insert(conn, "engagement_event", _EVENT_COLUMNS, rows)
    logger.info("Migrated %d engagement events", len(rows))
    return len(rows)


_EVENT_COLUMNS = ("id", "name", "surface", "timestamp", "metadata")


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _batch_insert(
    conn: sqlite3.Connection,
    table: str,
    columns: tuple[str, ...],
    rows: list[tuple],
) -> None:
    """INSERT rows in batches inside a single transaction."""
    if not rows:
        return
    placeholders = ", ".join("?" for _ in columns)
    col_names = ", ".join(columns)
    sql = f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})"
    with conn:
        for i in range(0, len(rows), _BATCH_SIZE):
            conn.executemany(sql, rows[i : i + _BATCH_SIZE])


# ------------------------------------------------------------------
# CLI entry point
# ------------------------------------------------------------------

if __name__ == "__main__":
    from server.config import get_config

    logging.basicConfig(level=logging.INFO)
    config = get_config()
    run_migration(
        db_path=config.sqlite_db_path,
        documents_path=config.ui_documents_path,
        move_history_path=config.move_history_path,
        events_path=config.engagement_events_path,
    )
