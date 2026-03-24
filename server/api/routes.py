from __future__ import annotations

import json as json_module
import re
from collections.abc import Callable
import logging
import time
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse

from server.clients.ollama_client import OllamaServiceError
from server.pipelines.classifier import ClassificationValidationError
from server.pipelines.extractor import ExtractionValidationError
from server.pipelines.process_pipeline import UnsupportedMediaTypeError
from server.pipelines.search import SearchPipelineError
from server.pipelines.whisper_proxy import WhisperProxyError
from server.schemas import (
    ActivityResponse,
    DocumentCountsResponse,
    DocumentListResponse,
    CompleteUndoMoveRequest,
    DismissMoveRequest,
    DismissMoveResponse,
    EngagementEventRequest,
    EngagementEventResponse,
    FinalizeMoveRequest,
    FinalizeMoveResponse,
    ProcessResponse,
    SearchShareBriefRequest,
    SearchShareBriefResponse,
    SearchResponse,
    TranscriptionResponse,
    UndoMoveRequest,
    UndoMoveResponse,
    WorkspaceCategoriesResponse,
    WorkspaceCategory,
    WorkspaceChatRequest,
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


WORKSPACE_CATEGORY_LABELS = {
    "receipt": "Kvitton",
    "contract": "Avtal",
    "invoice": "Fakturor",
    "meeting_notes": "Mötesanteckningar",
    "audio": "Ljud",
    "generic": "Övrigt",
}


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

    @router.get("/search", response_model=SearchResponse)
    async def search(
        query: str = Query(min_length=1),
        limit: int = Query(default=5, ge=1, le=20),
    ) -> SearchResponse:
        if search_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="search_unavailable",
            )
        try:
            return await search_service.search(query, limit=limit)
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

            if (
                staged_path is not None
                and move_executor == "server"
                and response.move_result.success
            ):
                try:
                    staged_path.unlink(missing_ok=True)
                    staged_path = None
                except OSError:
                    pass

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
        except OllamaServiceError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=error.code,
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
        for kind, label in WORKSPACE_CATEGORY_LABELS.items():
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
                    category=request.category,
                    message=request.message,
                    history=[turn.model_dump() for turn in request.history],
                    document_id=request.document_id,
                )
                yield f"event: context\ndata: {json_module.dumps({'source_count': context.source_count})}\n\n"
                async for token in workspace_chat_service.stream_response(context):
                    yield f"event: token\ndata: {json_module.dumps({'text': token})}\n\n"
                yield f"event: done\ndata: {{}}\n\n"
            except Exception as exc:
                yield f"event: error\ndata: {json_module.dumps({'error': str(exc)})}\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    return router
