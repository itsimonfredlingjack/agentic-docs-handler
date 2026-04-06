"""SQLite-backed persistence for workspace chat conversations."""
from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from uuid import uuid4


class ConversationRegistry:
    def __init__(self, *, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def save_entry(
        self,
        *,
        conversation_key: str,
        query: str,
        response: str,
        source_count: int = 0,
        sources: list[dict[str, str]] | None = None,
        error_message: str | None = None,
    ) -> str:
        """Persist a finalized chat entry.  Returns the entry id."""
        entry_id = str(uuid4())
        self._conn.execute(
            """
            INSERT INTO conversation_message
                (id, conversation_key, role, content, source_count, sources_json, error_message, created_at)
            VALUES (?, ?, 'entry', ?, ?, ?, ?, ?)
            """,
            (
                entry_id,
                conversation_key,
                json.dumps({"query": query, "response": response}),
                source_count,
                json.dumps(sources or []),
                error_message,
                datetime.now(UTC).isoformat(),
            ),
        )
        self._conn.commit()
        return entry_id

    def load_conversation(
        self,
        *,
        conversation_key: str,
        limit: int = 50,
    ) -> list[dict[str, object]]:
        """Load persisted entries for a conversation, oldest first."""
        rows = self._conn.execute(
            """
            SELECT id, content, source_count, sources_json, error_message, created_at
            FROM conversation_message
            WHERE conversation_key = ?
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (conversation_key, limit),
        ).fetchall()
        entries: list[dict[str, object]] = []
        for row in rows:
            row_id, content_json, source_count, sources_json, error_message, created_at = row
            content = json.loads(content_json)
            entries.append({
                "id": row_id,
                "query": content.get("query", ""),
                "response": content.get("response", ""),
                "sourceCount": source_count,
                "sources": json.loads(sources_json),
                "errorMessage": error_message,
                "timestamp": created_at,
            })
        return entries

    def list_recent_entries(
        self,
        *,
        conversation_key: str,
        limit: int = 20,
        exclude_ids: set[str] | None = None,
    ) -> list[dict[str, str]]:
        """Return recent entries as condensed summaries for memory injection."""
        rows = self._conn.execute(
            """
            SELECT id, content, created_at
            FROM conversation_message
            WHERE conversation_key = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (conversation_key, limit),
        ).fetchall()
        entries: list[dict[str, str]] = []
        for row in rows:
            row_id, content_json, created_at = row
            if exclude_ids and row_id in exclude_ids:
                continue
            content = json.loads(content_json)
            query = content.get("query", "")
            response = content.get("response", "")
            if not query or not response:
                continue
            entries.append({
                "id": row_id,
                "query": query,
                "response": response[:200],
                "timestamp": created_at,
            })
        entries.reverse()  # chronological order
        return entries

    def delete_conversation(self, *, conversation_key: str) -> int:
        """Delete all entries for a conversation.  Returns count deleted."""
        cursor = self._conn.execute(
            "DELETE FROM conversation_message WHERE conversation_key = ?",
            (conversation_key,),
        )
        self._conn.commit()
        return cursor.rowcount
