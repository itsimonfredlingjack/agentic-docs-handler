from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from uuid import uuid4

from pydantic import BaseModel

from server.schemas import (
    ActivityEvent,
    DocumentCountsResponse,
    DocumentListResponse,
    UiDocumentRecord,
    UndoMoveResponse,
)


def utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


class MoveHistoryEntry(BaseModel):
    undo_token: str
    request_id: str
    record_id: str
    client_id: str | None = None
    from_path: str
    to_path: str
    created_at: str
    undone_at: str | None = None


@dataclass(slots=True)
class UndoMoveResult:
    response: UndoMoveResponse
    record: UiDocumentRecord | None


class DocumentRegistry:
    def __init__(self, *, documents_path: Path, move_history_path: Path) -> None:
        self.documents_path = Path(documents_path)
        self.move_history_path = Path(move_history_path)
        self.documents_path.parent.mkdir(parents=True, exist_ok=True)
        self.move_history_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._documents: dict[str, UiDocumentRecord] = {}
        self._moves: dict[str, MoveHistoryEntry] = {}
        self._load_state()

    def _load_state(self) -> None:
        self._documents.clear()
        self._moves.clear()
        if self.documents_path.exists():
            for line in self.documents_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                record = UiDocumentRecord.model_validate_json(line)
                self._documents[record.id] = record
        if self.move_history_path.exists():
            for line in self.move_history_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                entry = MoveHistoryEntry.model_validate_json(line)
                self._moves[entry.undo_token] = entry

    def _append_jsonl(self, path: Path, payload: BaseModel) -> None:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(payload.model_dump_json())
            handle.write("\n")

    def upsert_document(self, record: UiDocumentRecord) -> UiDocumentRecord:
        with self._lock:
            self._documents[record.id] = record
            self._append_jsonl(self.documents_path, record)
        return record

    def list_documents(
        self,
        *,
        kind: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> DocumentListResponse:
        documents = sorted(
            self._documents.values(),
            key=lambda item: item.updated_at,
            reverse=True,
        )
        if kind and kind != "all":
            documents = [record for record in documents if self._matches_kind(record, kind)]
        total = len(documents)
        return DocumentListResponse(documents=documents[offset : offset + limit], total=total)

    def counts(self) -> DocumentCountsResponse:
        counts = DocumentCountsResponse(all=len(self._documents))
        for record in self._documents.values():
            if record.status not in {"ready", "completed"}:
                counts.processing += 1
            if record.kind == "receipt":
                counts.receipt += 1
            elif record.kind == "contract":
                counts.contract += 1
            elif record.kind == "invoice":
                counts.invoice += 1
            elif record.kind == "meeting_notes":
                counts.meeting_notes += 1
            elif record.kind == "audio":
                counts.audio += 1
            elif record.kind == "generic":
                counts.generic += 1
            if record.move_result is not None and record.move_result.success:
                counts.moved += 1
        return counts

    def list_activity(self, *, limit: int = 10) -> list[ActivityEvent]:
        events: list[ActivityEvent] = []
        for record in self._documents.values():
            events.append(
                ActivityEvent(
                    id=f"doc:{record.id}",
                    type="processed",
                    timestamp=record.updated_at,
                    title=record.title,
                    status="success" if record.status in {"ready", "completed"} else record.status,
                    kind=record.kind,
                    request_id=record.request_id,
                )
            )
        for entry in self._moves.values():
            events.append(
                ActivityEvent(
                    id=f"move:{entry.undo_token}",
                    type="file_moved",
                    timestamp=entry.created_at,
                    title=Path(entry.to_path).name,
                    status="success",
                    kind="file_moved",
                    request_id=entry.request_id,
                )
            )
            if entry.undone_at is not None:
                events.append(
                    ActivityEvent(
                        id=f"undo:{entry.undo_token}",
                        type="file_move_undone",
                        timestamp=entry.undone_at,
                        title=Path(entry.from_path).name,
                        status="success",
                        kind="file_moved",
                        request_id=entry.request_id,
                    )
                )
        events.sort(key=lambda item: item.timestamp, reverse=True)
        return events[:limit]

    def record_move(
        self,
        *,
        request_id: str,
        record_id: str,
        from_path: str,
        to_path: str,
        client_id: str | None = None,
    ) -> MoveHistoryEntry:
        entry = MoveHistoryEntry(
            undo_token=f"mv_{uuid4().hex}",
            request_id=request_id,
            record_id=record_id,
            client_id=client_id,
            from_path=from_path,
            to_path=to_path,
            created_at=utcnow_iso(),
        )
        with self._lock:
            self._moves[entry.undo_token] = entry
            self._append_jsonl(self.move_history_path, entry)
        return entry

    def undo_move(self, undo_token: str) -> UndoMoveResult:
        with self._lock:
            entry = self._moves.get(undo_token)
            if entry is None:
                raise KeyError("unknown_undo_token")
            if entry.undone_at is not None:
                raise ValueError("move_already_undone")
            shutil.move(entry.to_path, entry.from_path)
            updated_entry = entry.model_copy(update={"undone_at": utcnow_iso()})
            self._moves[undo_token] = updated_entry
            self._append_jsonl(self.move_history_path, updated_entry)

            record = self._documents.get(entry.record_id)
            updated_record: UiDocumentRecord | None = None
            if record is not None:
                updated_record = record.model_copy(
                    update={
                        "source_path": entry.from_path,
                        "updated_at": utcnow_iso(),
                        "undo_token": None,
                    }
                )
                self._documents[updated_record.id] = updated_record
                self._append_jsonl(self.documents_path, updated_record)

        return UndoMoveResult(
            response=UndoMoveResponse(
                success=True,
                from_path=entry.to_path,
                to_path=entry.from_path,
                request_id=f"undo_{entry.request_id}",
            ),
            record=updated_record,
        )

    @staticmethod
    def _matches_kind(record: UiDocumentRecord, kind: str) -> bool:
        if kind == "processing":
            return record.status not in {"ready", "completed"}
        if kind == "moved":
            return record.move_result is not None and record.move_result.success
        return record.kind == kind
