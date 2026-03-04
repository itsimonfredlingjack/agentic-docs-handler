from __future__ import annotations

import mimetypes
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from server.clients.ollama_client import OllamaServiceError
from server.mcp.read_tools import error_result, structured_result, validate_local_file
from server.mcp.schemas import OrganizeFileInput
from server.mcp.services import AppServices
from server.mcp.toolsets import WRITE_ANNOTATIONS
from server.pipelines.classifier import ClassificationValidationError
from server.pipelines.extractor import ExtractionValidationError
from server.pipelines.process_pipeline import UnsupportedMediaTypeError


def detect_content_type(path: Path) -> str | None:
    mime_type, _ = mimetypes.guess_type(path.name)
    return mime_type


def register_write_tools(server: FastMCP, services: AppServices) -> None:
    @server.tool(
        name="organize_file",
        description="Use this when you need to move a local file on disk using the active file organization rules.",
        annotations=WRITE_ANNOTATIONS,
    )
    async def organize_file(source_path: str):
        try:
            validated = OrganizeFileInput(source_path=source_path)
            path = validate_local_file(services, validated.source_path)
            result = await services.pipeline.process_upload(
                filename=path.name,
                content=path.read_bytes(),
                content_type=detect_content_type(path),
                execute_move=True,
                source_path=str(path),
                move_executor="server",
            )
            return structured_result("File organized successfully.", result.model_dump(mode="json"))
        except (FileNotFoundError, ValueError, UnsupportedMediaTypeError) as error:
            return error_result(str(error))
        except (ClassificationValidationError, ExtractionValidationError, OllamaServiceError) as error:
            return error_result(str(error))
