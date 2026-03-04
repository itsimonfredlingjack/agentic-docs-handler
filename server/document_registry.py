from __future__ import annotations

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
    FinalizeMoveResponse,
    MoveResult,
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
    executor: str = "server"
    finalized_at: str | None = None
    finalize_error: str | None = None
    undone_at: str | None = None


@dataclass(slots=True)
class UndoMoveResult:
    response: UndoMoveResponse
    record: UiDocumentRecord | None


@dataclass(slots=True)
class FinalizeMoveResult:
    response: FinalizeMoveResponse
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

    def _snapshot_documents(self) -> list[UiDocumentRecord]:
        with self._lock:
            return list(self._documents.values())

    def _snapshot_moves(self) -> list[MoveHistoryEntry]:
        with self._lock:
            return list(self._moves.values())

    def upsert_document(self, record: UiDocumentRecord) -> UiDocumentRecord:
        with self._lock:
            self._documents[record.id] = record
            self._append_jsonl(self.documents_path, record)
        return record

    def mark_document_failed(
        self,
        *,
        record_id: str,
        request_id: str,
        error_code: str | None,
        message: str,
    ) -> UiDocumentRecord | None:
        with self._lock:
            record = self._documents.get(record_id)
            if record is None:
                return None
            updated = record.model_copy(
                update={
                    "status": "failed",
                    "summary": message,
                    "updated_at": utcnow_iso(),
                    "error_code": error_code,
                    "retryable": True if error_code in {"ollama_timeout", "ollama_unavailable", "whisper_unavailable"} else False,
                    "move_status": "move_failed",
                }
            )
            self._documents[record_id] = updated
            self._append_jsonl(self.documents_path, updated)
        return updated

    def list_documents(
        self,
        *,
        kind: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> DocumentListResponse:
        documents = sorted(
            self._snapshot_documents(),
            key=lambda item: item.updated_at,
            reverse=True,
        )
        if kind and kind != "all":
            documents = [record for record in documents if self._matches_kind(record, kind)]
        total = len(documents)
        return DocumentListResponse(documents=documents[offset : offset + limit], total=total)

    def counts(self) -> DocumentCountsResponse:
        counts = DocumentCountsResponse()
        documents = self._snapshot_documents()
        counts.all = len(documents)
        for record in documents:
            if record.status not in {"ready", "completed"} or record.move_status == "awaiting_confirmation":
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
            if record.move_status == "moved" or (record.move_result is not None and record.move_result.success):
                counts.moved += 1
        return counts

    def list_activity(self, *, limit: int = 10) -> list[ActivityEvent]:
        events: list[ActivityEvent] = []
        for record in self._snapshot_documents():
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
        for entry in self._snapshot_moves():
            events.append(
                ActivityEvent(
                    id=f"move:{entry.undo_token}",
                    type="file_moved",
                    timestamp=entry.finalized_at or entry.created_at,
                    title=Path(entry.to_path).name,
                    status="success" if entry.finalize_error is None else "failed",
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
        executor: str = "server",
    ) -> MoveHistoryEntry:
        entry = self._build_move_entry(
            request_id=request_id,
            record_id=record_id,
            from_path=from_path,
            to_path=to_path,
            client_id=client_id,
            executor=executor,
            finalized=executor == "server",
        )
        with self._lock:
            self._moves[entry.undo_token] = entry
            self._append_jsonl(self.move_history_path, entry)
        return entry

    def finalize_client_move(
        self,
        *,
        record_id: str,
        request_id: str,
        client_id: str | None,
        from_path: str,
        to_path: str,
        success: bool,
        error: str | None = None,
    ) -> FinalizeMoveResult:
        with self._lock:
            record = self._documents.get(record_id)
            if record is None:
                raise KeyError("unknown_record_id")
            if success:
                move_entry = self._build_move_entry(
                    request_id=request_id,
                    record_id=record_id,
                    from_path=from_path,
                    to_path=to_path,
                    client_id=client_id,
                    executor="client",
                    finalized=True,
                )
                self._moves[move_entry.undo_token] = move_entry
                self._append_jsonl(self.move_history_path, move_entry)
                updated_record = record.model_copy(
                    update={
                        "source_path": to_path,
                        "updated_at": utcnow_iso(),
                        "undo_token": move_entry.undo_token,
                        "move_status": "moved",
                        "status": "completed",
                        "move_result": MoveResult(
                            attempted=True,
                            success=True,
                            from_path=from_path,
                            to_path=to_path,
                            error=None,
                        ),
                    }
                )
                self._documents[record_id] = updated_record
                self._append_jsonl(self.documents_path, updated_record)
                return FinalizeMoveResult(
                    response=FinalizeMoveResponse(
                        success=True,
                        record_id=record_id,
                        request_id=request_id,
                        from_path=from_path,
                        to_path=to_path,
                        undo_token=move_entry.undo_token,
                        move_status="moved",
                    ),
                    record=updated_record,
                )

            updated_record = record.model_copy(
                update={
                    "updated_at": utcnow_iso(),
                    "status": "failed",
                    "move_status": "move_failed",
                    "error_code": "move_failed",
                    "move_result": MoveResult(
                        attempted=True,
                        success=False,
                        from_path=from_path,
                        to_path=to_path,
                        error=error or "move_failed",
                    ),
                }
            )
            self._documents[record_id] = updated_record
            self._append_jsonl(self.documents_path, updated_record)
            return FinalizeMoveResult(
                response=FinalizeMoveResponse(
                    success=False,
                    record_id=record_id,
                    request_id=request_id,
                    from_path=from_path,
                    to_path=to_path,
                    undo_token=None,
                    move_status="move_failed",
                ),
                record=updated_record,
            )

    def complete_client_undo(
        self,
        *,
        undo_token: str,
        from_path: str,
        to_path: str,
        success: bool,
        error: str | None = None,
    ) -> UndoMoveResult:
        with self._lock:
            entry = self._moves.get(undo_token)
            if entry is None:
                raise KeyError("unknown_undo_token")
            if entry.undone_at is not None:
                raise ValueError("move_already_undone")
            if not success:
                raise ValueError(error or "undo_failed")

            updated_entry = entry.model_copy(update={"undone_at": utcnow_iso()})
            self._moves[undo_token] = updated_entry
            self._append_jsonl(self.move_history_path, updated_entry)

            record = self._documents.get(entry.record_id)
            updated_record: UiDocumentRecord | None = None
            if record is not None:
                updated_record = record.model_copy(
                    update={
                        "source_path": to_path,
                        "updated_at": utcnow_iso(),
                        "undo_token": None,
                        "move_status": "undone",
                        "move_result": MoveResult(
                            attempted=True,
                            success=True,
                            from_path=from_path,
                            to_path=to_path,
                            error=None,
                        ),
                    }
                )
                self._documents[updated_record.id] = updated_record
                self._append_jsonl(self.documents_path, updated_record)

        return UndoMoveResult(
            response=UndoMoveResponse(
                success=True,
                from_path=from_path,
                to_path=to_path,
                request_id=f"undo_{entry.request_id}",
                record_id=entry.record_id,
            ),
            record=updated_record,
        )

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
                        "move_status": "undone",
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
                record_id=entry.record_id,
            ),
            record=updated_record,
        )

    @staticmethod
    def _matches_kind(record: UiDocumentRecord, kind: str) -> bool:
        if kind == "processing":
            return record.status not in {"ready", "completed"} or record.move_status == "awaiting_confirmation"
        if kind == "moved":
            return record.move_status == "moved"
        return record.kind == kind

    @staticmethod
    def _build_move_entry(
        *,
        request_id: str,
        record_id: str,
        from_path: str,
        to_path: str,
        client_id: str | None,
        executor: str,
        finalized: bool,
    ) -> MoveHistoryEntry:
        return MoveHistoryEntry(
            undo_token=f"mv_{uuid4().hex}",
            request_id=request_id,
            record_id=record_id,
            client_id=client_id,
            from_path=from_path,
            to_path=to_path,
            created_at=utcnow_iso(),
            executor=executor,
            finalized_at=utcnow_iso() if finalized else None,
        )
