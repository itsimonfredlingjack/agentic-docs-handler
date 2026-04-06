"""Workspace timeline event persistence.

Records meaningful workspace history events — document additions, brief updates,
manual reorganization — so that workspaces feel like active project spaces rather
than passive folders.
"""
from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from uuid import uuid4


def utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


class WorkspaceEventLog:
    def __init__(self, *, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def emit(
        self,
        *,
        workspace_id: str,
        event_type: str,
        title: str,
        detail: str = "",
    ) -> str:
        """Record a workspace timeline event.  Returns the event id."""
        event_id = str(uuid4())
        self._conn.execute(
            """
            INSERT INTO workspace_event (id, workspace_id, event_type, title, detail, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (event_id, workspace_id, event_type, title, detail, utcnow_iso()),
        )
        self._conn.commit()
        return event_id

    def list_events(
        self,
        *,
        workspace_id: str,
        limit: int = 20,
    ) -> list[dict[str, str]]:
        """Return timeline events for a workspace, newest first."""
        rows = self._conn.execute(
            """
            SELECT id, event_type, title, detail, created_at
            FROM workspace_event
            WHERE workspace_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (workspace_id, limit),
        ).fetchall()
        return [
            {
                "id": row[0],
                "event_type": row[1],
                "title": row[2],
                "detail": row[3],
                "created_at": row[4],
            }
            for row in rows
        ]

    def delete_workspace_events(self, *, workspace_id: str) -> int:
        """Delete all events for a workspace.  Returns count deleted."""
        cursor = self._conn.execute(
            "DELETE FROM workspace_event WHERE workspace_id = ?",
            (workspace_id,),
        )
        self._conn.commit()
        return cursor.rowcount
