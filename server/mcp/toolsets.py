from __future__ import annotations

from mcp.types import ToolAnnotations

READ_ONLY_ANNOTATIONS = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=False,
)

WRITE_ANNOTATIONS = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=False,
    idempotentHint=False,
    openWorldHint=False,
)

READ_TOOL_NAMES = (
    "search",
    "search_documents",
    "transcribe_audio",
    "fetch",
    "get_system_status",
    "get_validation_report",
    "classify_text",
    "classify_image",
    "extract_fields",
    "preview_document_processing",
    "list_file_rules",
    "get_activity_log",
)

WRITE_TOOL_NAMES = ("organize_file",)
