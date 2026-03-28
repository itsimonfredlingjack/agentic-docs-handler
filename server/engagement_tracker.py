from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from uuid import uuid4

from server.schemas import EngagementEventRecord


def utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


class EngagementTracker:
    def __init__(self, *, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def record_event(
        self,
        *,
        name: str,
        surface: str,
        metadata: dict[str, object] | None = None,
    ) -> EngagementEventRecord:
        event = EngagementEventRecord(
            id=f"evt-{uuid4()}",
            name=name,
            surface=surface,
            timestamp=utcnow_iso(),
            metadata=metadata or {},
        )
        with self._conn:
            self._conn.execute(
                """
                INSERT INTO engagement_event (id, name, surface, timestamp, metadata)
                VALUES (?, ?, ?, ?, ?)
                """,
                (event.id, event.name, event.surface, event.timestamp, json.dumps(event.metadata)),
            )
        return event
