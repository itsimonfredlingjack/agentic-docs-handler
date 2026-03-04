from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse

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
    ProcessResponse,
    SearchResponse,
    TranscriptionResponse,
    UndoMoveRequest,
    UndoMoveResponse,
)


def create_router(
    *,
    pipeline: object,
    search_service: object | None,
    whisper_service: object | None,
    document_registry: object | None,
    realtime_manager: object | None,
    readiness_probe: Callable[[], dict[str, object]],
    validation_report_loader: Callable[[], dict[str, object]],
) -> APIRouter:
    router = APIRouter()

    @router.get("/healthz")
    async def healthz() -> dict[str, object]:
        return {"status": "ok"}

    @router.get("/readyz")
    async def readyz() -> dict[str, object]:
        payload = readiness_probe()
        if payload.get("ready") is True:
            return payload
        return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content=payload)

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
    async def activity(limit: int = Query(default=10, ge=1, le=100)) -> ActivityResponse:
        if document_registry is None:
            return ActivityResponse()
        return ActivityResponse(events=document_registry.list_activity(limit=limit))

    @router.get("/search", response_model=SearchResponse)
    async def search(query: str = Query(min_length=1), limit: int = Query(default=5, ge=1, le=20)) -> SearchResponse:
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
            raise HTTPException(status_code=error.status_code, detail=str(error)) from error

    @router.post("/process", response_model=ProcessResponse)
    async def process(
        file: UploadFile = File(...),
        execute_move: bool = Form(False),
        source_path: str | None = Form(None),
        client_id: str | None = Form(None),
        client_request_id: str | None = Form(None),
    ) -> ProcessResponse:
        try:
            content = await file.read()
            return await pipeline.process_upload(
                filename=file.filename or "upload.bin",
                content=content,
                content_type=file.content_type,
                execute_move=execute_move,
                source_path=source_path,
                client_id=client_id,
                client_request_id=client_request_id,
            )
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
                detail=str(error),
            ) from error

    @router.post("/moves/undo", response_model=UndoMoveResponse)
    async def undo_move(payload: UndoMoveRequest) -> UndoMoveResponse:
        if document_registry is None:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="document_registry_unavailable")
        try:
            result = document_registry.undo_move(payload.undo_token)
        except KeyError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error

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

    return router
