from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from uuid import uuid4

from server.schemas import (
    Workspace,
    WorkspaceResponse,
    WorkspaceListResponse,
)


def utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def _row_to_workspace(row: sqlite3.Row) -> Workspace:
    return Workspace(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        ai_brief=row["ai_brief"],
        ai_entities=json.loads(row["ai_entities"]) if row["ai_entities"] else [],
        ai_topics=json.loads(row["ai_topics"]) if row["ai_topics"] else [],
        cover_color=row["cover_color"],
        is_inbox=bool(row["is_inbox"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _workspace_to_response(ws: Workspace, *, file_count: int = 0) -> WorkspaceResponse:
    return WorkspaceResponse(
        id=ws.id,
        name=ws.name,
        description=ws.description,
        ai_brief=ws.ai_brief,
        ai_entities=ws.ai_entities,
        ai_topics=ws.ai_topics,
        cover_color=ws.cover_color,
        is_inbox=ws.is_inbox,
        file_count=file_count,
        created_at=ws.created_at,
        updated_at=ws.updated_at,
    )


class WorkspaceRegistry:
    def __init__(self, *, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def create_workspace(
        self,
        *,
        name: str,
        description: str = "",
        cover_color: str = "",
    ) -> Workspace:
        now = utcnow_iso()
        ws_id = str(uuid4())
        with self._conn:
            self._conn.execute(
                """
                INSERT INTO workspace (id, name, description, cover_color, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (ws_id, name, description, cover_color, now, now),
            )
        return self.get_workspace(workspace_id=ws_id)  # type: ignore[return-value]

    def get_workspace(self, *, workspace_id: str) -> Workspace | None:
        row = self._conn.execute(
            "SELECT * FROM workspace WHERE id = ?", (workspace_id,)
        ).fetchone()
        if row is None:
            return None
        return _row_to_workspace(row)

    def get_inbox(self) -> Workspace:
        row = self._conn.execute(
            "SELECT * FROM workspace WHERE is_inbox = 1"
        ).fetchone()
        if row is None:
            raise RuntimeError("Inbox workspace not found — database may not be initialized")
        return _row_to_workspace(row)

    def list_workspaces(self) -> WorkspaceListResponse:
        rows = self._conn.execute(
            """
            SELECT w.*, COALESCE(c.cnt, 0) AS file_count
            FROM workspace w
            LEFT JOIN (
                SELECT workspace_id, COUNT(*) AS cnt
                FROM document
                GROUP BY workspace_id
            ) c ON c.workspace_id = w.id
            ORDER BY w.is_inbox DESC, w.updated_at DESC
            """
        ).fetchall()

        workspaces = []
        for row in rows:
            ws = _row_to_workspace(row)
            workspaces.append(_workspace_to_response(ws, file_count=row["file_count"]))
        return WorkspaceListResponse(workspaces=workspaces)

    def update_workspace(
        self,
        *,
        workspace_id: str,
        name: str | None = None,
        description: str | None = None,
        cover_color: str | None = None,
        ai_brief: str | None = None,
        ai_entities: list[dict] | None = None,
        ai_topics: list[str] | None = None,
    ) -> Workspace:
        updates: list[str] = []
        params: list[object] = []

        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if description is not None:
            updates.append("description = ?")
            params.append(description)
        if cover_color is not None:
            updates.append("cover_color = ?")
            params.append(cover_color)
        if ai_brief is not None:
            updates.append("ai_brief = ?")
            params.append(ai_brief)
        if ai_entities is not None:
            updates.append("ai_entities = ?")
            params.append(json.dumps(ai_entities))
        if ai_topics is not None:
            updates.append("ai_topics = ?")
            params.append(json.dumps(ai_topics))

        if not updates:
            ws = self.get_workspace(workspace_id=workspace_id)
            if ws is None:
                raise KeyError("unknown_workspace_id")
            return ws

        updates.append("updated_at = ?")
        params.append(utcnow_iso())
        params.append(workspace_id)

        set_clause = ", ".join(updates)
        with self._conn:
            cursor = self._conn.execute(
                f"UPDATE workspace SET {set_clause} WHERE id = ?",
                params,
            )
        if cursor.rowcount == 0:
            raise KeyError("unknown_workspace_id")
        return self.get_workspace(workspace_id=workspace_id)  # type: ignore[return-value]

    def delete_workspace(self, *, workspace_id: str) -> None:
        ws = self.get_workspace(workspace_id=workspace_id)
        if ws is None:
            raise KeyError("unknown_workspace_id")
        if ws.is_inbox:
            raise ValueError("cannot_delete_inbox")

        inbox = self.get_inbox()
        with self._conn:
            self._conn.execute(
                "UPDATE document SET workspace_id = ? WHERE workspace_id = ?",
                (inbox.id, workspace_id),
            )
            self._conn.execute("DELETE FROM workspace WHERE id = ?", (workspace_id,))

    def move_files_to_workspace(
        self,
        *,
        file_ids: list[str],
        workspace_id: str,
    ) -> int:
        ws = self.get_workspace(workspace_id=workspace_id)
        if ws is None:
            raise KeyError("unknown_workspace_id")
        placeholders = ", ".join("?" for _ in file_ids)
        with self._conn:
            cursor = self._conn.execute(
                f"UPDATE document SET workspace_id = ? WHERE id IN ({placeholders})",
                [workspace_id, *file_ids],
            )
        return cursor.rowcount
