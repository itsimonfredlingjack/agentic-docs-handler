from __future__ import annotations

import json
import mimetypes
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, TextContent, ToolAnnotations

from server.mcp.chatgpt_app_types import (
    AnalyzeUploadedInput,
    ConfirmOrganizeInput,
    PreviewOrganizeInput,
    RenderConsoleInput,
    SessionFetchInput,
    SessionSearchInput,
)
from server.mcp.chatgpt_file_ingest import UploadIngestError, download_uploaded_file
from server.mcp.chatgpt_sessions import ChatGPTSessionStore, SessionStoreError
from server.mcp.chatgpt_widget_resource import WIDGET_RESOURCE_URI
from server.mcp.read_tools import build_search_payload
from server.mcp.services import AppServices
from server.mcp.toolsets import READ_ONLY_ANNOTATIONS, WRITE_ANNOTATIONS

AUDIO_MIME_PREFIX = "audio/"

RENDER_META: dict[str, object] = {
    "ui": {
        "resourceUri": WIDGET_RESOURCE_URI,
        "visibility": ["model", "app"],
    },
    "openai/outputTemplate": WIDGET_RESOURCE_URI,
    "openai/toolInvocation/invoking": "Opening docs console...",
    "openai/toolInvocation/invoked": "Docs console ready.",
}

FILE_TOOL_META: dict[str, object] = {
    "ui": {
        "visibility": ["model", "app"],
    },
    "openai/fileParams": ["file"],
}

WRITE_GUARDED_ANNOTATIONS = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=False,
)


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


def _document_text_from_process_payload(payload: dict[str, Any]) -> str:
    classification = payload.get("classification", {})
    extraction = payload.get("extraction", {})
    summary = str(classification.get("summary") or "")
    ocr = str(classification.get("ocr_text") or "")
    extracted = extraction.get("fields", {})
    pieces = [piece for piece in [summary, ocr] if piece.strip()]
    if extracted:
        pieces.append(f"fields: {json.dumps(extracted, ensure_ascii=True)}")
    return "\n\n".join(pieces) or "No extracted content."


def _session_doc_url(session_id: str, document_id: str) -> str:
    return f"session://{session_id}/{document_id}"


def _as_audio(content_type: str, filename: str) -> bool:
    if content_type.startswith(AUDIO_MIME_PREFIX):
        return True
    guessed, _ = mimetypes.guess_type(filename)
    return bool(guessed and guessed.startswith(AUDIO_MIME_PREFIX))


def register_chatgpt_tools(server: FastMCP, services: AppServices, store: ChatGPTSessionStore) -> None:
    @server.tool(
        name="render_docs_console",
        description="Use this when you want to open the interactive docs console widget in ChatGPT.",
        annotations=READ_ONLY_ANNOTATIONS,
        meta=RENDER_META,
    )
    async def render_docs_console(session_id: str | None = None, query: str | None = None) -> CallToolResult:
        validated = RenderConsoleInput(session_id=session_id, query=query)
        resolved_session_id = store.get_or_create_session(validated.session_id)
        normalized_query = (validated.query or "").strip()
        if normalized_query:
            try:
                results = store.search_documents(session_id=resolved_session_id, query=normalized_query, limit=10)
            except SessionStoreError:
                results = []
            if not results:
                fallback = build_search_payload(services, normalized_query)
                results = fallback.get("results", [])[:10]
        else:
            results = []
        payload = {
            "session_id": resolved_session_id,
            "query": normalized_query,
            "results": results,
        }
        return structured_result(
            "Docs console ready.",
            payload,
            meta={"widget": {"resourceUri": WIDGET_RESOURCE_URI, "stateVersion": 1}},
        )

    @server.tool(
        name="analyze_uploaded_document",
        description="Use this when you need to analyze an uploaded image, PDF, or text document from ChatGPT.",
        annotations=READ_ONLY_ANNOTATIONS,
        meta={
            **FILE_TOOL_META,
            "openai/toolInvocation/invoking": "Analyzing uploaded document...",
            "openai/toolInvocation/invoked": "Document analysis complete.",
        },
    )
    async def analyze_uploaded_document(
        file: dict[str, object],
        session_id: str | None = None,
        language: str | None = None,
    ) -> CallToolResult:
        try:
            validated = AnalyzeUploadedInput(file=file, session_id=session_id, language=language)
            resolved_session_id = store.get_or_create_session(validated.session_id)
            upload = await download_uploaded_file(
                config=services.config,
                file_ref=validated.file,
                session_id=resolved_session_id,
            )
            result = await services.pipeline.process_upload(
                filename=upload.filename,
                content=upload.path.read_bytes(),
                content_type=upload.mime_type,
                execute_move=False,
                source_path=str(upload.path),
                move_executor="none",
            )
            payload = result.model_dump(mode="json")
            doc_title = payload.get("classification", {}).get("title") or upload.filename
            doc_id = store.record_document(
                session_id=resolved_session_id,
                title=str(doc_title),
                text=_document_text_from_process_payload(payload),
                url="",
                metadata={"kind": "processed_upload", "request_id": payload.get("request_id")},
            )
            payload.update(
                {
                    "session_id": resolved_session_id,
                    "document_id": doc_id,
                    "document_url": _session_doc_url(resolved_session_id, doc_id),
                }
            )
            return structured_result("Uploaded document analyzed.", payload)
        except (UploadIngestError, ValueError, SessionStoreError) as error:
            return error_result(str(error))

    @server.tool(
        name="transcribe_uploaded_audio",
        description="Use this when you need to transcribe an uploaded audio file from ChatGPT.",
        annotations=READ_ONLY_ANNOTATIONS,
        meta={
            **FILE_TOOL_META,
            "openai/toolInvocation/invoking": "Transcribing uploaded audio...",
            "openai/toolInvocation/invoked": "Audio transcription complete.",
        },
    )
    async def transcribe_uploaded_audio(
        file: dict[str, object],
        session_id: str | None = None,
        language: str | None = None,
    ) -> CallToolResult:
        try:
            validated = AnalyzeUploadedInput(file=file, session_id=session_id, language=language)
            resolved_session_id = store.get_or_create_session(validated.session_id)
            upload = await download_uploaded_file(
                config=services.config,
                file_ref=validated.file,
                session_id=resolved_session_id,
            )
            if not _as_audio(upload.mime_type, upload.filename):
                return error_result("uploaded_file_is_not_audio")
            if services.whisper_service is None:
                return error_result("whisper_unavailable")
            result = await services.whisper_service.transcribe(
                filename=upload.filename,
                content=upload.path.read_bytes(),
                content_type=upload.mime_type,
                language=validated.language,
            )
            payload = result.model_dump(mode="json")
            doc_id = store.record_document(
                session_id=resolved_session_id,
                title=upload.filename,
                text=str(payload.get("text") or ""),
                url="",
                metadata={"kind": "transcription", "model": payload.get("model")},
            )
            payload.update(
                {
                    "session_id": resolved_session_id,
                    "document_id": doc_id,
                    "document_url": _session_doc_url(resolved_session_id, doc_id),
                }
            )
            return structured_result("Uploaded audio transcribed.", payload)
        except (UploadIngestError, ValueError, SessionStoreError) as error:
            return error_result(str(error))

    @server.tool(
        name="search_session_documents",
        description="Use this when you need to search documents already processed in a ChatGPT app session.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def search_session_documents(session_id: str, query: str, limit: int = 5) -> CallToolResult:
        try:
            validated = SessionSearchInput(session_id=session_id, query=query, limit=limit)
            results = store.search_documents(
                session_id=validated.session_id,
                query=validated.query,
                limit=validated.limit,
            )
            payload = {
                "session_id": validated.session_id,
                "results": results,
            }
            return structured_result("Session search completed.", payload)
        except (SessionStoreError, ValueError) as error:
            return error_result(str(error))

    @server.tool(
        name="fetch_session_document",
        description="Use this when you need full content for a session document returned by search_session_documents.",
        annotations=READ_ONLY_ANNOTATIONS,
    )
    async def fetch_session_document(session_id: str, id: str) -> CallToolResult:
        try:
            validated = SessionFetchInput(session_id=session_id, id=id)
            payload = store.fetch_document(session_id=validated.session_id, document_id=validated.id)
            payload["session_id"] = validated.session_id
            return text_result(json.dumps(payload, ensure_ascii=True))
        except (SessionStoreError, ValueError) as error:
            return error_result(str(error))

    @server.tool(
        name="preview_organize_uploaded",
        description="Use this when you want a safe preview plan before organizing an uploaded document.",
        annotations=READ_ONLY_ANNOTATIONS,
        meta={
            **FILE_TOOL_META,
            "openai/toolInvocation/invoking": "Preparing organize preview...",
            "openai/toolInvocation/invoked": "Organize preview ready.",
        },
    )
    async def preview_organize_uploaded(file: dict[str, object], session_id: str | None = None) -> CallToolResult:
        try:
            validated = PreviewOrganizeInput(file=file, session_id=session_id)
            resolved_session_id = store.get_or_create_session(validated.session_id)
            upload = await download_uploaded_file(
                config=services.config,
                file_ref=validated.file,
                session_id=resolved_session_id,
            )
            result = await services.pipeline.process_upload(
                filename=upload.filename,
                content=upload.path.read_bytes(),
                content_type=upload.mime_type,
                execute_move=False,
                source_path=str(upload.path),
                move_executor="none",
            )
            preview_payload = result.model_dump(mode="json")
            plan = store.create_write_plan(
                session_id=resolved_session_id,
                upload=upload,
                preview_payload=preview_payload,
            )
            payload = {
                "session_id": resolved_session_id,
                "preview": preview_payload,
                **plan,
            }
            return structured_result("Organize preview generated. Confirm before write.", payload)
        except (UploadIngestError, ValueError, SessionStoreError) as error:
            return error_result(str(error))

    @server.tool(
        name="confirm_organize_uploaded",
        description="Use this when you are ready to execute a previously previewed organize plan.",
        annotations=WRITE_GUARDED_ANNOTATIONS if services.config.chatgpt_write_guard_enabled else WRITE_ANNOTATIONS,
        meta={
            "ui": {"visibility": ["model", "app"]},
            "openai/toolInvocation/invoking": "Executing file organization...",
            "openai/toolInvocation/invoked": "File organization complete.",
        },
    )
    async def confirm_organize_uploaded(
        write_plan_id: str,
        confirm_token: str,
        idempotency_key: str,
    ) -> CallToolResult:
        try:
            validated = ConfirmOrganizeInput(
                write_plan_id=write_plan_id,
                confirm_token=confirm_token,
                idempotency_key=idempotency_key,
            )
            plan, existing = store.consume_write_plan(
                write_plan_id=validated.write_plan_id,
                confirm_token=validated.confirm_token,
                idempotency_key=validated.idempotency_key,
            )
            if existing is not None:
                return structured_result("Idempotent result replayed.", existing)
            if not plan.upload.path.exists():
                return error_result("staged_file_missing")

            result = await services.pipeline.process_upload(
                filename=plan.upload.filename,
                content=plan.upload.path.read_bytes(),
                content_type=plan.upload.mime_type,
                execute_move=True,
                source_path=str(plan.upload.path),
                move_executor="server",
            )
            payload = {
                "write_plan_id": validated.write_plan_id,
                "session_id": plan.session_id,
                "result": result.model_dump(mode="json"),
            }
            store.save_idempotent_result(
                write_plan_id=validated.write_plan_id,
                idempotency_key=validated.idempotency_key,
                payload=payload,
            )
            return structured_result("Organize action confirmed and executed.", payload)
        except (SessionStoreError, ValueError) as error:
            return error_result(str(error))
