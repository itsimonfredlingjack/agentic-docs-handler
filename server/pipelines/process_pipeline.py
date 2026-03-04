from __future__ import annotations

import mimetypes
import time
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from docx import Document as DocxDocument
from pypdf import PdfReader

from server.clients.ollama_client import OllamaServiceError
from server.pipelines.classifier import ClassificationValidationError, DocumentClassifier
from server.pipelines.extractor import DocumentExtractor, ExtractionValidationError
from server.pipelines.file_organizer import FileOrganizer
from server.pipelines.search import IndexedDocument
from server.schemas import ExtractionResult, MovePlan, MoveResult, ProcessResponse

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


class UnsupportedMediaTypeError(ValueError):
    """Raised for file types that the current processing pipeline does not support."""


class DocumentProcessPipeline:
    def __init__(
        self,
        *,
        classifier: DocumentClassifier,
        extractor: DocumentExtractor,
        organizer: FileOrganizer,
        search_pipeline: object | None = None,
        max_text_characters: int = 12000,
    ) -> None:
        self.classifier = classifier
        self.extractor = extractor
        self.organizer = organizer
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
    ) -> ProcessResponse:
        request_id = str(uuid4())
        mime_type = self._detect_mime(filename, content_type)
        timings: dict[str, float] = {}
        errors: list[str] = []

        classify_started = time.perf_counter()
        if mime_type in SUPPORTED_IMAGE_TYPES:
            classification = await self.classifier.classify_image(
                content,
                mime_type,
                request_id=request_id,
            )
            extracted_text = classification.ocr_text or classification.summary
        elif mime_type in SUPPORTED_TEXT_TYPES:
            extracted_text = self._extract_text(content, mime_type)
            classification = await self.classifier.classify_text(
                extracted_text[: self.max_text_characters],
                request_id=request_id,
            )
        else:
            raise UnsupportedMediaTypeError(mime_type)
        timings["classify_ms"] = round((time.perf_counter() - classify_started) * 1000, 2)

        extract_started = time.perf_counter()
        extraction = await self.extractor.extract(
            extracted_text[: self.max_text_characters],
            classification,
            request_id=request_id,
        )
        timings["extract_ms"] = round((time.perf_counter() - extract_started) * 1000, 2)

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
            indexed_source_path = move_result.to_path or source_path or filename
            self.search_pipeline.upsert_document(
                IndexedDocument(
                    doc_id=source_path or request_id,
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

        return ProcessResponse(
            request_id=request_id,
            status=status,
            mime_type=mime_type,
            classification=classification,
            extraction=extraction,
            move_plan=self._coerce_move_reason(move_plan, execute_move),
            move_result=move_result,
            timings=timings,
            errors=errors,
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
    def _coerce_move_reason(move_plan: MovePlan, execute_move: bool) -> MovePlan:
        if not execute_move and move_plan.auto_move_allowed:
            return move_plan.model_copy(update={"reason": "execute_move_disabled"})
        return move_plan


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
