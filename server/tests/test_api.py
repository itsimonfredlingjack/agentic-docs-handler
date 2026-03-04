from __future__ import annotations

from io import BytesIO

from fastapi.testclient import TestClient

from server.main import create_app
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MovePlan,
    MoveResult,
    ProcessResponse,
    SearchResponse,
    SearchResult,
)


class FakePipeline:
    def __init__(self) -> None:
        self.raise_unsupported = False

    async def process_upload(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str | None,
        execute_move: bool,
        source_path: str | None,
    ) -> ProcessResponse:
        if self.raise_unsupported:
            raise ValueError("unsupported_media_type")

        return ProcessResponse(
            request_id="req-123",
            status="move_planned",
            mime_type=content_type or "text/plain",
            classification=DocumentClassification(
                document_type="invoice",
                template="invoice",
                title=filename,
                summary="Faktura från leverantör",
                tags=["invoice"],
                language="sv",
                confidence=0.93,
                ocr_text=None,
                suggested_actions=["pay"],
            ),
            extraction=ExtractionResult(
                fields={"invoice_number": "INV-123", "amount": "900 SEK"},
                field_confidence={"invoice_number": 0.95},
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
            timings={"classify_ms": 12, "extract_ms": 8},
            errors=[],
        )


class FakeReadinessProbe:
    def __call__(self) -> dict[str, object]:
        return {
            "ready": True,
            "checks": {
                "ollama": True,
                "model": True,
                "prompts": True,
            },
        }


class FakeUnreadyProbe:
    def __call__(self) -> dict[str, object]:
        return {
            "ready": False,
            "checks": {
                "ollama": False,
                "model": False,
                "prompts": True,
            },
        }


class FakeSearchService:
    async def search(self, query: str, limit: int = 5) -> SearchResponse:
        return SearchResponse(
            query=query,
            rewritten_query=f"{query} rewritten",
            answer="Invoice found in March documents.",
            results=[
                SearchResult(
                    doc_id="invoice-1",
                    title="Invoice March",
                    source_path="docs/invoice.txt",
                    snippet="Invoice for March 2026.",
                    score=1.5,
                    vector_score=1.0,
                    keyword_score=0.5,
                    metadata={"document_type": "invoice"},
                )
            ],
        )


def test_healthz_returns_process_liveness() -> None:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readyz_returns_readiness_payload() -> None:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.get("/readyz")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ready"] is True
    assert payload["checks"]["model"] is True


def test_readyz_returns_503_when_probe_is_not_ready() -> None:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeUnreadyProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["ready"] is False


def test_process_returns_structured_process_response() -> None:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.post(
            "/process",
            files={"file": ("invoice.txt", BytesIO(b"invoice"), "text/plain")},
            data={"execute_move": "false"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["classification"]["document_type"] == "invoice"
    assert payload["move_plan"]["reason"] == "execute_move_disabled"


def test_process_returns_415_for_unsupported_media_type() -> None:
    pipeline = FakePipeline()
    pipeline.raise_unsupported = True
    app = create_app(
        pipeline=pipeline,
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.post(
            "/process",
            files={"file": ("archive.bin", BytesIO(b"\x00\x01"), "application/octet-stream")},
        )

    assert response.status_code == 415


def test_search_returns_smart_answer_and_ranked_results() -> None:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
        search_service=FakeSearchService(),
    )

    with TestClient(app) as client:
        response = client.get("/search", params={"query": "invoice amount"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["rewritten_query"] == "invoice amount rewritten"
    assert payload["results"][0]["doc_id"] == "invoice-1"
