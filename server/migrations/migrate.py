"""Version-tracked schema migration runner.

Each migration is a numbered function that receives a sqlite3.Connection.
Migrations are applied in order. The current version is stored in
``schema_version``.  On a fresh database the base DDL (schema.sql) is
applied first, which creates all v1 tables plus the version table.

Existing databases that pre-date versioning (v1 schema exists but no
``schema_version`` table) are detected and bootstrapped at version 1.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_SCHEMA_PATH = Path(__file__).parent / "schema.sql"


# ------------------------------------------------------------------
# Version helpers
# ------------------------------------------------------------------

def _version_table_exists(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).fetchone()
    return row is not None and row[0] > 0


def _v1_schema_exists(conn: sqlite3.Connection) -> bool:
    """Return True if the pre-versioning v1 schema is present."""
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='workspace'"
        ).fetchone()
        return row is not None and row[0] > 0
    except sqlite3.OperationalError:
        return False


def get_schema_version(conn: sqlite3.Connection) -> int:
    """Return the current schema version, or 0 if no schema exists."""
    if not _version_table_exists(conn):
        if _v1_schema_exists(conn):
            return 1  # pre-versioning database
        return 0  # blank database
    row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
    version = row[0] if row and row[0] is not None else 0
    # Handle edge case: version table exists but empty, and v1 schema is present
    if version == 0 and _v1_schema_exists(conn):
        return 1
    return version


def _record_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
        (version, datetime.now(UTC).isoformat()),
    )


# ------------------------------------------------------------------
# Migration functions
# ------------------------------------------------------------------

def _migrate_v1(conn: sqlite3.Connection) -> None:
    """Apply base schema from schema.sql (fresh database only)."""
    ddl = _SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(ddl)


def _migrate_v2(conn: sqlite3.Connection) -> None:
    """Add conversation_message table for persisted workspace chat."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS conversation_message (
            id TEXT PRIMARY KEY,
            conversation_key TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            source_count INTEGER NOT NULL DEFAULT 0,
            sources_json TEXT NOT NULL DEFAULT '[]',
            error_message TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_convmsg_key
            ON conversation_message(conversation_key, created_at);
    """)


def _migrate_v3(conn: sqlite3.Connection) -> None:
    """Add workspace_event table for workspace timeline."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS workspace_event (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            title TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ws_event_timeline
            ON workspace_event(workspace_id, created_at DESC);
    """)


# Ordered list: (version_number, migration_function)
_MIGRATIONS: list[tuple[int, callable]] = [
    (1, _migrate_v1),
    (2, _migrate_v2),
    (3, _migrate_v3),
]

LATEST_VERSION = _MIGRATIONS[-1][0]


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

def ensure_schema(conn: sqlite3.Connection) -> int:
    """Bring the database to the latest schema version.

    Returns the final version number.
    """
    current = get_schema_version(conn)
    if current >= LATEST_VERSION:
        logger.info("Schema at version %d — up to date", current)
        return current

    logger.info("Schema at version %d — applying migrations to %d", current, LATEST_VERSION)

    # Bootstrap the version table if upgrading from pre-versioning v1
    if current >= 1 and not _version_table_exists(conn):
        conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
        """)
        _record_version(conn, 1)
        conn.commit()

    for version, migrate_fn in _MIGRATIONS:
        if version <= current:
            continue
        logger.info("Applying migration v%d", version)
        migrate_fn(conn)
        # v1 creates the version table as part of schema.sql
        if version == 1 and not _version_table_exists(conn):
            # schema.sql didn't create it yet — it's a base DDL without version table
            # This path shouldn't happen with the updated schema.sql, but guard anyway
            conn.execute("""
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                )
            """)
        _record_version(conn, version)
        conn.commit()
        logger.info("Migration v%d complete", version)

    return LATEST_VERSION
