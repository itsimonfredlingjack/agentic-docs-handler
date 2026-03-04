from __future__ import annotations

import json
from pathlib import Path

import pytest

from server.config import AppConfig
from server.mcp.app import create_mcp_server
from server.mcp.services import AppServices, KnowledgeDocument
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MovePlan,
    MoveResult,
    ProcessResponse,
    SearchResponse,
    SearchResult,
    TranscriptionResponse,
    TranscriptionSegment,
)


class FakeClassifier:
    async def classify_text(self, text: str, request_id: str = "local-test") -> DocumentClassification:
        return DocumentClassification(
            document_type="invoice",
            template="invoice",
            title=text[:20] or "invoice",
            summary="Invoice summary",
            tags=["invoice"],
            language="sv",
            confidence=0.94,
            ocr_text=None,
            suggested_actions=["review"],
        )

    async def classify_image(
        self,
        image_bytes: bytes,
        mime_type: str,
        request_id: str = "local-test",
    ) -> DocumentClassification:
        return DocumentClassification(
            document_type="receipt",
            template="receipt",
            title=f"{mime_type}:{len(image_bytes)}",
            summary="Receipt summary",
            tags=["receipt"],
            language="sv",
            confidence=0.91,
            ocr_text="TOTAL 199 SEK",
            suggested_actions=["archive"],
        )


class FakeExtractor:
    async def extract(
        self,
        text: str,
        classification: DocumentClassification,
        request_id: str,
    ) -> ExtractionResult:
        return ExtractionResult(
            fields={"document_type": classification.document_type, "snippet": text[:12]},
            field_confidence={"document_type": 0.99},
            missing_fields=[],
        )


class FakeOrganizer:
    def __init__(self) -> None:
        self.rule_set = {
            "version": 1,
            "default_mode": "confirm",
            "rules": [
                {
                    "name": "invoices",
                    "destination": "/tmp/Fakturor/{year}/{month}",
                    "when": {"document_type": "invoice", "min_confidence": 0.9},
                    "auto_move": True,
                }
            ],
        }


class FakeSearchService:
    def __init__(self) -> None:
        self.queries: list[str] = []

    async def search(self, query: str, limit: int = 5) -> SearchResponse:
        self.queries.append(f"{query}:{limit}")
        return SearchResponse(
            query=query,
            rewritten_query=f"{query} rewritten",
            answer="Invoice March is the best match.",
            results=[
                SearchResult(
                    doc_id="invoice-1",
                    title="Invoice March",
                    source_path="docs/invoice.txt",
                    snippet="Invoice March 2026",
                    score=1.2,
                    vector_score=0.8,
                    keyword_score=0.4,
                    metadata={"document_type": "invoice"},
                )
            ],
        )


class FakeWhisperService:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def transcribe(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str | None,
        language: str | None = None,
    ) -> TranscriptionResponse:
        self.calls.append(
            {
                "filename": filename,
                "content_type": content_type,
                "language": language,
                "size": len(content),
            }
        )
        return TranscriptionResponse(
            text="Hej från ljudfilen.",
            language=language or "sv",
            language_probability=0.95,
            duration=1.0,
            duration_after_vad=0.9,
            model="large-v3-turbo",
            segments=[TranscriptionSegment(start=0.0, end=1.0, text="Hej från ljudfilen.")],
        )


class FakePipeline:
    def __init__(self) -> None:
        self.classifier = FakeClassifier()
        self.extractor = FakeExtractor()
        self.organizer = FakeOrganizer()
        self.calls: list[dict[str, object]] = []

    async def process_upload(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str | None,
        execute_move: bool,
        source_path: str | None,
    ) -> ProcessResponse:
        self.calls.append(
            {
                "filename": filename,
                "content_type": content_type,
                "execute_move": execute_move,
                "source_path": source_path,
            }
        )
        return ProcessResponse(
            request_id="req-mcp",
            status="move_executed" if execute_move else "move_planned",
            mime_type=content_type or "text/plain",
            classification=DocumentClassification(
                document_type="invoice",
                template="invoice",
                title=filename,
                summary="Invoice summary",
                tags=["invoice"],
                language="sv",
                confidence=0.95,
                ocr_text="2026-03-04",
                suggested_actions=["review"],
            ),
            extraction=ExtractionResult(
                fields={"invoice_number": "INV-1"},
                field_confidence={"invoice_number": 0.98},
                missing_fields=[],
            ),
            move_plan=MovePlan(
                rule_name="invoices",
                destination="/tmp/Fakturor/2026/03",
                auto_move_allowed=True,
                reason="rule_matched" if execute_move else "execute_move_disabled",
            ),
            move_result=MoveResult(
                attempted=execute_move,
                success=execute_move,
                from_path=source_path,
                to_path="/tmp/Fakturor/2026/03/invoice.txt" if execute_move else None,
                error=None if execute_move else None,
            ),
            timings={"classify_ms": 1.0, "extract_ms": 1.0, "organize_ms": 1.0},
            errors=[],
        )


def build_services(tmp_path: Path) -> tuple[AppServices, FakePipeline, Path]:
    report_path = tmp_path / "latest.json"
    report_path.write_text(json.dumps({"status": "ok", "parse_rate": 1.0}), encoding="utf-8")
    source_path = tmp_path / "invoice.txt"
    source_path.write_text("Invoice data 2026-03-04", encoding="utf-8")
    image_path = tmp_path / "receipt.png"
    image_path.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    audio_path = tmp_path / "clip.wav"
    audio_path.write_bytes(b"RIFFfake")
    config = AppConfig(
        file_rules_path=Path("server/file_rules.yaml"),
        validation_report_path=report_path,
        validation_log_dir=tmp_path,
        mcp_allowed_roots=[tmp_path],
        mcp_max_image_bytes=32,
    )
    pipeline = FakePipeline()
    search_service = FakeSearchService()
    whisper_service = FakeWhisperService()
    services = AppServices(
        config=config,
        pipeline=pipeline,
        search_service=search_service,
        whisper_service=whisper_service,
        classifier=pipeline.classifier,
        extractor=pipeline.extractor,
        organizer=pipeline.organizer,
        readiness_probe=lambda: {"ready": True, "checks": {"ollama": True, "model": True, "prompts": True}},
        validation_report_loader=lambda: {"status": "ok", "parse_rate": 1.0},
        documents={
            "design-spec": KnowledgeDocument(
                doc_id="design-spec",
                title="Design Spec",
                url="agentic-docs-design-spec.md",
                text="Invoice design and search behavior",
                metadata={"kind": "spec"},
            ),
            "validation-report": KnowledgeDocument(
                doc_id="validation-report",
                title="Validation Report",
                url="docs/validation/phase1-validation-report.md",
                text="Validation ok parse rate 1.0",
                metadata={"kind": "report"},
            ),
        },
        activity_log_loader=lambda limit: [],
    )
    return services, pipeline, image_path


@pytest.mark.asyncio
async def test_search_returns_standard_wrapper_json(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    server = create_mcp_server(services)

    result = await server.call_tool("search", {"query": "invoice"})

    payload = json.loads(result.content[0].text)
    assert payload["results"][0]["id"] == "design-spec"
    assert payload["results"][0]["url"] == "agentic-docs-design-spec.md"


@pytest.mark.asyncio
async def test_search_documents_uses_search_pipeline(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    server = create_mcp_server(services)

    result = await server.call_tool("search_documents", {"query": "invoice amount"})

    assert result.structuredContent["rewritten_query"] == "invoice amount rewritten"
    assert result.structuredContent["results"][0]["doc_id"] == "invoice-1"


@pytest.mark.asyncio
async def test_transcribe_audio_uses_whisper_proxy(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    audio_path = tmp_path / "clip.wav"
    server = create_mcp_server(services)

    result = await server.call_tool("transcribe_audio", {"audio_path": str(audio_path), "language": "sv"})

    assert result.structuredContent["language"] == "sv"
    assert result.structuredContent["segments"][0]["text"] == "Hej från ljudfilen."


@pytest.mark.asyncio
async def test_fetch_returns_standard_wrapper_json(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    server = create_mcp_server(services)

    result = await server.call_tool("fetch", {"id": "validation-report"})

    payload = json.loads(result.content[0].text)
    assert payload["id"] == "validation-report"
    assert "Validation ok" in payload["text"]


@pytest.mark.asyncio
async def test_get_system_status_returns_readiness_and_model(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    server = create_mcp_server(services)

    result = await server.call_tool("get_system_status", {})

    assert result.structuredContent["phase"] == 3
    assert result.structuredContent["readiness"]["ready"] is True
    assert result.structuredContent["model"] == services.config.ollama_model


@pytest.mark.asyncio
async def test_get_validation_report_returns_structured_payload(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    server = create_mcp_server(services)

    result = await server.call_tool("get_validation_report", {})

    assert result.structuredContent["report"]["status"] == "ok"
    assert "Parse rate" in result.content[0].text


@pytest.mark.asyncio
async def test_classify_text_returns_classification_payload(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    server = create_mcp_server(services)

    result = await server.call_tool("classify_text", {"text": "Invoice 123"})

    assert result.structuredContent["document_type"] == "invoice"
    assert result.structuredContent["confidence"] == 0.94


@pytest.mark.asyncio
async def test_classify_image_rejects_large_files(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    large_path = tmp_path / "large.png"
    large_path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 64)
    server = create_mcp_server(services)

    result = await server.call_tool("classify_image", {"image_path": str(large_path)})

    assert result.isError is True
    assert "exceeds" in result.content[0].text


@pytest.mark.asyncio
async def test_classify_image_rejects_unsupported_image_type(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    unsupported_path = tmp_path / "receipt.gif"
    unsupported_path.write_bytes(b"GIF89a")
    server = create_mcp_server(services)

    result = await server.call_tool("classify_image", {"image_path": str(unsupported_path)})

    assert result.isError is True
    assert "unsupported_image_type" in result.content[0].text


@pytest.mark.asyncio
async def test_preview_document_processing_forces_non_mutating_pipeline(tmp_path: Path) -> None:
    services, pipeline, _ = build_services(tmp_path)
    source_path = tmp_path / "invoice.txt"
    server = create_mcp_server(services)

    result = await server.call_tool("preview_document_processing", {"source_path": str(source_path)})

    assert result.structuredContent["status"] == "move_planned"
    assert pipeline.calls[0]["execute_move"] is False


@pytest.mark.asyncio
async def test_organize_file_executes_move(tmp_path: Path) -> None:
    services, pipeline, _ = build_services(tmp_path)
    source_path = tmp_path / "invoice.txt"
    server = create_mcp_server(services)

    result = await server.call_tool("organize_file", {"source_path": str(source_path)})

    assert result.structuredContent["status"] == "move_executed"
    assert pipeline.calls[0]["execute_move"] is True


@pytest.mark.asyncio
async def test_list_file_rules_returns_rules_summary(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    server = create_mcp_server(services)

    result = await server.call_tool("list_file_rules", {})

    assert result.structuredContent["rules"][0]["name"] == "invoices"


@pytest.mark.asyncio
async def test_get_activity_log_returns_empty_payload_without_events(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    server = create_mcp_server(services)

    result = await server.call_tool("get_activity_log", {})

    assert result.structuredContent["events"] == []


@pytest.mark.asyncio
async def test_extract_fields_returns_structured_payload(tmp_path: Path) -> None:
    services, _, _ = build_services(tmp_path)
    server = create_mcp_server(services)

    result = await server.call_tool(
        "extract_fields",
        {
            "text": "Invoice body",
            "classification": {
                "document_type": "invoice",
                "template": "invoice",
                "title": "Invoice",
                "summary": "Invoice summary",
                "tags": ["invoice"],
                "language": "sv",
                "confidence": 0.9,
                "ocr_text": None,
                "suggested_actions": ["review"],
            },
        },
    )

    assert result.structuredContent["fields"]["document_type"] == "invoice"
