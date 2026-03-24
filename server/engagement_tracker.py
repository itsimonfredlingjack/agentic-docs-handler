from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from uuid import uuid4

from server.schemas import EngagementEventRecord


def utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


class EngagementTracker:
    def __init__(self, *, events_path: Path) -> None:
        self.events_path = Path(events_path)
        self.events_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()

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
        with self._lock:
            with self.events_path.open("a", encoding="utf-8") as handle:
                handle.write(event.model_dump_json())
                handle.write("\n")
        return event
