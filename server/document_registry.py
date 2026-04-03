from __future__ import annotations

import json
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
import re
from uuid import uuid4

from server.schemas import (
    ActivityEvent,
    DocumentClassification,
    DocumentCountsResponse,
    DocumentListResponse,
    DismissMoveResponse,
    ExtractedEntity,
    ExtractionResult,
    FinalizeMoveResponse,
    MovePlan,
    MoveResult,
    ProcessDiagnostics,
    TranscriptionResponse,
    UiDocumentRecord,
    UndoMoveResponse,
)

from pydantic import BaseModel


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
    executor: str = "client"
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


@dataclass(slots=True)
class DismissMoveResult:
    response: DismissMoveResponse
    record: UiDocumentRecord | None


# ------------------------------------------------------------------
# SQL constants
# ------------------------------------------------------------------

_DOCUMENT_COLUMNS = (
    "id", "request_id", "workspace_id", "title", "summary",
    "mime_type", "source_modality", "kind", "document_type", "template",
    "source_path", "created_at", "updated_at",
    "classification", "extraction", "transcription",
    "move_plan", "move_result", "tags", "status", "undo_token",
    "move_status", "retryable", "error_code", "warnings",
    "diagnostics", "thumbnail_data",
)

_DOCUMENT_PLACEHOLDERS = ", ".join("?" for _ in _DOCUMENT_COLUMNS)
_DOCUMENT_COL_NAMES = ", ".join(_DOCUMENT_COLUMNS)
_UPSERT_SQL = (
    f"INSERT OR REPLACE INTO document ({_DOCUMENT_COL_NAMES}) "
    f"VALUES ({_DOCUMENT_PLACEHOLDERS})"
)


# ------------------------------------------------------------------
# Serialization helpers
# ------------------------------------------------------------------

def _row_to_record(row: sqlite3.Row) -> UiDocumentRecord:
    """Deserialize a SQLite row into a UiDocumentRecord."""

    def _parse_optional_model(json_str: str | None, model_cls: type[BaseModel]) -> BaseModel | None:
        if json_str is None:
            return None
        return model_cls.model_validate_json(json_str)

    return UiDocumentRecord(
        id=row["id"],
        request_id=row["request_id"],
        workspace_id=row["workspace_id"],
        title=row["title"],
        summary=row["summary"],
        mime_type=row["mime_type"],
        source_modality=row["source_modality"],
        kind=row["kind"],
        document_type=row["document_type"],
        template=row["template"],
        source_path=row["source_path"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        classification=DocumentClassification.model_validate_json(row["classification"]),
        extraction=_parse_optional_model(row["extraction"], ExtractionResult),
        transcription=_parse_optional_model(row["transcription"], TranscriptionResponse),
        move_plan=_parse_optional_model(row["move_plan"], MovePlan),
        move_result=_parse_optional_model(row["move_result"], MoveResult),
        tags=json.loads(row["tags"]) if row["tags"] else [],
        status=row["status"],
        undo_token=row["undo_token"],
        move_status=row["move_status"],
        retryable=bool(row["retryable"]),
        error_code=row["error_code"],
        warnings=json.loads(row["warnings"]) if row["warnings"] else [],
        diagnostics=_parse_optional_model(row["diagnostics"], ProcessDiagnostics),
        thumbnail_data=row["thumbnail_data"],
    )


def _record_to_params(record: UiDocumentRecord, *, workspace_id: str | None = None) -> tuple:
    """Serialize a UiDocumentRecord to a tuple for SQL binding."""
    return (
        record.id,
        record.request_id,
        workspace_id,
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


# ------------------------------------------------------------------
# DocumentRegistry (SQLite-backed)
# ------------------------------------------------------------------

class DocumentRegistry:
    def __init__(self, *, db_path: Path) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(
            str(self._db_path),
            check_same_thread=False,
        )
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA busy_timeout = 5000")
        self._conn.row_factory = sqlite3.Row

    @property
    def conn(self) -> sqlite3.Connection:
        return self._conn

    def close(self) -> None:
        self._conn.close()

    # ------------------------------------------------------------------
    # Entity persistence
    # ------------------------------------------------------------------

    def upsert_entities(
        self,
        *,
        file_id: str,
        entities: list[ExtractedEntity],
    ) -> int:
        """Store extracted entities and link them to a document.

        Uses INSERT OR IGNORE for the entity table (dedup by name+type)
        and INSERT OR REPLACE for file_entity (updates context on re-extraction).
        Returns the number of entity links written.
        """
        if not entities:
            return 0
        with self._conn:
            for entity in entities:
                entity_id = f"ent-{uuid4().hex[:12]}"
                # Insert entity if not already present (UNIQUE on name, entity_type)
                self._conn.execute(
                    """
                    INSERT OR IGNORE INTO entity (id, name, entity_type)
                    VALUES (?, ?, ?)
                    """,
                    (entity_id, entity.name, entity.entity_type),
                )
                # Look up the canonical entity id (may differ from ours if already existed)
                row = self._conn.execute(
                    "SELECT id FROM entity WHERE name = ? AND entity_type = ?",
                    (entity.name, entity.entity_type),
                ).fetchone()
                if row is None:
                    continue
                canonical_id = row["id"]
                self._conn.execute(
                    """
                    INSERT OR REPLACE INTO file_entity (file_id, entity_id, context)
                    VALUES (?, ?, ?)
                    """,
                    (file_id, canonical_id, entity.context),
                )
        return len(entities)

    def get_entities_for_document(self, *, record_id: str) -> list[dict[str, str]]:
        """Return entities linked to a document as dicts with name, entity_type, context."""
        rows = self._conn.execute(
            """
            SELECT e.name, e.entity_type, fe.context
            FROM file_entity fe
            JOIN entity e ON e.id = fe.entity_id
            WHERE fe.file_id = ?
            ORDER BY e.entity_type, e.name
            """,
            (record_id,),
        ).fetchall()
        return [
            {"name": row["name"], "entity_type": row["entity_type"], "context": row["context"]}
            for row in rows
        ]

    # ------------------------------------------------------------------
    # Document CRUD
    # ------------------------------------------------------------------

    def delete_document(self, *, record_id: str) -> str | None:
        """Delete a document and all related records. Returns source_path if it existed."""
        row = self.conn.execute(
            "SELECT source_path FROM document WHERE id = ?", (record_id,)
        ).fetchone()
        if row is None:
            return None
        source_path = row["source_path"]
        self.conn.execute("DELETE FROM file_entity WHERE file_id = ?", (record_id,))
        self.conn.execute("DELETE FROM move_history WHERE record_id = ?", (record_id,))
        self.conn.execute(
            "DELETE FROM file_relation WHERE file_a_id = ? OR file_b_id = ?",
            (record_id, record_id),
        )
        self.conn.execute("DELETE FROM document WHERE id = ?", (record_id,))
        self.conn.commit()
        return source_path

    def get_document(self, *, record_id: str) -> UiDocumentRecord | None:
        row = self._conn.execute(
            "SELECT * FROM document WHERE id = ?", (record_id,)
        ).fetchone()
        if row is None:
            return None
        return _row_to_record(row)

    def upsert_document(
        self,
        record: UiDocumentRecord,
        *,
        workspace_id: str | None = None,
    ) -> UiDocumentRecord:
        record = self._normalize_record_debug_fields(record)
        if workspace_id is not None:
            # Caller explicitly sets workspace (e.g. workspace suggestion pipeline)
            ws_id = workspace_id
        else:
            # Preserve existing workspace_id on update; default to inbox on first insert
            existing = self._conn.execute(
                "SELECT workspace_id FROM document WHERE id = ?", (record.id,)
            ).fetchone()
            if existing is not None:
                ws_id = existing["workspace_id"]
            else:
                ws_id = self._get_inbox_id()
        params = _record_to_params(record, workspace_id=ws_id)
        with self._conn:
            self._conn.execute(_UPSERT_SQL, params)
        return record

    def _get_inbox_id(self) -> str | None:
        """Return the inbox workspace id, or None if not yet created."""
        row = self._conn.execute(
            "SELECT id FROM workspace WHERE is_inbox = 1"
        ).fetchone()
        return row["id"] if row else None

    def mark_document_failed(
        self,
        *,
        record_id: str,
        request_id: str,
        error_code: str | None,
        message: str,
    ) -> UiDocumentRecord | None:
        now = utcnow_iso()
        retryable = 1 if error_code in {"ollama_timeout", "ollama_unavailable", "whisper_unavailable"} else 0
        with self._conn:
            self._conn.execute(
                """
                UPDATE document SET
                    status = 'failed',
                    summary = ?,
                    updated_at = ?,
                    error_code = ?,
                    retryable = ?,
                    move_status = 'move_failed'
                WHERE id = ?
                """,
                (message, now, error_code, retryable, record_id),
            )
        return self.get_document(record_id=record_id)

    def list_documents_by_workspace(
        self,
        *,
        workspace_id: str,
        limit: int = 200,
    ) -> list[UiDocumentRecord]:
        """Return documents belonging to a workspace, ordered by updated_at DESC."""
        rows = self._conn.execute(
            "SELECT * FROM document WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?",
            (workspace_id, limit),
        ).fetchall()
        return [_row_to_record(row) for row in rows]

    def list_documents(
        self,
        *,
        kind: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> DocumentListResponse:
        if kind and kind != "all":
            if kind == "processing":
                where = (
                    "WHERE (status NOT IN ('ready', 'completed') "
                    "OR move_status = 'awaiting_confirmation')"
                )
                params: tuple = ()
            elif kind == "moved":
                where = "WHERE move_status = 'moved'"
                params = ()
            else:
                where = "WHERE kind = ?"
                params = (kind,)
        else:
            where = ""
            params = ()

        total_row = self._conn.execute(
            f"SELECT COUNT(*) FROM document {where}", params
        ).fetchone()
        total = total_row[0] if total_row else 0

        rows = self._conn.execute(
            f"SELECT * FROM document {where} ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (*params, limit, offset),
        ).fetchall()

        documents = [_row_to_record(row) for row in rows]
        return DocumentListResponse(documents=documents, total=total)

    def counts(self) -> DocumentCountsResponse:
        rows = self._conn.execute(
            """
            SELECT
                kind, status, move_status,
                CASE WHEN move_result IS NOT NULL
                     AND json_extract(move_result, '$.success') = 1
                     THEN 1 ELSE 0 END AS move_success,
                COUNT(*) AS cnt
            FROM document
            GROUP BY kind, status, move_status, move_success
            """
        ).fetchall()

        counts = DocumentCountsResponse()
        for row in rows:
            n = row["cnt"]
            counts.all += n

            if row["status"] not in ("ready", "completed") or row["move_status"] == "awaiting_confirmation":
                counts.processing += n

            kind = row["kind"]
            if kind == "receipt":
                counts.receipt += n
            elif kind == "contract":
                counts.contract += n
            elif kind == "invoice":
                counts.invoice += n
            elif kind == "meeting_notes":
                counts.meeting_notes += n
            elif kind == "audio":
                counts.audio += n
            elif kind == "generic":
                counts.generic += n

            if row["move_status"] == "moved" or row["move_success"]:
                counts.moved += n

        return counts

    def list_activity(self, *, limit: int = 10) -> list[ActivityEvent]:
        doc_rows = self._conn.execute(
            """
            SELECT id, request_id, title, kind, status, updated_at,
                   diagnostics
            FROM document
            ORDER BY updated_at DESC
            """
        ).fetchall()

        events: list[ActivityEvent] = []
        for row in doc_rows:
            debug_payload: dict[str, object] | None = None
            if row["diagnostics"]:
                diag = json.loads(row["diagnostics"])
                debug_payload = {}
                if diag.get("pipeline_flags"):
                    debug_payload["pipeline_flags"] = diag["pipeline_flags"]
                if diag.get("fallback_reason"):
                    debug_payload["fallback_reason"] = diag["fallback_reason"]
                if not debug_payload:
                    debug_payload = None

            events.append(
                ActivityEvent(
                    id=f"doc:{row['id']}",
                    type="processed",
                    timestamp=row["updated_at"],
                    title=row["title"],
                    status="success" if row["status"] in ("ready", "completed") else row["status"],
                    kind=row["kind"],
                    request_id=row["request_id"],
                    debug=debug_payload,
                )
            )

        move_rows = self._conn.execute(
            """
            SELECT undo_token, request_id, from_path, to_path,
                   created_at, finalized_at, finalize_error, undone_at
            FROM move_history
            ORDER BY created_at DESC
            """
        ).fetchall()

        for row in move_rows:
            events.append(
                ActivityEvent(
                    id=f"move:{row['undo_token']}",
                    type="file_moved",
                    timestamp=row["finalized_at"] or row["created_at"],
                    title=Path(row["to_path"]).name,
                    status="success" if row["finalize_error"] is None else "failed",
                    kind="file_moved",
                    request_id=row["request_id"],
                )
            )
            if row["undone_at"] is not None:
                events.append(
                    ActivityEvent(
                        id=f"undo:{row['undo_token']}",
                        type="file_move_undone",
                        timestamp=row["undone_at"],
                        title=Path(row["from_path"]).name,
                        status="success",
                        kind="file_moved",
                        request_id=row["request_id"],
                    )
                )

        events.sort(key=lambda item: item.timestamp, reverse=True)
        return events[:limit]

    # ------------------------------------------------------------------
    # Move management
    # ------------------------------------------------------------------

    def record_move(
        self,
        *,
        request_id: str,
        record_id: str,
        from_path: str,
        to_path: str,
        client_id: str | None = None,
        executor: str = "client",
    ) -> MoveHistoryEntry:
        entry = self._build_move_entry(
            request_id=request_id,
            record_id=record_id,
            from_path=from_path,
            to_path=to_path,
            client_id=client_id,
            executor=executor,
            finalized=False,
        )
        with self._conn:
            self._conn.execute(
                """
                INSERT INTO move_history
                    (undo_token, request_id, record_id, client_id, from_path, to_path,
                     created_at, executor, finalized_at, finalize_error, undone_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry.undo_token, entry.request_id, entry.record_id,
                    entry.client_id, entry.from_path, entry.to_path,
                    entry.created_at, entry.executor, entry.finalized_at,
                    entry.finalize_error, entry.undone_at,
                ),
            )
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
        record = self.get_document(record_id=record_id)
        if record is None:
            raise KeyError("unknown_record_id")

        now = utcnow_iso()

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
            updated_record = record.model_copy(
                update={
                    "source_path": to_path,
                    "updated_at": now,
                    "undo_token": move_entry.undo_token,
                    "move_status": "moved",
                    "status": "completed",
                    "move_result": MoveResult(
                        attempted=True, success=True,
                        from_path=from_path, to_path=to_path,
                    ),
                }
            )
            with self._conn:
                self._conn.execute(
                    """
                    INSERT INTO move_history
                        (undo_token, request_id, record_id, client_id, from_path, to_path,
                         created_at, executor, finalized_at, finalize_error, undone_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        move_entry.undo_token, move_entry.request_id, move_entry.record_id,
                        move_entry.client_id, move_entry.from_path, move_entry.to_path,
                        move_entry.created_at, move_entry.executor, move_entry.finalized_at,
                        move_entry.finalize_error, move_entry.undone_at,
                    ),
                )
                existing_ws = self._conn.execute(
                    "SELECT workspace_id FROM document WHERE id = ?", (record_id,)
                ).fetchone()
                ws_id = existing_ws["workspace_id"] if existing_ws else None
                self._conn.execute(_UPSERT_SQL, _record_to_params(updated_record, workspace_id=ws_id))

            return FinalizeMoveResult(
                response=FinalizeMoveResponse(
                    success=True, record_id=record_id, request_id=request_id,
                    from_path=from_path, to_path=to_path,
                    undo_token=move_entry.undo_token, move_status="moved",
                ),
                record=updated_record,
            )

        # Failure path
        updated_record = record.model_copy(
            update={
                "updated_at": now,
                "status": "failed",
                "move_status": "move_failed",
                "error_code": "move_failed",
                "move_result": MoveResult(
                    attempted=True, success=False,
                    from_path=from_path, to_path=to_path,
                    error=error or "move_failed",
                ),
            }
        )
        existing_ws = self._conn.execute(
            "SELECT workspace_id FROM document WHERE id = ?", (record_id,)
        ).fetchone()
        ws_id = existing_ws["workspace_id"] if existing_ws else None
        with self._conn:
            self._conn.execute(_UPSERT_SQL, _record_to_params(updated_record, workspace_id=ws_id))

        return FinalizeMoveResult(
            response=FinalizeMoveResponse(
                success=False, record_id=record_id, request_id=request_id,
                from_path=from_path, to_path=to_path,
                undo_token=None, move_status="move_failed",
            ),
            record=updated_record,
        )

    def dismiss_pending_move(
        self,
        *,
        record_id: str,
        request_id: str,
        client_id: str | None,
    ) -> DismissMoveResult:
        del client_id
        record = self.get_document(record_id=record_id)
        if record is None:
            raise KeyError("unknown_record_id")
        if record.move_status != "awaiting_confirmation":
            raise ValueError("move_not_pending_confirmation")

        now = utcnow_iso()
        with self._conn:
            self._conn.execute(
                """
                UPDATE document SET
                    move_status = 'not_requested',
                    status = 'completed',
                    updated_at = ?
                WHERE id = ?
                """,
                (now, record_id),
            )

        updated_record = record.model_copy(
            update={
                "updated_at": now,
                "move_status": "not_requested",
                "status": "completed",
            }
        )
        return DismissMoveResult(
            response=DismissMoveResponse(
                success=True, record_id=record_id,
                request_id=request_id, move_status="not_requested",
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
        entry_row = self._conn.execute(
            "SELECT * FROM move_history WHERE undo_token = ?", (undo_token,)
        ).fetchone()
        if entry_row is None:
            raise KeyError("unknown_undo_token")
        if entry_row["undone_at"] is not None:
            raise ValueError("move_already_undone")
        if not success:
            raise ValueError(error or "undo_failed")

        now = utcnow_iso()
        with self._conn:
            self._conn.execute(
                "UPDATE move_history SET undone_at = ? WHERE undo_token = ?",
                (now, undo_token),
            )
            self._conn.execute(
                """
                UPDATE document SET
                    source_path = ?,
                    updated_at = ?,
                    undo_token = NULL,
                    move_status = 'undone',
                    move_result = ?
                WHERE id = ?
                """,
                (
                    to_path, now,
                    MoveResult(
                        attempted=True, success=True,
                        from_path=from_path, to_path=to_path,
                    ).model_dump_json(),
                    entry_row["record_id"],
                ),
            )

        updated_record = self.get_document(record_id=entry_row["record_id"])
        return UndoMoveResult(
            response=UndoMoveResponse(
                success=True, from_path=from_path, to_path=to_path,
                request_id=f"undo_{entry_row['request_id']}",
                record_id=entry_row["record_id"],
            ),
            record=updated_record,
        )

    def undo_move(self, undo_token: str) -> UndoMoveResult:
        entry_row = self._conn.execute(
            "SELECT * FROM move_history WHERE undo_token = ?", (undo_token,)
        ).fetchone()
        if entry_row is None:
            raise KeyError("unknown_undo_token")
        if entry_row["undone_at"] is not None:
            raise ValueError("move_already_undone")

        shutil.move(entry_row["to_path"], entry_row["from_path"])

        now = utcnow_iso()
        with self._conn:
            self._conn.execute(
                "UPDATE move_history SET undone_at = ? WHERE undo_token = ?",
                (now, undo_token),
            )
            self._conn.execute(
                """
                UPDATE document SET
                    source_path = ?,
                    updated_at = ?,
                    undo_token = NULL,
                    move_status = 'undone'
                WHERE id = ?
                """,
                (entry_row["from_path"], now, entry_row["record_id"]),
            )

        updated_record = self.get_document(record_id=entry_row["record_id"])
        return UndoMoveResult(
            response=UndoMoveResponse(
                success=True,
                from_path=entry_row["to_path"],
                to_path=entry_row["from_path"],
                request_id=f"undo_{entry_row['request_id']}",
                record_id=entry_row["record_id"],
            ),
            record=updated_record,
        )

    # ------------------------------------------------------------------
    # Static helpers (unchanged from original)
    # ------------------------------------------------------------------

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

    @staticmethod
    def _normalize_record_debug_fields(record: UiDocumentRecord) -> UiDocumentRecord:
        diagnostics = record.diagnostics.model_copy(deep=True) if record.diagnostics is not None else None
        warnings, flags = DocumentRegistry._split_user_warnings_and_flags(record.warnings)
        if flags:
            existing_flags = diagnostics.pipeline_flags if diagnostics is not None else []
            merged_flags = list(dict.fromkeys([*existing_flags, *flags]))
            if diagnostics is None:
                diagnostics = ProcessDiagnostics(pipeline_flags=merged_flags)
            else:
                diagnostics = diagnostics.model_copy(update={"pipeline_flags": merged_flags})
        if warnings == record.warnings and diagnostics == record.diagnostics:
            return record
        return record.model_copy(update={"warnings": warnings, "diagnostics": diagnostics})

    @staticmethod
    def _split_user_warnings_and_flags(warnings: list[str]) -> tuple[list[str], list[str]]:
        user_warnings: list[str] = []
        flags: list[str] = []
        for warning in warnings:
            if DocumentRegistry._is_internal_pipeline_flag(warning):
                flags.append(warning)
            else:
                user_warnings.append(warning)
        return user_warnings, flags

    @staticmethod
    def _is_internal_pipeline_flag(value: str) -> bool:
        candidate = value.strip().lower()
        if not candidate:
            return False
        return candidate.startswith("classifier_") or candidate.startswith("pdf_") or bool(
            re.match(r".*_fallback$", candidate)
        )
