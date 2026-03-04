from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from server.main import create_app
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MovePlan,
    MoveResult,
    ProcessResponse,
)


class FakePipeline:
    def __init__(self) -> None:
        self.classifier = object()
        self.extractor = object()
        self.organizer = object()

    async def process_upload(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str | None,
        execute_move: bool,
        source_path: str | None,
    ) -> ProcessResponse:
        return ProcessResponse(
            request_id="req-123",
            status="move_planned",
            mime_type=content_type or "text/plain",
            classification=DocumentClassification(
                document_type="invoice",
                template="invoice",
                title=filename,
                summary="summary",
                tags=["invoice"],
                language="sv",
                confidence=0.93,
                ocr_text=None,
                suggested_actions=["review"],
            ),
            extraction=ExtractionResult(
                fields={"invoice_number": "INV-123"},
                field_confidence={"invoice_number": 0.99},
                missing_fields=[],
            ),
            move_plan=MovePlan(
                rule_name="invoices",
                destination="/tmp/Fakturor/2026/03",
                auto_move_allowed=False,
                reason="execute_move_disabled",
            ),
            move_result=MoveResult(
                attempted=False,
                success=False,
                from_path=source_path,
                to_path=None,
                error=None,
            ),
            timings={"classify_ms": 1.0, "extract_ms": 1.0},
            errors=[],
        )


def test_create_app_keeps_existing_routes_and_mounts_mcp() -> None:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=lambda: {"ready": True, "checks": {"ollama": True, "model": True, "prompts": True}},
        validation_report_loader=lambda: {"status": "ok"},
    )

    with TestClient(app) as client:
        health = client.get("/healthz")
        ready = client.get("/readyz")
        mcp_entry = client.get("/mcp")

    assert health.status_code == 200
    assert ready.status_code == 200
    assert mcp_entry.status_code != 404


@pytest.mark.asyncio
async def test_mcp_client_lists_tools_and_calls_search() -> None:
    app = create_app()
    session_context = app.state.mcp_server.session_manager.run()
    await session_context.__aenter__()

    def build_client(
        headers: dict[str, str] | None = None,
        timeout: httpx.Timeout | None = None,
        auth: httpx.Auth | None = None,
    ) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers=headers,
            timeout=timeout,
            auth=auth,
        )

    async with streamablehttp_client(
        "http://testserver/mcp",
        httpx_client_factory=build_client,
    ) as streams:
        read_stream, write_stream, _ = streams
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            tools = await session.list_tools()
            result = await session.call_tool("search", {"query": "validation"})
    await session_context.__aexit__(None, None, None)

    names = {tool.name for tool in tools.tools}
    assert "search" in names
    assert "organize_file" in names
    assert result.isError is False
