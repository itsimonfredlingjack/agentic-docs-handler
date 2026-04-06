from __future__ import annotations

import json as json_module
import re
from collections.abc import Callable
import logging
import time
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse

from server.pipelines.classifier import ClassificationValidationError
from server.pipelines.extractor import ExtractionValidationError
from server.pipelines.process_pipeline import UnsupportedMediaTypeError
from server.pipelines.search import SearchPipelineError
from server.pipelines.whisper_proxy import WhisperProxyError
from server.schemas import (
    ActivityResponse,
    CreateWorkspaceRequest,
    WorkspaceDiscoveryResponse,
    DocumentCountsResponse,
    DocumentListResponse,
    CompleteUndoMoveRequest,
    DismissMoveRequest,
    DismissMoveResponse,
    EngagementEventRequest,
    EngagementEventResponse,
    FinalizeMoveRequest,
    FinalizeMoveResponse,
    MoveFilesToWorkspaceRequest,
    ProcessResponse,
    SearchShareBriefRequest,
    SearchShareBriefResponse,
    SearchResponse,
    TranscriptionResponse,
    UndoMoveRequest,
    UndoMoveResponse,
    UpdateWorkspaceRequest,
    WorkspaceCategoriesResponse,
    WorkspaceCategory,
    WorkspaceChatRequest,
    WorkspaceListResponse,
    WorkspaceResponse,
)

logger = logging.getLogger(__name__)

_SANITIZE_RE = re.compile(r"[^a-zA-Z0-9._-]")
_last_cleanup_ts: float = 0.0
_CLEANUP_INTERVAL_SECONDS = 3600.0
_CLEANUP_MAX_AGE_SECONDS = 86400.0


def _stage_upload(staging_dir: Path, filename: str, content: bytes) -> Path:
    staging_dir.mkdir(parents=True, exist_ok=True)
    sanitized = _SANITIZE_RE.sub("_", Path(filename).name) or "upload.bin"
    staged_path = staging_dir / f"{uuid4()}-{sanitized}"
    staged_path.write_bytes(content)
    return staged_path


def _maybe_cleanup_staging(staging_dir: Path) -> None:
    global _last_cleanup_ts
    now = time.time()
    if now - _last_cleanup_ts < _CLEANUP_INTERVAL_SECONDS:
        return
    _last_cleanup_ts = now
    if not staging_dir.is_dir():
        return
    for entry in staging_dir.iterdir():
        if not entry.is_file():
            continue
        try:
            age = now - entry.stat().st_mtime
            if age > _CLEANUP_MAX_AGE_SECONDS:
                entry.unlink()
        except OSError:
            pass


from server.locale import msg, category_labels as _category_labels


def create_router(
    *,
    pipeline: object,
    model_name: str,
    search_service: object | None,
    whisper_service: object | None,
    document_registry: object | None,
    realtime_manager: object | None,
    readiness_probe: Callable[[], dict[str, object]],
    validation_report_loader: Callable[[], dict[str, object]],
    staging_dir: Path | None = None,
    workspace_chat_service: object | None = None,
    engagement_tracker: object | None = None,
    workspace_registry: object | None = None,
    workspace_brief_service: object | None = None,
    discovery_service: object | None = None,
    conversation_registry: object | None = None,
    workspace_event_log: object | None = None,
) -> APIRouter:
    router = APIRouter()

    def build_share_brief(payload: SearchShareBriefRequest) -> str:
        source_lines = []
        for source in payload.sources[:3]:
            prefix = "Indexed only" if source.indexed_only else "Source"
            source_lines.append(f"- {prefix}: {source.title}")

        lines = [
            "AI-Docs brief",
            f"Question: {payload.query.strip()}",
        ]
        rewritten_query = (payload.rewritten_query or "").strip()
        if rewritten_query and rewritten_query.casefold() != payload.query.strip().casefold():
            lines.append(f"Search intent: {rewritten_query}")
        lines.extend(
            [
                "",
                payload.answer.strip(),
            ]
        )
        if source_lines:
            lines.extend(["", "Sources:", *source_lines])
        lines.extend(["", "Generated locally with AI-Docs. Source titles only, raw files stay private."])
        return "\n".join(lines)

    @router.get("/healthz")
    async def healthz() -> dict[str, object]:
        return {"status": "ok", "model": model_name}

    @router.get("/readyz")
    async def readyz() -> dict[str, object]:
        payload = readiness_probe()
        if payload.get("ready") is True:
            return payload
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content=payload
        )

    @router.get("/validation/report")
    async def validation_report() -> dict[str, object]:
        return validation_report_loader()

    @router.get("/documents", response_model=DocumentListResponse)
    async def documents(
        kind: str | None = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> DocumentListResponse:
        if document_registry is None:
            return DocumentListResponse()
        return document_registry.list_documents(kind=kind, limit=limit, offset=offset)

    @router.get("/documents/counts", response_model=DocumentCountsResponse)
    async def document_counts() -> DocumentCountsResponse:
        if document_registry is None:
            return DocumentCountsResponse()
        return document_registry.counts()

    @router.get("/activity", response_model=ActivityResponse)
    async def activity(
        limit: int = Query(default=10, ge=1, le=100),
    ) -> ActivityResponse:
        if document_registry is None:
            return ActivityResponse()
        return ActivityResponse(events=document_registry.list_activity(limit=limit))

    @router.get("/documents/{record_id}/entities")
    async def document_entities(record_id: str) -> dict:
        if document_registry is None:
            raise HTTPException(503, "document registry unavailable")
        doc = document_registry.get_document(record_id=record_id)
        if doc is None:
            raise HTTPException(404, "document not found")
        entities = document_registry.get_entities_for_document(record_id=record_id)
        return {"record_id": record_id, "entities": entities}

    @router.get("/documents/{record_id}")
    async def document_detail(record_id: str):
        if document_registry is None:
            raise HTTPException(503, "document registry unavailable")
        document = document_registry.get_document(record_id=record_id)
        if document is None:
            raise HTTPException(404, "document not found")
        return document

    @router.delete("/documents/{record_id}")
    async def delete_document(record_id: str) -> dict[str, Any]:
        if document_registry is None:
            raise HTTPException(503, "document registry unavailable")

        # Capture workspace context before deletion for timeline event
        _pre_delete_record = document_registry.get_document(record_id=record_id)

        source_path = document_registry.delete_document(record_id=record_id)
        if source_path is None:
            raise HTTPException(status_code=404, detail="Document not found")

        # Remove from search index
        if search_service is not None:
            search_service.delete_document(record_id)

        # Delete file from disk
        if source_path:
            try:
                import os
                if os.path.exists(source_path):
                    os.remove(source_path)
            except OSError:
                pass  # File already gone or inaccessible

        # Clean up persisted conversation history for this document
        if conversation_registry is not None:
            try:
                conversation_registry.delete_conversation(conversation_key=f"doc:{record_id}")
            except Exception:
                logger.warning("Failed to clean up conversations for document %s", record_id, exc_info=True)

        # Emit document_removed timeline event for the source workspace
        if (
            workspace_event_log is not None
            and _pre_delete_record is not None
            and _pre_delete_record.workspace_id
        ):
            # Check source workspace is not inbox
            _is_inbox = False
            if workspace_registry is not None:
                try:
                    _src_ws = workspace_registry.get_workspace(workspace_id=_pre_delete_record.workspace_id)
                    _is_inbox = _src_ws is not None and _src_ws.is_inbox
                except Exception:
                    pass
            if not _is_inbox:
                try:
                    doc_title = _pre_delete_record.classification.title if _pre_delete_record.classification else _pre_delete_record.title
                    workspace_event_log.emit(
                        workspace_id=_pre_delete_record.workspace_id,
                        event_type="document_removed",
                        title=msg("event.document_removed", title=doc_title),
                    )
                except Exception:
                    logger.warning("Failed to emit document_removed event", exc_info=True)

        return {"success": True, "record_id": record_id}

    @router.post("/documents/batch-delete")
    async def batch_delete_documents(payload: dict[str, Any]) -> JSONResponse:
        if document_registry is None:
            raise HTTPException(503, "document registry unavailable")
        record_ids: list[str] = payload.get("record_ids", [])
        if not record_ids:
            raise HTTPException(400, "record_ids is required")

        succeeded = 0
        failed = 0
        errors: list[str] = []
        for record_id in record_ids:
            try:
                # Capture workspace context before deletion for timeline
                pre_record = document_registry.get_document(record_id=record_id)
                if pre_record is None:
                    failed += 1
                    errors.append(f"{record_id}: not found")
                    continue
                source_path = document_registry.delete_document(record_id=record_id)
                if search_service is not None:
                    try:
                        search_service.delete_document(record_id)
                    except Exception:
                        pass
                if source_path:
                    try:
                        import os
                        if os.path.exists(source_path):
                            os.remove(source_path)
                    except OSError:
                        pass
                if conversation_registry is not None:
                    try:
                        conversation_registry.delete_conversation(conversation_key=f"doc:{record_id}")
                    except Exception:
                        pass
                # Emit document_removed timeline event
                if (
                    workspace_event_log is not None
                    and pre_record is not None
                    and pre_record.workspace_id
                    and workspace_registry is not None
                ):
                    try:
                        src_ws = workspace_registry.get_workspace(workspace_id=pre_record.workspace_id)
                        if src_ws and not src_ws.is_inbox:
                            doc_title = pre_record.classification.title if pre_record.classification else pre_record.title
                            workspace_event_log.emit(
                                workspace_id=pre_record.workspace_id,
                                event_type="document_removed",
                                title=msg("event.document_removed", title=doc_title),
                            )
                    except Exception:
                        pass
                succeeded += 1
            except Exception as exc:
                failed += 1
                errors.append(f"{record_id}: {exc}")
        return JSONResponse({"succeeded": succeeded, "failed": failed, "errors": errors})

    @router.post("/documents/batch-retry")
    async def batch_retry_documents(
        payload: dict[str, Any],
    ) -> JSONResponse:
        if document_registry is None or pipeline is None:
            raise HTTPException(503, "service unavailable")
        record_ids: list[str] = payload.get("record_ids", [])
        if not record_ids:
            raise HTTPException(400, "record_ids is required")

        succeeded = 0
        failed = 0
        skipped = 0
        errors: list[str] = []
        for record_id in record_ids:
            try:
                record = document_registry.get_document(record_id=record_id)
                if record is None:
                    skipped += 1
                    errors.append(f"{record_id}: not found")
                    continue
                if record.status != "pending_classification" or not record.retryable:
                    skipped += 1
                    continue
                source_path = record.source_path
                if not source_path:
                    skipped += 1
                    errors.append(f"{record_id}: no source path")
                    continue
                import os
                if not os.path.exists(source_path):
                    skipped += 1
                    errors.append(f"{record_id}: source file gone")
                    continue
                content = Path(source_path).read_bytes()
                filename = Path(source_path).name
                parts = filename.split("-", 1)
                if len(parts) == 2 and len(parts[0]) >= 32:
                    filename = parts[1]
                result = await pipeline.reprocess_pending(
                    record_id=record_id,
                    content=content,
                    filename=filename,
                    content_type=record.mime_type,
                    source_path=source_path,
                    client_id=payload.get("client_id"),
                )
                if result.status == "pending_classification":
                    failed += 1
                else:
                    succeeded += 1
            except Exception as exc:
                failed += 1
                errors.append(f"{record_id}: {exc}")
        return JSONResponse({"succeeded": succeeded, "failed": failed, "skipped": skipped, "errors": errors})

    @router.get("/documents/pending")
    async def list_pending_documents() -> JSONResponse:
        if document_registry is None:
            return JSONResponse({"documents": []})
        records = document_registry.list_pending_retryable()
        return JSONResponse({
            "documents": [
                {
                    "id": r.id,
                    "title": r.title,
                    "source_path": r.source_path,
                    "mime_type": r.mime_type,
                    "error_code": r.error_code,
                    "created_at": r.created_at,
                }
                for r in records
            ]
        })

    @router.post("/documents/{record_id}/retry")
    async def retry_pending_document(
        record_id: str,
        client_id: str | None = Query(default=None),
    ) -> ProcessResponse:
        if document_registry is None or pipeline is None:
            raise HTTPException(503, "service unavailable")

        record = document_registry.get_document(record_id=record_id)
        if record is None:
            raise HTTPException(404, "document not found")
        if record.status != "pending_classification":
            raise HTTPException(
                400,
                f"document status is '{record.status}', not 'pending_classification'",
            )

        source_path = record.source_path
        if not source_path:
            raise HTTPException(
                410,
                "source file path not available — document cannot be retried",
            )

        import os
        if not os.path.exists(source_path):
            raise HTTPException(
                410,
                "source file has been cleaned up — document cannot be retried",
            )

        content = Path(source_path).read_bytes()
        filename = Path(source_path).name
        # Strip UUID prefix from staged filename (e.g., "abc123-faktura.txt" → "faktura.txt")
        parts = filename.split("-", 1)
        if len(parts) == 2 and len(parts[0]) >= 32:
            filename = parts[1]

        return await pipeline.reprocess_pending(
            record_id=record_id,
            content=content,
            filename=filename,
            content_type=record.mime_type,
            source_path=source_path,
            client_id=client_id,
        )

    @router.get("/search", response_model=SearchResponse)
    async def search(
        query: str = Query(min_length=1),
        limit: int = Query(default=5, ge=1, le=20),
        mode: Literal["fast", "full"] = Query(default="fast"),
        workspace_id: str | None = Query(default=None),
        document_type: str | None = Query(default=None),
        date_from: str | None = Query(default=None),
        date_to: str | None = Query(default=None),
    ) -> SearchResponse:
        if search_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="search_unavailable",
            )
        allowed_doc_ids: set[str] | None = None
        if workspace_id is not None:
            if workspace_registry is None:
                raise HTTPException(503, "workspace registry unavailable")
            if document_registry is None:
                raise HTTPException(503, "document registry unavailable")
            workspace = workspace_registry.get_workspace(workspace_id=workspace_id)
            if workspace is None:
                raise HTTPException(404, "workspace not found")
            rows = document_registry.conn.execute(
                "SELECT id FROM document WHERE workspace_id = ?",
                (workspace_id,),
            ).fetchall()
            allowed_doc_ids = {row["id"] for row in rows}
        # Date filtering via SQLite (efficient — uses indexed created_at column)
        if date_from is not None or date_to is not None:
            if document_registry is None:
                raise HTTPException(503, "document registry unavailable")
            date_conditions = []
            date_params: list[str] = []
            if date_from is not None:
                date_conditions.append("created_at >= ?")
                date_params.append(date_from)
            if date_to is not None:
                date_conditions.append("created_at <= ?")
                date_params.append(date_to)
            where_clause = " AND ".join(date_conditions)
            date_rows = document_registry.conn.execute(
                f"SELECT id FROM document WHERE {where_clause}",
                date_params,
            ).fetchall()
            date_doc_ids = {row["id"] for row in date_rows}
            if allowed_doc_ids is not None:
                allowed_doc_ids = allowed_doc_ids & date_doc_ids
            else:
                allowed_doc_ids = date_doc_ids
        try:
            response = await search_service.search(
                query,
                limit=limit,
                mode=mode,
                allowed_doc_ids=allowed_doc_ids,
                document_type=document_type,
            )
            if document_registry is not None and response.results:
                doc_ids = [result.doc_id for result in response.results]
                placeholders = ", ".join("?" for _ in doc_ids)
                doc_rows = document_registry.conn.execute(
                    f"SELECT id, workspace_id FROM document WHERE id IN ({placeholders})",
                    doc_ids,
                ).fetchall()
                workspace_ids = sorted({
                    row["workspace_id"] for row in doc_rows if row["workspace_id"] is not None
                })
                workspace_names: dict[str, str] = {}
                if workspace_registry is not None and workspace_ids:
                    workspace_placeholders = ", ".join("?" for _ in workspace_ids)
                    workspace_rows = document_registry.conn.execute(
                        f"SELECT id, name FROM workspace WHERE id IN ({workspace_placeholders})",
                        workspace_ids,
                    ).fetchall()
                    workspace_names = {
                        row["id"]: row["name"]
                        for row in workspace_rows
                    }
                workspace_by_doc_id = {
                    row["id"]: row["workspace_id"]
                    for row in doc_rows
                }
                for result in response.results:
                    metadata = dict(result.metadata)
                    workspace_id_value = workspace_by_doc_id.get(result.doc_id)
                    if workspace_id_value is not None:
                        metadata["workspace_id"] = workspace_id_value
                        metadata["workspace_name"] = workspace_names.get(workspace_id_value, "")
                    result.metadata = metadata
            return response
        except SearchPipelineError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error

    @router.post("/search/share-brief", response_model=SearchShareBriefResponse)
    async def share_search_brief(payload: SearchShareBriefRequest) -> SearchShareBriefResponse:
        event = None
        if engagement_tracker is not None:
            event = engagement_tracker.record_event(
                name="share_brief_created",
                surface="search",
                metadata={
                    "query": payload.query.strip(),
                    "source_count": len(payload.sources),
                },
            )
        return SearchShareBriefResponse(
            brief_text=build_share_brief(payload),
            source_count=len(payload.sources),
            event=event,
        )

    @router.post("/engagement/events", response_model=EngagementEventResponse)
    async def track_engagement_event(payload: EngagementEventRequest) -> EngagementEventResponse:
        if engagement_tracker is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="engagement_tracking_unavailable",
            )
        event = engagement_tracker.record_event(
            name=payload.name,
            surface=payload.surface,
            metadata=dict(payload.metadata),
        )
        return EngagementEventResponse(success=True, event=event)

    @router.post("/transcribe", response_model=TranscriptionResponse)
    async def transcribe(
        file: UploadFile = File(...),
        language: str | None = Form(None),
        client_id: str | None = Form(None),
        client_request_id: str | None = Form(None),
    ) -> TranscriptionResponse:
        if whisper_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="whisper_unavailable",
            )
        try:
            content = await file.read()
            return await whisper_service.transcribe(
                filename=file.filename or "audio.bin",
                content=content,
                content_type=file.content_type,
                language=language,
                client_id=client_id,
                client_request_id=client_request_id,
            )
        except WhisperProxyError as error:
            raise HTTPException(
                status_code=error.status_code, detail=str(error)
            ) from error

    @router.post("/process", response_model=ProcessResponse)
    async def process(
        file: UploadFile = File(...),
        execute_move: bool = Form(False),
        source_path: str | None = Form(None),
        client_id: str | None = Form(None),
        client_request_id: str | None = Form(None),
        move_executor: str = Form("none"),
    ) -> ProcessResponse:
        started = time.perf_counter()
        staged_path: Path | None = None
        try:
            content = await file.read()
            filename = file.filename or "upload.bin"

            if staging_dir is not None:
                staged_path = _stage_upload(staging_dir, filename, content)
                _maybe_cleanup_staging(staging_dir)

            resolved_source_path = (
                source_path
                if source_path
                else (str(staged_path) if staged_path else None)
            )

            logger.info(
                "api.process.received filename=%s mime_type=%s client_id=%s client_request_id=%s move_executor=%s staged=%s",
                filename,
                file.content_type,
                client_id,
                client_request_id,
                move_executor,
                staged_path is not None,
            )
            response = await pipeline.process_upload(
                filename=filename,
                content=content,
                content_type=file.content_type,
                execute_move=execute_move,
                source_path=resolved_source_path,
                client_id=client_id,
                client_request_id=client_request_id,
                move_executor=move_executor,
            )

            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            logger.info(
                "api.process.completed request_id=%s record_id=%s client_id=%s elapsed_ms=%s move_status=%s",
                response.request_id,
                response.record_id,
                client_id,
                elapsed_ms,
                response.move_status,
            )
            return response
        except UnsupportedMediaTypeError as error:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=str(error),
            ) from error
        except ValueError as error:
            if str(error) != "unsupported_media_type":
                raise
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=str(error),
            ) from error
        except (ClassificationValidationError, ExtractionValidationError) as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(error),
            ) from error

    @router.post("/moves/undo", response_model=UndoMoveResponse)
    async def undo_move(payload: UndoMoveRequest) -> UndoMoveResponse:
        if document_registry is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="document_registry_unavailable",
            )
        try:
            result = document_registry.undo_move(payload.undo_token)
        except KeyError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
            ) from error
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)
            ) from error

        if realtime_manager is not None and payload.client_id is not None:
            await realtime_manager.emit_to_client(
                payload.client_id,
                {
                    "type": "file.move_undone",
                    "request_id": result.response.request_id,
                    "client_id": payload.client_id,
                    "from_path": result.response.from_path,
                    "to_path": result.response.to_path,
                },
            )
        return result.response

    @router.post("/moves/finalize", response_model=FinalizeMoveResponse)
    async def finalize_move(payload: FinalizeMoveRequest) -> FinalizeMoveResponse:
        if document_registry is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="document_registry_unavailable",
            )
        try:
            result = document_registry.finalize_client_move(
                record_id=payload.record_id,
                request_id=payload.request_id,
                client_id=payload.client_id,
                from_path=payload.from_path,
                to_path=payload.to_path,
                success=payload.success,
                error=payload.error,
            )
        except KeyError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
            ) from error

        if realtime_manager is not None and payload.client_id is not None:
            if result.response.success:
                await realtime_manager.emit_to_client(
                    payload.client_id,
                    {
                        "type": "file.moved",
                        "request_id": payload.request_id,
                        "client_id": payload.client_id,
                        "record_id": payload.record_id,
                        "from_path": payload.from_path,
                        "to_path": payload.to_path,
                        "undo_token": result.response.undo_token,
                    },
                )
                await realtime_manager.emit_to_client(
                    payload.client_id,
                    {
                        "type": "job.progress",
                        "request_id": payload.request_id,
                        "client_id": payload.client_id,
                        "stage": "moved",
                        "message": "Filen flyttades",
                    },
                )
                await realtime_manager.emit_to_client(
                    payload.client_id,
                    {
                        "type": "job.completed",
                        "request_id": payload.request_id,
                        "client_id": payload.client_id,
                        "record_id": payload.record_id,
                        "ui_kind": result.record.kind
                        if result.record is not None
                        else "generic",
                    },
                )
            else:
                await realtime_manager.emit_to_client(
                    payload.client_id,
                    {
                        "type": "job.failed",
                        "request_id": payload.request_id,
                        "client_id": payload.client_id,
                        "message": payload.error or "move_failed",
                    },
                )
        return result.response

    @router.post("/moves/dismiss", response_model=DismissMoveResponse)
    async def dismiss_move(payload: DismissMoveRequest) -> DismissMoveResponse:
        if document_registry is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="document_registry_unavailable",
            )
        try:
            result = document_registry.dismiss_pending_move(
                record_id=payload.record_id,
                request_id=payload.request_id,
                client_id=payload.client_id,
            )
        except KeyError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
            ) from error
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)
            ) from error

        if realtime_manager is not None and payload.client_id is not None:
            await realtime_manager.emit_to_client(
                payload.client_id,
                {
                    "type": "move.dismissed",
                    "request_id": payload.request_id,
                    "client_id": payload.client_id,
                    "record_id": payload.record_id,
                },
            )
        return result.response

    @router.post("/moves/undo-complete", response_model=UndoMoveResponse)
    async def complete_undo_move(payload: CompleteUndoMoveRequest) -> UndoMoveResponse:
        if document_registry is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="document_registry_unavailable",
            )
        try:
            result = document_registry.complete_client_undo(
                undo_token=payload.undo_token,
                from_path=payload.from_path,
                to_path=payload.to_path,
                success=payload.success,
                error=payload.error,
            )
        except KeyError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
            ) from error
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)
            ) from error

        if realtime_manager is not None and payload.client_id is not None:
            await realtime_manager.emit_to_client(
                payload.client_id,
                {
                    "type": "file.move_undone",
                    "request_id": result.response.request_id,
                    "client_id": payload.client_id,
                    "from_path": payload.from_path,
                    "to_path": payload.to_path,
                },
            )
        return result.response

    @router.get("/workspace/categories", response_model=WorkspaceCategoriesResponse)
    async def workspace_categories() -> WorkspaceCategoriesResponse:
        if document_registry is None:
            raise HTTPException(503, "document registry unavailable")
        raw_counts = document_registry.counts()
        categories = []
        for kind, label in _category_labels().items():
            count = getattr(raw_counts, kind, 0)
            if count > 0:
                categories.append(
                    WorkspaceCategory(category=kind, count=count, label=label)
                )
        return WorkspaceCategoriesResponse(categories=categories)

    @router.post("/workspace/chat")
    async def workspace_chat(request: WorkspaceChatRequest) -> StreamingResponse:
        if workspace_chat_service is None:
            raise HTTPException(503, "workspace chat unavailable")

        async def event_stream():
            try:
                context = await workspace_chat_service.prepare_context(
                    workspace_id=request.workspace_id,
                    category=request.category,
                    message=request.message,
                    history=[turn.model_dump() for turn in request.history],
                    document_id=request.document_id,
                )
                yield f"event: context\ndata: {json_module.dumps({'source_count': context.source_count, 'sources': context.sources})}\n\n"
                async for token in workspace_chat_service.stream_response(context):
                    yield f"event: token\ndata: {json_module.dumps({'text': token})}\n\n"
                yield f"event: done\ndata: {{}}\n\n"
            except Exception as exc:
                yield f"event: error\ndata: {json_module.dumps({'error': str(exc)})}\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    # ------------------------------------------------------------------
    # Workspace CRUD endpoints
    # ------------------------------------------------------------------

    @router.get("/workspaces", response_model=WorkspaceListResponse)
    async def list_workspaces() -> WorkspaceListResponse:
        if workspace_registry is None:
            raise HTTPException(503, "workspace registry unavailable")
        return workspace_registry.list_workspaces()

    @router.post("/workspaces", response_model=WorkspaceResponse, status_code=201)
    async def create_workspace(request: CreateWorkspaceRequest) -> WorkspaceResponse:
        if workspace_registry is None:
            raise HTTPException(503, "workspace registry unavailable")
        ws = workspace_registry.create_workspace(
            name=request.name,
            description=request.description,
            cover_color=request.cover_color,
        )
        result = workspace_registry.list_workspaces()
        match = next((w for w in result.workspaces if w.id == ws.id), None)
        if match is None:
            raise HTTPException(500, "workspace creation failed")
        if workspace_event_log is not None:
            try:
                workspace_event_log.emit(
                    workspace_id=ws.id,
                    event_type="workspace_created",
                    title=msg("event.workspace_created", name=ws.name),
                )
            except Exception:
                logger.warning("Failed to emit workspace_created event", exc_info=True)
        return match

    @router.get("/workspaces/{workspace_id}", response_model=WorkspaceResponse)
    async def get_workspace(workspace_id: str) -> WorkspaceResponse:
        if workspace_registry is None:
            raise HTTPException(503, "workspace registry unavailable")
        ws = workspace_registry.get_workspace(workspace_id=workspace_id)
        if ws is None:
            raise HTTPException(404, "workspace not found")
        result = workspace_registry.list_workspaces()
        match = next((w for w in result.workspaces if w.id == ws.id), None)
        if match is None:
            raise HTTPException(404, "workspace not found")
        return match

    @router.patch("/workspaces/{workspace_id}", response_model=WorkspaceResponse)
    async def update_workspace(workspace_id: str, request: UpdateWorkspaceRequest) -> WorkspaceResponse:
        if workspace_registry is None:
            raise HTTPException(503, "workspace registry unavailable")
        try:
            workspace_registry.update_workspace(
                workspace_id=workspace_id,
                name=request.name,
                description=request.description,
                cover_color=request.cover_color,
            )
        except KeyError:
            raise HTTPException(404, "workspace not found")
        result = workspace_registry.list_workspaces()
        match = next((w for w in result.workspaces if w.id == workspace_id), None)
        if match is None:
            raise HTTPException(404, "workspace not found")
        return match

    @router.delete("/workspaces/{workspace_id}", status_code=204)
    async def delete_workspace(workspace_id: str) -> None:
        if workspace_registry is None:
            raise HTTPException(503, "workspace registry unavailable")
        try:
            workspace_registry.delete_workspace(workspace_id=workspace_id)
        except KeyError:
            raise HTTPException(404, "workspace not found")
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        # Clean up persisted conversation history for this workspace
        if conversation_registry is not None:
            try:
                conversation_registry.delete_conversation(conversation_key=workspace_id)
            except Exception:
                logger.warning("Failed to clean up conversations for workspace %s", workspace_id, exc_info=True)
        if workspace_event_log is not None:
            try:
                workspace_event_log.delete_workspace_events(workspace_id=workspace_id)
            except Exception:
                logger.warning("Failed to clean up timeline events for workspace %s", workspace_id, exc_info=True)

    @router.post("/workspaces/{workspace_id}/brief")
    async def generate_workspace_brief(workspace_id: str) -> dict:
        if workspace_brief_service is None:
            raise HTTPException(503, "workspace brief service unavailable")
        try:
            result = await workspace_brief_service.generate(workspace_id=workspace_id)
        except KeyError:
            raise HTTPException(404, "workspace not found")
        if workspace_event_log is not None:
            try:
                brief_preview = (result.get("ai_brief") or "")[:80]
                workspace_event_log.emit(
                    workspace_id=workspace_id,
                    event_type="brief_updated",
                    title=msg("event.brief_updated"),
                    detail=brief_preview,
                )
            except Exception:
                logger.warning("Failed to emit brief_updated event", exc_info=True)
        return {"workspace_id": workspace_id, **result}

    @router.get("/workspaces/{workspace_id}/files", response_model=DocumentListResponse)
    async def workspace_files(
        workspace_id: str,
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> DocumentListResponse:
        if document_registry is None:
            raise HTTPException(503, "document registry unavailable")
        if workspace_registry is None:
            raise HTTPException(503, "workspace registry unavailable")
        ws = workspace_registry.get_workspace(workspace_id=workspace_id)
        if ws is None:
            raise HTTPException(404, "workspace not found")
        # Query documents filtered by workspace_id
        rows = document_registry.conn.execute(
            "SELECT * FROM document WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (workspace_id, limit, offset),
        ).fetchall()
        total_row = document_registry.conn.execute(
            "SELECT COUNT(*) FROM document WHERE workspace_id = ?", (workspace_id,)
        ).fetchone()
        from server.document_registry import _row_to_record
        documents = [_row_to_record(row) for row in rows]
        return DocumentListResponse(documents=documents, total=total_row[0] if total_row else 0)

    @router.post("/workspaces/{workspace_id}/files")
    async def move_files_to_workspace(workspace_id: str, request: MoveFilesToWorkspaceRequest) -> dict:
        if workspace_registry is None:
            raise HTTPException(503, "workspace registry unavailable")

        # Capture source workspace_ids before the move for documents_moved_out events
        _source_workspaces: dict[str, int] = {}  # workspace_id → count
        if workspace_event_log is not None and document_registry is not None:
            try:
                placeholders = ", ".join("?" for _ in request.file_ids)
                rows = document_registry.conn.execute(
                    f"SELECT workspace_id FROM document WHERE id IN ({placeholders})",
                    request.file_ids,
                ).fetchall()
                for row in rows:
                    src_ws = row["workspace_id"]
                    if src_ws and src_ws != workspace_id:
                        _source_workspaces[src_ws] = _source_workspaces.get(src_ws, 0) + 1
            except Exception:
                logger.debug("Failed to query source workspaces for move-out events", exc_info=True)

        try:
            moved = workspace_registry.move_files_to_workspace(
                file_ids=request.file_ids,
                workspace_id=workspace_id,
            )
        except KeyError:
            raise HTTPException(404, "workspace not found")
        if workspace_event_log is not None and moved > 0:
            try:
                workspace_event_log.emit(
                    workspace_id=workspace_id,
                    event_type="documents_moved_in",
                    title=msg("event.documents_moved_in", count=moved),
                    detail=msg("event.documents_moved_in_detail"),
                )
            except Exception:
                logger.warning("Failed to emit documents_moved_in event", exc_info=True)
            # Emit documents_moved_out for each non-inbox source workspace
            for src_ws_id, count in _source_workspaces.items():
                try:
                    src_ws = workspace_registry.get_workspace(workspace_id=src_ws_id) if workspace_registry else None
                    if src_ws and not src_ws.is_inbox:
                        workspace_event_log.emit(
                            workspace_id=src_ws_id,
                            event_type="documents_moved_out",
                            title=msg("event.documents_moved_out", count=count),
                        )
                except Exception:
                    logger.warning("Failed to emit documents_moved_out event for %s", src_ws_id, exc_info=True)
        return {"moved": moved}

    @router.get("/workspaces/{workspace_id}/discovery", response_model=WorkspaceDiscoveryResponse)
    async def workspace_discovery(workspace_id: str) -> WorkspaceDiscoveryResponse:
        if discovery_service is None:
            raise HTTPException(503, "discovery unavailable")
        if workspace_registry is None:
            raise HTTPException(503, "workspace registry unavailable")
        workspace = workspace_registry.get_workspace(workspace_id=workspace_id)
        if workspace is None:
            raise HTTPException(404, "workspace not found")
        cards = discovery_service.generate(workspace_id=workspace_id)
        return WorkspaceDiscoveryResponse(workspace_id=workspace_id, cards=cards)

    @router.post("/workspaces/{workspace_id}/discovery/{relation_id}/dismiss")
    async def dismiss_workspace_discovery(workspace_id: str, relation_id: str) -> dict[str, bool]:
        if discovery_service is None:
            raise HTTPException(503, "discovery unavailable")
        if workspace_registry is None:
            raise HTTPException(503, "workspace registry unavailable")
        workspace = workspace_registry.get_workspace(workspace_id=workspace_id)
        if workspace is None:
            raise HTTPException(404, "workspace not found")
        discovery_service.dismiss_relation(relation_id=relation_id)
        return {"success": True}

    # -----------------------------------------------------------------
    # Conversation persistence
    # -----------------------------------------------------------------

    @router.get("/conversations/{conversation_key}")
    async def get_conversation(conversation_key: str) -> JSONResponse:
        if conversation_registry is None:
            return JSONResponse({"entries": []})
        entries = conversation_registry.load_conversation(conversation_key=conversation_key)
        return JSONResponse({"entries": entries})

    @router.post("/conversations/{conversation_key}")
    async def save_conversation_entry(conversation_key: str, payload: dict[str, Any]) -> JSONResponse:
        if conversation_registry is None:
            raise HTTPException(503, "conversation persistence unavailable")
        entry_id = conversation_registry.save_entry(
            conversation_key=conversation_key,
            query=payload.get("query", ""),
            response=payload.get("response", ""),
            source_count=payload.get("sourceCount", 0),
            sources=payload.get("sources"),
            error_message=payload.get("errorMessage"),
        )
        return JSONResponse({"id": entry_id})

    @router.delete("/conversations/{conversation_key}")
    async def delete_conversation(conversation_key: str) -> JSONResponse:
        if conversation_registry is None:
            raise HTTPException(503, "conversation persistence unavailable")
        count = conversation_registry.delete_conversation(conversation_key=conversation_key)
        return JSONResponse({"deleted": count})

    # -----------------------------------------------------------------
    # Workspace timeline
    # -----------------------------------------------------------------

    @router.get("/workspaces/{workspace_id}/timeline")
    async def workspace_timeline(
        workspace_id: str,
        limit: int = Query(default=20, ge=1, le=100),
    ) -> JSONResponse:
        if workspace_event_log is None:
            return JSONResponse({"events": []})
        events = workspace_event_log.list_events(workspace_id=workspace_id, limit=limit)
        return JSONResponse({"events": events})

    return router
