from __future__ import annotations

import mimetypes
import time
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from docx import Document as DocxDocument
from pypdf import PdfReader

from server.clients.ollama_client import OllamaServiceError
from server.document_registry import DocumentRegistry
from server.pipelines.classifier import ClassificationValidationError, DocumentClassifier
from server.pipelines.extractor import DocumentExtractor, ExtractionValidationError
from server.pipelines.file_organizer import FileOrganizer
from server.pipelines.search import IndexedDocument
from server.pipelines.whisper_proxy import WhisperProxy
from server.schemas import (
    ExtractionResult,
    MovePlan,
    MoveResult,
    ProcessResponse,
    SourceModality,
    TranscriptionResponse,
    UiDocumentKind,
    UiDocumentRecord,
)

SUPPORTED_TEXT_TYPES = {
    "text/plain",
    "text/markdown",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
SUPPORTED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}
SUPPORTED_AUDIO_TYPES = {
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/mp4",
    "audio/m4a",
    "audio/aiff",
    "audio/x-aiff",
}


class UnsupportedMediaTypeError(ValueError):
    """Raised for file types that the current processing pipeline does not support."""


class DocumentProcessPipeline:
    def __init__(
        self,
        *,
        classifier: DocumentClassifier,
        extractor: DocumentExtractor,
        organizer: FileOrganizer,
        whisper_service: WhisperProxy | None = None,
        document_registry: DocumentRegistry | None = None,
        realtime_manager: object | None = None,
        search_pipeline: object | None = None,
        max_text_characters: int = 12000,
    ) -> None:
        self.classifier = classifier
        self.extractor = extractor
        self.organizer = organizer
        self.whisper_service = whisper_service
        self.document_registry = document_registry
        self.realtime_manager = realtime_manager
        self.search_pipeline = search_pipeline
        self.max_text_characters = max_text_characters

    async def process_upload(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str | None,
        execute_move: bool,
        source_path: str | None,
        client_id: str | None = None,
        client_request_id: str | None = None,
    ) -> ProcessResponse:
        request_id = client_request_id or str(uuid4())
        record_id = str(uuid4())
        created_at = datetime.now(UTC).isoformat()
        mime_type = self._detect_mime(filename, content_type)
        source_modality = self._detect_modality(mime_type)
        timings: dict[str, float] = {}
        errors: list[str] = []
        transcription: TranscriptionResponse | None = None

        await self._emit_event(
            client_id,
            {
                "type": "job.started",
                "request_id": request_id,
                "client_id": client_id,
                "job_kind": "process",
                "filename": filename,
                "source_modality": source_modality,
            },
        )

        try:
            classify_started = time.perf_counter()
            if mime_type in SUPPORTED_IMAGE_TYPES:
                await self._progress(client_id, request_id, "classifying", "Klassificerar bild")
                classification = await self.classifier.classify_image(
                    content,
                    mime_type,
                    request_id=request_id,
                )
                extracted_text = classification.ocr_text or classification.summary
            elif mime_type in SUPPORTED_TEXT_TYPES:
                extracted_text = self._extract_text(content, mime_type)
                await self._progress(client_id, request_id, "classifying", "Klassificerar dokument")
                classification = await self.classifier.classify_text(
                    extracted_text[: self.max_text_characters],
                    request_id=request_id,
                )
            elif mime_type in SUPPORTED_AUDIO_TYPES:
                if self.whisper_service is None:
                    raise UnsupportedMediaTypeError("audio_pipeline_unavailable")
                await self._progress(client_id, request_id, "transcribing", "Transkriberar ljud")
                transcription = await self.whisper_service.transcribe(
                    filename=filename,
                    content=content,
                    content_type=mime_type,
                    client_id=client_id,
                    client_request_id=request_id,
                )
                extracted_text = transcription.text
                await self._progress(client_id, request_id, "classifying", "Klassificerar transkription")
                classification = await self.classifier.classify_text(
                    extracted_text[: self.max_text_characters],
                    request_id=request_id,
                )
            else:
                raise UnsupportedMediaTypeError(mime_type)
            timings["classify_ms"] = round((time.perf_counter() - classify_started) * 1000, 2)

            await self._progress(client_id, request_id, "extracting", "Extraherar fält")
            extract_started = time.perf_counter()
            extraction = await self.extractor.extract(
                extracted_text[: self.max_text_characters],
                classification,
                request_id=request_id,
            )
            timings["extract_ms"] = round((time.perf_counter() - extract_started) * 1000, 2)

            await self._progress(client_id, request_id, "organizing", "Planerar filsortering")
            plan_started = time.perf_counter()
            move_plan = self.organizer.plan_move(filename, classification)
            move_result = MoveResult(
                attempted=False,
                success=False,
                from_path=source_path,
                to_path=None,
                error=None,
            )
            status = "move_planned"
            if execute_move and move_plan.auto_move_allowed and source_path:
                move_result = self.organizer.execute_move(move_plan, Path(source_path))
                status = "move_executed" if move_result.success else "failed_runtime"
            elif execute_move and move_plan.auto_move_allowed and not source_path:
                move_result = MoveResult(
                    attempted=False,
                    success=False,
                    from_path=None,
                    to_path=None,
                    error="source_path_required_for_move",
                )
                errors.append("source_path_required_for_move")
            timings["organize_ms"] = round((time.perf_counter() - plan_started) * 1000, 2)

            if self.search_pipeline is not None:
                await self._progress(client_id, request_id, "indexing", "Indexerar dokument")
                indexed_source_path = move_result.to_path or source_path or filename
                self.search_pipeline.upsert_document(
                    IndexedDocument(
                        doc_id=record_id,
                        title=classification.title,
                        source_path=indexed_source_path,
                        text=extracted_text,
                        metadata={
                            "document_type": classification.document_type,
                            "summary": classification.summary,
                            "tags": classification.tags,
                        },
                    )
                )

            move_plan_for_response = self._coerce_move_reason(move_plan, execute_move)
            ui_kind = self._resolve_ui_kind(
                document_type=classification.document_type,
                source_modality=source_modality,
            )
            undo_token: str | None = None
            if (
                self.document_registry is not None
                and move_result.success
                and move_result.from_path is not None
                and move_result.to_path is not None
            ):
                undo_token = self.document_registry.record_move(
                    request_id=request_id,
                    record_id=record_id,
                    from_path=move_result.from_path,
                    to_path=move_result.to_path,
                    client_id=client_id,
                ).undo_token

            response = ProcessResponse(
                request_id=request_id,
                status=status,
                mime_type=mime_type,
                classification=classification,
                extraction=extraction,
                move_plan=move_plan_for_response,
                move_result=move_result,
                timings=timings,
                errors=errors,
                record_id=record_id,
                source_modality=source_modality,
                created_at=created_at,
                transcription=transcription,
                ui_kind=ui_kind,
                undo_token=undo_token,
            )

            if self.document_registry is not None:
                self.document_registry.upsert_document(
                    UiDocumentRecord(
                        id=record_id,
                        request_id=request_id,
                        title=classification.title,
                        summary=classification.summary,
                        mime_type=mime_type,
                        source_modality=source_modality,
                        kind=ui_kind,
                        document_type=classification.document_type,
                        template=classification.template,
                        source_path=move_result.to_path or source_path or filename,
                        created_at=created_at,
                        updated_at=datetime.now(UTC).isoformat(),
                        classification=classification,
                        extraction=extraction,
                        transcription=transcription,
                        move_plan=move_plan_for_response,
                        move_result=move_result,
                        tags=classification.tags,
                        status="completed" if status in {"move_planned", "move_executed"} else status,
                        undo_token=undo_token,
                    )
                )

            if undo_token is not None and move_result.from_path is not None and move_result.to_path is not None:
                await self._emit_event(
                    client_id,
                    {
                        "type": "file.moved",
                        "request_id": request_id,
                        "client_id": client_id,
                        "record_id": record_id,
                        "from_path": move_result.from_path,
                        "to_path": move_result.to_path,
                        "undo_token": undo_token,
                    },
                )
            await self._emit_event(
                client_id,
                {
                    "type": "job.completed",
                    "request_id": request_id,
                    "client_id": client_id,
                    "record_id": record_id,
                    "ui_kind": ui_kind,
                },
            )
            return response
        except Exception as error:
            await self._emit_event(
                client_id,
                {
                    "type": "job.failed",
                    "request_id": request_id,
                    "client_id": client_id,
                    "message": str(error),
                },
            )
            raise

    @staticmethod
    def _detect_mime(filename: str, content_type: str | None) -> str:
        if content_type:
            return content_type
        guessed, _ = mimetypes.guess_type(filename)
        return guessed or "application/octet-stream"

    @staticmethod
    def _extract_text(content: bytes, mime_type: str) -> str:
        if mime_type in {"text/plain", "text/markdown"}:
            return content.decode("utf-8")
        if mime_type == "application/pdf":
            reader = PdfReader(BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        if mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            document = DocxDocument(BytesIO(content))
            return "\n".join(paragraph.text for paragraph in document.paragraphs)
        raise UnsupportedMediaTypeError(mime_type)

    @staticmethod
    def _coerce_move_reason(move_plan: MovePlan, execute_move: bool) -> MovePlan:
        if not execute_move and move_plan.auto_move_allowed:
            return move_plan.model_copy(update={"reason": "execute_move_disabled"})
        return move_plan

    @staticmethod
    def _detect_modality(mime_type: str) -> SourceModality:
        if mime_type in SUPPORTED_IMAGE_TYPES:
            return "image"
        if mime_type in SUPPORTED_AUDIO_TYPES:
            return "audio"
        return "text"

    @staticmethod
    def _resolve_ui_kind(*, document_type: str, source_modality: SourceModality) -> UiDocumentKind:
        if source_modality == "audio":
            return "audio"
        if document_type in {"receipt", "contract", "invoice", "meeting_notes"}:
            return document_type
        return "generic"

    async def _progress(self, client_id: str | None, request_id: str, stage: str, message: str) -> None:
        await self._emit_event(
            client_id,
            {
                "type": "job.progress",
                "request_id": request_id,
                "client_id": client_id,
                "stage": stage,
                "message": message,
            },
        )

    async def _emit_event(self, client_id: str | None, payload: dict[str, object]) -> None:
        if client_id is None or self.realtime_manager is None:
            return
        await self.realtime_manager.emit_to_client(client_id, payload)


__all__ = [
    "ClassificationValidationError",
    "DocumentExtractor",
    "DocumentProcessPipeline",
    "ExtractionValidationError",
    "ExtractionResult",
    "FileOrganizer",
    "IndexedDocument",
    "OllamaServiceError",
    "UnsupportedMediaTypeError",
]
