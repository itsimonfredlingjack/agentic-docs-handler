from __future__ import annotations

import json
import mimetypes
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, TextContent

from server.clients.ollama_client import OllamaServiceError
from server.mcp.schemas import (
    ActivityLogInput,
    ClassifyImageInput,
    ClassifyTextInput,
    ExtractFieldsInput,
    FetchInput,
    PreviewDocumentProcessingInput,
    SearchInput,
    SearchDocumentsInput,
)
from server.mcp.services import AppServices
from server.mcp.toolsets import READ_ONLY_ANNOTATIONS
from server.pipelines.classifier import ClassificationValidationError
from server.pipelines.extractor import ExtractionValidationError
from server.pipelines.process_pipeline import UnsupportedMediaTypeError

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


def text_result(text: str) -> CallToolResult:
    return CallToolResult(content=[TextContent(type="text", text=text)])


def structured_result(message: str, payload: dict[str, object], *, meta: dict[str, object] | None = None) -> CallToolResult:
    return CallToolResult(
        content=[TextContent(type="text", text=message)],
        structuredContent=payload,
        _meta=meta,
    )


def error_result(message: str) -> CallToolResult:
    return CallToolResult(
        content=[TextContent(type="text", text=message)],
        structuredContent={"error": message},
        isError=True,
    )


def summarize_validation_report(report: dict[str, object]) -> str:
    status = report.get("status", "unknown")
    parse_rate = report.get("parse_rate")
    if parse_rate is None:
        return f"Validation report status: {status}."
    return f"Validation report status: {status}. Parse rate: {parse_rate}."


def build_search_payload(services: AppServices, query: str) -> dict[str, object]:
    needle = query.casefold()
    ranked: list[tuple[int, str]] = []
    for doc_id, document in services.documents.items():
        haystack = f"{document.title}\n{document.text}\n{document.url}".casefold()
        score = haystack.count(needle)
        if score > 0:
            ranked.append((score, doc_id))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return {
        "results": [
            {
                "id": services.documents[doc_id].doc_id,
                "title": services.documents[doc_id].title,
                "url": services.documents[doc_id].url,
            }
            for _, doc_id in ranked
        ]
    }


def detect_image_mime(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    return mime_type or "application/octet-stream"


def validate_local_file(services: AppServices, raw_path: str) -> Path:
    path = services.resolve_path(raw_path)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(str(path))
    return path


def register_read_tools(server: FastMCP, services: AppServices) -> None:
    @server.tool(
        name="search",
        description="Use this when you need to search the project knowledge documents bundled with the backend.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def search(query: str) -> CallToolResult:
        payload = build_search_payload(services, SearchInput(query=query).query)
        return text_result(json.dumps(payload, ensure_ascii=True))

    @server.tool(
        name="search_documents",
        description="Use this when you need semantic and keyword search across indexed documents handled by the search pipeline.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def search_documents(query: str, limit: int = 5) -> CallToolResult:
        validated = SearchDocumentsInput(query=query, limit=limit)
        if services.search_service is None:
            return error_result("search_unavailable")
        result = await services.search_service.search(validated.query, limit=validated.limit)
        payload = result.model_dump(mode="json")
        return structured_result(result.answer, payload)

    @server.tool(
        name="fetch",
        description="Use this when you need the full text for a document returned by search.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def fetch(id: str) -> CallToolResult:
        doc_id = FetchInput(id=id).id
        document = services.documents.get(doc_id)
        if document is None:
            return error_result(f"unknown_document_id:{doc_id}")
        payload = {
            "id": document.doc_id,
            "title": document.title,
            "text": document.text,
            "url": document.url,
            "metadata": document.metadata,
        }
        return text_result(json.dumps(payload, ensure_ascii=True))

    @server.tool(
        name="get_system_status",
        description="Use this when you need the current backend readiness, model configuration, and active phase.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def get_system_status() -> CallToolResult:
        readiness = services.readiness_probe()
        payload = {
            "phase": services.root_status["phase"],
            "status": services.root_status["status"],
            "readiness": readiness,
            "model": services.config.ollama_model,
            "prompt_availability": {str(path): path.exists() for path in services.prompt_paths()},
        }
        return structured_result("System status loaded.", payload)

    @server.tool(
        name="get_validation_report",
        description="Use this when you need the latest validation report for the current backend.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def get_validation_report() -> CallToolResult:
        report = services.validation_report_loader()
        return structured_result(summarize_validation_report(report), {"report": report})

    @server.tool(
        name="classify_text",
        description="Use this when you need only the classification step for document text without moving any file.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def classify_text(text: str) -> CallToolResult:
        try:
            validated = ClassifyTextInput(text=text)
            if services.classifier is None:
                return error_result("classifier_unavailable")
            snippet = validated.text[: services.config.max_text_characters]
            result = await services.classifier.classify_text(snippet)
            payload = result.model_dump(mode="json")
            if len(validated.text) > services.config.max_text_characters:
                payload["truncated"] = True
            return structured_result("Text classified successfully.", payload)
        except (ClassificationValidationError, OllamaServiceError) as error:
            return error_result(str(error))

    @server.tool(
        name="classify_image",
        description="Use this when you need image-based document classification from a local file path.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def classify_image(image_path: str) -> CallToolResult:
        try:
            validated = ClassifyImageInput(image_path=image_path)
            if services.classifier is None:
                return error_result("classifier_unavailable")
            path = validate_local_file(services, validated.image_path)
            if path.stat().st_size > services.config.mcp_max_image_bytes:
                return error_result(f"image exceeds max size of {services.config.mcp_max_image_bytes} bytes")
            mime_type = detect_image_mime(path)
            if mime_type not in ALLOWED_IMAGE_TYPES:
                return error_result(f"unsupported_image_type:{mime_type}")
            result = await services.classifier.classify_image(path.read_bytes(), mime_type)
            return structured_result("Image classified successfully.", result.model_dump(mode="json"))
        except (FileNotFoundError, ValueError) as error:
            return error_result(str(error))
        except (ClassificationValidationError, OllamaServiceError) as error:
            return error_result(str(error))

    @server.tool(
        name="extract_fields",
        description="Use this when you need structured extraction from text using a known classification.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def extract_fields(text: str, classification: dict[str, object]) -> CallToolResult:
        try:
            validated = ExtractFieldsInput(text=text, classification=classification)
            if services.extractor is None:
                return error_result("extractor_unavailable")
            snippet = validated.text[: services.config.max_text_characters]
            result = await services.extractor.extract(
                snippet,
                validated.classification,
                request_id="mcp-extract-fields",
            )
            payload = result.model_dump(mode="json")
            if len(validated.text) > services.config.max_text_characters:
                payload["truncated"] = True
            return structured_result("Fields extracted successfully.", payload)
        except (ExtractionValidationError, OllamaServiceError) as error:
            return error_result(str(error))

    @server.tool(
        name="preview_document_processing",
        description="Use this when you need a full non-mutating preview of how the backend would process a local file.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def preview_document_processing(source_path: str) -> CallToolResult:
        try:
            validated = PreviewDocumentProcessingInput(source_path=source_path)
            path = validate_local_file(services, validated.source_path)
            mime_type = detect_image_mime(path) if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"} else None
            result = await services.pipeline.process_upload(
                filename=path.name,
                content=path.read_bytes(),
                content_type=mime_type,
                execute_move=False,
                source_path=str(path),
            )
            return structured_result("Document processing preview generated.", result.model_dump(mode="json"))
        except (FileNotFoundError, ValueError, UnsupportedMediaTypeError) as error:
            return error_result(str(error))
        except (ClassificationValidationError, ExtractionValidationError, OllamaServiceError) as error:
            return error_result(str(error))

    @server.tool(
        name="list_file_rules",
        description="Use this when you need to inspect the current file organization rules and destinations.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def list_file_rules() -> CallToolResult:
        payload = services.load_file_rules()
        return structured_result("File organization rules loaded.", payload)

    @server.tool(
        name="get_activity_log",
        description="Use this when you need recent validation or processing activity events from backend logs.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def get_activity_log(limit: int = 10) -> CallToolResult:
        validated = ActivityLogInput(limit=limit)
        payload = {"events": services.load_activity_events(validated.limit)}
        return structured_result("Recent activity loaded.", payload)
