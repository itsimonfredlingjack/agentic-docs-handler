from __future__ import annotations

import inspect
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
from server.pipelines.whisper_proxy import WhisperProxy, WhisperProxyError
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MoveExecutor,
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
        move_executor: MoveExecutor = "none",
    ) -> ProcessResponse:
        request_id = client_request_id or str(uuid4())
        record_id = str(uuid4())
        created_at = datetime.now(UTC).isoformat()
        mime_type = self._detect_mime(filename, content_type)
        source_modality = self._detect_modality(mime_type)
        timings: dict[str, float] = {}
        errors: list[str] = []
        warnings: list[str] = []
        transcription: TranscriptionResponse | None = None
        error_code: str | None = None
        retryable = False

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
        await self._progress(client_id, request_id, "processing", "Bearbetar dokument")

        try:
            classify_started = time.perf_counter()
            extracted_text: str
            if mime_type in SUPPORTED_IMAGE_TYPES:
                classification, used_fallback = await self._classify_image(content, mime_type, request_id)
                extracted_text = classification.ocr_text or classification.summary
            elif mime_type in SUPPORTED_TEXT_TYPES:
                extracted_text = self._extract_text(content, mime_type)
                classification, used_fallback = await self._classify_text(extracted_text, request_id)
            elif mime_type in SUPPORTED_AUDIO_TYPES:
                extracted_text, transcription, error_code, retryable = await self._process_audio(
                    filename=filename,
                    content=content,
                    mime_type=mime_type,
                    client_id=client_id,
                    request_id=request_id,
                )
                if transcription is None:
                    classification = self._fallback_classification(filename, "", source_modality)
                    warnings.append("audio_processing_unavailable")
                    extraction = ExtractionResult(fields={}, field_confidence={}, missing_fields=[])
                    response = ProcessResponse(
                        request_id=request_id,
                        status="failed_runtime",
                        mime_type=mime_type,
                        classification=classification,
                        extraction=extraction,
                        move_plan=MovePlan(reason="no_matching_rule"),
                        move_result=MoveResult(from_path=source_path),
                        timings=timings,
                        errors=[error_code or "audio_processing_unavailable"],
                        record_id=record_id,
                        source_modality=source_modality,
                        created_at=created_at,
                        transcription=None,
                        ui_kind="audio",
                        undo_token=None,
                        move_status="not_requested",
                        retryable=retryable,
                        error_code=error_code or "audio_processing_unavailable",
                        warnings=warnings,
                    )
                    self._persist_record(response)
                    await self._emit_event(
                        client_id,
                        {
                            "type": "job.failed",
                            "request_id": request_id,
                            "client_id": client_id,
                            "message": error_code or "audio_processing_unavailable",
                        },
                    )
                    return response
                classification, used_fallback = await self._classify_text(extracted_text, request_id)
            else:
                raise UnsupportedMediaTypeError(mime_type)

            timings["classify_ms"] = round((time.perf_counter() - classify_started) * 1000, 2)
            if used_fallback:
                error_code = "classification_validation_fallback"
                warnings.append("classifier_invalid_json_fallback")
            await self._progress(client_id, request_id, "classified", "Dokument klassificerat")

            await self._progress(client_id, request_id, "extracting", "Extraherar fält")
            extract_started = time.perf_counter()
            try:
                extraction = await self.extractor.extract(
                    extracted_text[: self.max_text_characters],
                    classification,
                    request_id=request_id,
                )
            except ExtractionValidationError:
                extraction = ExtractionResult(fields={}, field_confidence={}, missing_fields=[])
                warnings.append("extractor_invalid_json_fallback")
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
            move_status = "not_requested"
            status = "move_planned"
            undo_token: str | None = None

            if move_executor == "server" and execute_move and move_plan.auto_move_allowed and source_path:
                move_result = self.organizer.execute_move(move_plan, Path(source_path))
                if move_result.success:
                    move_status = "moved"
                    status = "move_executed"
                    if self.document_registry is not None and move_result.from_path and move_result.to_path:
                        undo_token = self.document_registry.record_move(
                            request_id=request_id,
                            record_id=record_id,
                            from_path=move_result.from_path,
                            to_path=move_result.to_path,
                            client_id=client_id,
                            executor="server",
                        ).undo_token
                else:
                    move_status = "move_failed"
                    status = "failed_runtime"
                    error_code = "move_failed"
            elif move_plan.destination:
                if move_plan.auto_move_allowed and move_executor == "client":
                    move_status = "auto_pending_client"
                elif move_plan.auto_move_allowed:
                    move_status = "planned"
                else:
                    move_status = "awaiting_confirmation"
                    await self._progress(
                        client_id,
                        request_id,
                        "awaiting_confirmation",
                        "Väntar på bekräftelse för filflytt",
                    )

            timings["organize_ms"] = round((time.perf_counter() - plan_started) * 1000, 2)

            if self.search_pipeline is not None:
                await self._progress(client_id, request_id, "indexing", "Indexerar dokument")
                indexed_source_path = move_result.to_path or source_path or filename
                upsert_result = self.search_pipeline.upsert_document(
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
                if inspect.isawaitable(upsert_result):
                    await upsert_result

            ui_kind = self._resolve_ui_kind(
                document_type=classification.document_type,
                source_modality=source_modality,
            )
            if move_status == "awaiting_confirmation":
                status = "move_planned"
            response = ProcessResponse(
                request_id=request_id,
                status=status,
                mime_type=mime_type,
                classification=classification,
                extraction=extraction,
                move_plan=self._coerce_move_reason(move_plan, execute_move, move_executor),
                move_result=move_result,
                timings=timings,
                errors=errors,
                record_id=record_id,
                source_modality=source_modality,
                created_at=created_at,
                transcription=transcription,
                ui_kind=ui_kind,
                undo_token=undo_token,
                move_status=move_status,
                retryable=retryable,
                error_code=error_code,
                warnings=warnings,
            )
            self._persist_record(response)

            if undo_token is not None and move_result.from_path and move_result.to_path:
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
                await self._progress(client_id, request_id, "moved", "Filen flyttades")

            if move_status not in {"auto_pending_client", "awaiting_confirmation"}:
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

    async def _classify_image(self, content: bytes, mime_type: str, request_id: str) -> tuple[DocumentClassification, bool]:
        try:
            return await self.classifier.classify_image(content, mime_type, request_id=request_id), False
        except ClassificationValidationError:
            return self._fallback_classification("image-document", "", "image"), True

    async def _classify_text(self, text: str, request_id: str) -> tuple[DocumentClassification, bool]:
        try:
            return await self.classifier.classify_text(
                text[: self.max_text_characters],
                request_id=request_id,
            ), False
        except ClassificationValidationError:
            return self._fallback_classification("generic-document", text, "text"), True

    async def _process_audio(
        self,
        *,
        filename: str,
        content: bytes,
        mime_type: str,
        client_id: str | None,
        request_id: str,
    ) -> tuple[str, TranscriptionResponse | None, str | None, bool]:
        if self.whisper_service is None:
            return "", None, "audio_processing_unavailable", True
        await self._progress(client_id, request_id, "transcribing", "Transkriberar ljud")
        try:
            transcription = await self.whisper_service.transcribe(
                filename=filename,
                content=content,
                content_type=mime_type,
                client_id=client_id,
                client_request_id=request_id,
            )
            return transcription.text, transcription, None, False
        except WhisperProxyError as error:
            retryable = error.status_code >= 500
            return "", None, "audio_processing_unavailable", retryable

    def _persist_record(self, response: ProcessResponse) -> None:
        if self.document_registry is None:
            return
        self.document_registry.upsert_document(
            UiDocumentRecord(
                id=response.record_id or str(uuid4()),
                request_id=response.request_id,
                title=response.classification.title,
                summary=response.classification.summary,
                mime_type=response.mime_type,
                source_modality=response.source_modality or "text",
                kind=response.ui_kind or "generic",
                document_type=response.classification.document_type,
                template=response.classification.template,
                source_path=response.move_result.to_path or response.move_result.from_path,
                created_at=response.created_at or datetime.now(UTC).isoformat(),
                updated_at=datetime.now(UTC).isoformat(),
                classification=response.classification,
                extraction=response.extraction,
                transcription=response.transcription,
                move_plan=response.move_plan,
                move_result=response.move_result,
                tags=response.classification.tags,
                status="completed" if response.status in {"move_planned", "move_executed"} and response.move_status not in {"awaiting_confirmation", "auto_pending_client"} else response.status,
                undo_token=response.undo_token,
                move_status=response.move_status,
                retryable=response.retryable,
                error_code=response.error_code,
                warnings=response.warnings,
            )
        )

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
    def _coerce_move_reason(move_plan: MovePlan, execute_move: bool, move_executor: MoveExecutor) -> MovePlan:
        if move_executor == "client" and move_plan.auto_move_allowed:
            return move_plan.model_copy(update={"reason": "client_move_pending"})
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

    @staticmethod
    def _fallback_classification(filename: str, extracted_text: str, source_modality: SourceModality) -> DocumentClassification:
        summary_source = extracted_text.strip() or filename
        return DocumentClassification(
            document_type="generic",
            template="generic",
            title=Path(filename).stem or filename,
            summary=summary_source[:280],
            tags=[],
            language="unknown",
            confidence=0.0,
            ocr_text=summary_source[:280] if source_modality == "image" else None,
            suggested_actions=[],
        )

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
