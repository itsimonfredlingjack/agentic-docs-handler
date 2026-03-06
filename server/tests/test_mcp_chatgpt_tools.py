from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.config import AppConfig
from server.mcp.app import create_mcp_server, mount_mcp_server
from server.mcp.chatgpt_file_ingest import DownloadedUpload, ensure_allowed_download_host
from server.mcp.chatgpt_sessions import ChatGPTSessionStore
from server.mcp.chatgpt_widget_resource import WIDGET_RESOURCE_MIME, WIDGET_RESOURCE_URI
from server.mcp.services import AppServices, KnowledgeDocument
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MovePlan,
    MoveResult,
    ProcessResponse,
    TranscriptionResponse,
    TranscriptionSegment,
)


class FakePipeline:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def process_upload(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str | None,
        execute_move: bool,
        source_path: str | None,
        move_executor: str = "none",
    ) -> ProcessResponse:
        self.calls.append(
            {
                "filename": filename,
                "execute_move": execute_move,
                "source_path": source_path,
                "move_executor": move_executor,
            }
        )
        return ProcessResponse(
            request_id="req-chatgpt",
            status="move_executed" if execute_move else "move_planned",
            mime_type=content_type or "text/plain",
            classification=DocumentClassification(
                document_type="invoice",
                template="invoice",
                title="Invoice from upload",
                summary="Invoice summary",
                tags=["invoice"],
                language="sv",
                confidence=0.9,
                ocr_text="OCR text",
                suggested_actions=["review"],
            ),
            extraction=ExtractionResult(
                fields={"invoice_number": "INV-42"},
                field_confidence={"invoice_number": 0.95},
                missing_fields=[],
            ),
            move_plan=MovePlan(
                rule_name="invoices",
                destination="/tmp/Fakturor/2026/03",
                auto_move_allowed=True,
                reason="rule_matched",
            ),
            move_result=MoveResult(
                attempted=execute_move,
                success=execute_move,
                from_path=source_path,
                to_path="/tmp/Fakturor/2026/03/invoice.pdf" if execute_move else None,
                error=None,
            ),
            timings={"classify_ms": 1.0, "extract_ms": 1.0, "organize_ms": 1.0},
            errors=[],
            move_status="moved" if execute_move else "planned",
            retryable=False,
            warnings=[],
        )


class FakeWhisperService:
    async def transcribe(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str | None,
        language: str | None = None,
    ) -> TranscriptionResponse:
        return TranscriptionResponse(
            text="Transcribed text",
            language=language or "sv",
            language_probability=0.9,
            duration=1.0,
            duration_after_vad=0.9,
            model="large-v3-turbo",
            segments=[TranscriptionSegment(start=0.0, end=1.0, text="Transcribed text")],
        )


@pytest.fixture
def services(tmp_path: Path) -> AppServices:
    config = AppConfig(
        validation_report_path=tmp_path / "validation.json",
        validation_log_dir=tmp_path,
        file_rules_path=Path("server/file_rules.yaml"),
        mcp_allowed_roots=[tmp_path],
        chatgpt_upload_staging_dir=tmp_path / "uploads",
        chatgpt_allowed_download_hosts=["localhost", "files.oaiusercontent.com"],
    )
    config.validation_report_path.write_text(json.dumps({"status": "ok"}), encoding="utf-8")

    pipeline = FakePipeline()
    return AppServices(
        config=config,
        pipeline=pipeline,
        classifier=None,
        extractor=None,
        organizer=None,
        whisper_service=FakeWhisperService(),
        search_service=None,
        readiness_probe=lambda: {"ready": True, "checks": {}},
        validation_report_loader=lambda: {"status": "ok"},
        documents={
            "design-spec": KnowledgeDocument(
                doc_id="design-spec",
                title="Design Spec",
                url="agentic-docs-design-spec.md",
                text="Invoice baseline content",
                metadata={"kind": "spec"},
            )
        },
    )


@pytest.mark.asyncio
async def test_chatgpt_tool_metadata_and_widget_resource_present(services: AppServices) -> None:
    server = create_mcp_server(services)

    tools = await server.list_tools()
    resources = await server.list_resources()

    by_name = {tool.name: tool for tool in tools}
    assert "render_docs_console" in by_name
    assert "analyze_uploaded_document" in by_name
    assert by_name["render_docs_console"].meta["ui"]["resourceUri"] == WIDGET_RESOURCE_URI
    assert by_name["render_docs_console"].meta["openai/outputTemplate"] == WIDGET_RESOURCE_URI
    assert by_name["analyze_uploaded_document"].meta["openai/fileParams"] == ["file"]

    widget = next(resource for resource in resources if str(resource.uri) == WIDGET_RESOURCE_URI)
    assert widget.mimeType == WIDGET_RESOURCE_MIME


@pytest.mark.asyncio
async def test_analyze_then_search_and_fetch_session_documents(
    services: AppServices,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upload_path = tmp_path / "invoice.pdf"
    upload_path.write_bytes(b"%PDF-1.7 fake")

    async def fake_download_uploaded_file(*, config: AppConfig, file_ref, session_id: str) -> DownloadedUpload:
        return DownloadedUpload(
            file_id=str(file_ref.file_id),
            session_id=session_id,
            download_url=str(file_ref.download_url),
            path=upload_path,
            filename="invoice.pdf",
            mime_type="application/pdf",
            size_bytes=upload_path.stat().st_size,
        )

    monkeypatch.setattr("server.mcp.chatgpt_tools.download_uploaded_file", fake_download_uploaded_file)

    server = create_mcp_server(services)

    analyze = await server.call_tool(
        "analyze_uploaded_document",
        {
            "file": {"download_url": "https://files.oaiusercontent.com/file-1", "file_id": "file-1"},
        },
    )
    assert analyze.isError is False
    session_id = analyze.structuredContent["session_id"]
    document_id = analyze.structuredContent["document_id"]

    search = await server.call_tool(
        "search_session_documents",
        {
            "session_id": session_id,
            "query": "invoice",
            "limit": 5,
        },
    )
    assert search.isError is False
    assert search.structuredContent["results"]

    fetched = await server.call_tool(
        "fetch_session_document",
        {
            "session_id": session_id,
            "id": document_id,
        },
    )
    assert fetched.isError is False
    payload = json.loads(fetched.content[0].text)
    assert payload["id"] == document_id
    assert "Invoice summary" in payload["text"]


@pytest.mark.asyncio
async def test_preview_and_confirm_write_are_guarded_and_idempotent(
    services: AppServices,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upload_path = tmp_path / "invoice.pdf"
    upload_path.write_bytes(b"%PDF-1.7 fake")

    async def fake_download_uploaded_file(*, config: AppConfig, file_ref, session_id: str) -> DownloadedUpload:
        return DownloadedUpload(
            file_id=str(file_ref.file_id),
            session_id=session_id,
            download_url=str(file_ref.download_url),
            path=upload_path,
            filename="invoice.pdf",
            mime_type="application/pdf",
            size_bytes=upload_path.stat().st_size,
        )

    monkeypatch.setattr("server.mcp.chatgpt_tools.download_uploaded_file", fake_download_uploaded_file)

    server = create_mcp_server(services)
    pipeline = services.pipeline

    preview = await server.call_tool(
        "preview_organize_uploaded",
        {
            "file": {"download_url": "https://files.oaiusercontent.com/file-2", "file_id": "file-2"},
        },
    )
    assert preview.isError is False
    write_plan_id = preview.structuredContent["write_plan_id"]
    confirm_token = preview.structuredContent["confirm_token"]

    confirm_once = await server.call_tool(
        "confirm_organize_uploaded",
        {
            "write_plan_id": write_plan_id,
            "confirm_token": confirm_token,
            "idempotency_key": "idem-123",
        },
    )
    assert confirm_once.isError is False
    execute_move_calls = [call for call in pipeline.calls if call["execute_move"] is True]
    assert len(execute_move_calls) == 1

    confirm_twice = await server.call_tool(
        "confirm_organize_uploaded",
        {
            "write_plan_id": write_plan_id,
            "confirm_token": confirm_token,
            "idempotency_key": "idem-123",
        },
    )
    assert confirm_twice.isError is False
    execute_move_calls_after = [call for call in pipeline.calls if call["execute_move"] is True]
    assert len(execute_move_calls_after) == 1


def test_download_host_allowlist_validation() -> None:
    assert ensure_allowed_download_host("https://files.oaiusercontent.com/abc", ["files.oaiusercontent.com"]) == "files.oaiusercontent.com"
    with pytest.raises(ValueError):
        ensure_allowed_download_host("https://evil.example.com/abc", ["files.oaiusercontent.com"])


def test_chatgpt_session_store_defers_snapshot_writes_until_flush(tmp_path: Path) -> None:
    config = AppConfig(
        validation_report_path=tmp_path / "validation.json",
        validation_log_dir=tmp_path,
        file_rules_path=Path("server/file_rules.yaml"),
        mcp_allowed_roots=[tmp_path],
        chatgpt_upload_staging_dir=tmp_path / "uploads",
        chatgpt_allowed_download_hosts=["localhost", "files.oaiusercontent.com"],
    )
    store = ChatGPTSessionStore(config)

    session_id = store.get_or_create_session("session-1")
    doc_id = store.record_document(
        session_id=session_id,
        title="Invoice A",
        text="invoice alpha",
        url="session://session-1/doc-1",
        document_id="doc-1",
    )
    store.record_document(
        session_id=session_id,
        title="Invoice B",
        text="invoice beta",
        url="session://session-1/doc-2",
        document_id="doc-2",
    )

    snapshot_path = config.chatgpt_upload_staging_dir / "session_store.json"
    assert doc_id == "doc-1"
    assert snapshot_path.exists() is False

    store.flush_snapshot()

    assert snapshot_path.exists()
    reloaded = ChatGPTSessionStore(config)
    payload = reloaded.fetch_document(session_id=session_id, document_id="doc-2")
    assert payload["title"] == "Invoice B"


def test_mcp_mount_flushes_session_store_on_shutdown(services: AppServices, tmp_path: Path) -> None:
    app = FastAPI()
    mount_mcp_server(app, services, "/mcp")

    with TestClient(app):
        session_store = app.state.mcp_server.session_store
        session_id = session_store.get_or_create_session("shutdown-session")
        session_store.record_document(
            session_id=session_id,
            title="Invoice Persisted",
            text="invoice persisted to disk",
            url="session://shutdown-session/doc-1",
            document_id="doc-1",
        )

    restarted_server = create_mcp_server(services)
    fetched = restarted_server.session_store.fetch_document(
        session_id="shutdown-session",
        document_id="doc-1",
    )

    assert fetched["title"] == "Invoice Persisted"
    search = restarted_server.session_store.search_documents(
        session_id="shutdown-session",
        query="persisted",
        limit=5,
    )
    assert search
    assert search[0]["id"] == "doc-1"
