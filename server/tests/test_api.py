from __future__ import annotations

import os
import time
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient

from server.api.routes import _maybe_cleanup_staging, _CLEANUP_MAX_AGE_SECONDS
from server.config import AppConfig
from server.document_registry import DocumentRegistry
from server.main import create_app
from server.schemas import (
    DocumentClassification,
    DismissMoveResponse,
    ExtractionResult,
    MovePlan,
    MoveResult,
    ProcessDiagnostics,
    ProcessResponse,
    SearchResponse,
    SearchResult,
    TranscriptionResponse,
    TranscriptionSegment,
    UiDocumentRecord,
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
        client_id: str | None = None,
        client_request_id: str | None = None,
        move_executor: str = "none",
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
        client_id: str | None = None,
        client_request_id: str | None = None,
    ) -> TranscriptionResponse:
        self.calls.append(
            {
                "filename": filename,
                "content": content,
                "content_type": content_type,
                "language": language,
                "client_id": client_id,
                "client_request_id": client_request_id,
            }
        )
        return TranscriptionResponse(
            text="Hej team. Hello team.",
            language=language or "sv",
            language_probability=0.91,
            duration=2.4,
            duration_after_vad=2.1,
            model="large-v3-turbo",
            segments=[
                TranscriptionSegment(start=0.0, end=1.2, text="Hej team."),
                TranscriptionSegment(start=1.2, end=2.4, text="Hello team."),
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


def test_healthz_includes_active_model_name() -> None:
    app = create_app(
        config=AppConfig(ollama_model="qwen3.5:9b"),
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json()["model"] == "qwen3.5:9b"


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


def test_transcribe_returns_structured_transcription() -> None:
    whisper_service = FakeWhisperService()
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
        whisper_service=whisper_service,
    )

    with TestClient(app) as client:
        response = client.post(
            "/transcribe",
            files={"file": ("clip.wav", BytesIO(b"fake-audio"), "audio/wav")},
            data={"language": "sv"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["language"] == "sv"
    assert payload["segments"][0]["text"] == "Hej team."
    assert whisper_service.calls[0]["filename"] == "clip.wav"


def test_documents_endpoint_returns_bootstrap_payload() -> None:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.get("/documents", params={"limit": 10})

    assert response.status_code == 200
    payload = response.json()
    assert "documents" in payload
    assert "total" in payload


def test_document_counts_endpoint_returns_sidebar_counts() -> None:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.get("/documents/counts")

    assert response.status_code == 200
    payload = response.json()
    assert payload["all"] >= 0
    assert "receipt" in payload


def test_activity_endpoint_returns_recent_events() -> None:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.get("/activity", params={"limit": 5})

    assert response.status_code == 200
    payload = response.json()
    assert "events" in payload


def test_activity_and_documents_hide_internal_flags_from_warnings(tmp_path: Path) -> None:
    registry = DocumentRegistry(
        documents_path=tmp_path / "ui_documents.jsonl",
        move_history_path=tmp_path / "move_history.jsonl",
    )
    registry.upsert_document(
        UiDocumentRecord(
            id="doc-debug-1",
            request_id="req-debug-1",
            title="Fallback document",
            summary="Summary",
            mime_type="text/plain",
            source_modality="text",
            kind="generic",
            document_type="generic",
            template="generic",
            source_path=str(tmp_path / "doc.txt"),
            created_at="2026-03-04T10:00:00+00:00",
            updated_at="2026-03-04T10:00:00+00:00",
            classification=DocumentClassification(
                document_type="generic",
                template="generic",
                title="Fallback document",
                summary="Summary",
                tags=[],
                language="sv",
                confidence=0.0,
                ocr_text=None,
                suggested_actions=[],
            ),
            extraction=ExtractionResult(fields={}, field_confidence={}, missing_fields=[]),
            move_plan=MovePlan(rule_name=None, destination=None, auto_move_allowed=False, reason="no_matching_rule"),
            move_result=MoveResult(attempted=False, success=False, from_path=str(tmp_path / "doc.txt"), to_path=None, error=None),
            tags=[],
            status="completed",
            warnings=["pdf_text_empty_image_fallback", "User warning"],
            diagnostics=ProcessDiagnostics(pipeline_flags=["classifier_empty_fields_fallback"]),
        )
    )
    app = create_app(
        pipeline=FakePipeline(),
        document_registry=registry,
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        documents_response = client.get("/documents", params={"limit": 10})
        activity_response = client.get("/activity", params={"limit": 10})

    assert documents_response.status_code == 200
    documents_payload = documents_response.json()
    document = documents_payload["documents"][0]
    assert document["warnings"] == ["User warning"]
    assert set(document["diagnostics"]["pipeline_flags"]) == {
        "pdf_text_empty_image_fallback",
        "classifier_empty_fields_fallback",
    }

    assert activity_response.status_code == 200
    activity_payload = activity_response.json()
    assert activity_payload["events"][0]["debug"]["pipeline_flags"] == [
        "classifier_empty_fields_fallback",
        "pdf_text_empty_image_fallback",
    ]


def test_ws_endpoint_emits_connection_ready_event() -> None:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        with client.websocket_connect("/ws?client_id=test-client&client=tauri") as websocket:
            payload = websocket.receive_json()

    assert payload["type"] == "connection.ready"
    assert payload["client_id"] == "test-client"
    assert payload["server_phase"] == 5


def test_moves_undo_restores_file_from_registry(tmp_path: Path) -> None:
    registry = DocumentRegistry(
        documents_path=tmp_path / "ui_documents.jsonl",
        move_history_path=tmp_path / "move_history.jsonl",
    )
    incoming_dir = tmp_path / "incoming"
    sorted_dir = tmp_path / "sorted"
    incoming_dir.mkdir()
    sorted_dir.mkdir()
    source_file = incoming_dir / "receipt.txt"
    source_file.write_text("receipt", encoding="utf-8")
    moved_file = sorted_dir / "receipt.txt"
    source_file.rename(moved_file)
    registry.upsert_document(
        UiDocumentRecord(
            id="doc-1",
            request_id="req-1",
            title="Receipt",
            summary="Receipt summary",
            mime_type="text/plain",
            source_modality="text",
            kind="receipt",
            document_type="receipt",
            template="receipt",
            source_path=str(moved_file),
            created_at="2026-03-04T10:00:00+00:00",
            updated_at="2026-03-04T10:00:00+00:00",
            classification=DocumentClassification(
                document_type="receipt",
                template="receipt",
                title="Receipt",
                summary="Receipt summary",
                tags=["receipt"],
                language="sv",
                confidence=0.95,
                ocr_text=None,
                suggested_actions=[],
            ),
            extraction=ExtractionResult(fields={}, field_confidence={}, missing_fields=[]),
            move_plan=MovePlan(
                rule_name="receipts",
                destination=str(sorted_dir),
                auto_move_allowed=True,
                reason="rule_matched",
            ),
            move_result=MoveResult(
                attempted=True,
                success=True,
                from_path=str(source_file),
                to_path=str(moved_file),
                error=None,
            ),
            tags=["receipt"],
            status="completed",
        )
    )
    move_entry = registry.record_move(
        request_id="req-1",
        record_id="doc-1",
        from_path=str(source_file),
        to_path=str(moved_file),
        client_id="test-client",
    )
    app = create_app(
        pipeline=FakePipeline(),
        document_registry=registry,
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.post("/moves/undo", json={"undo_token": move_entry.undo_token, "client_id": "test-client"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert Path(payload["to_path"]).exists()


def test_moves_finalize_updates_registry(tmp_path: Path) -> None:
    registry = DocumentRegistry(
        documents_path=tmp_path / "ui_documents.jsonl",
        move_history_path=tmp_path / "move_history.jsonl",
    )
    registry.upsert_document(
        UiDocumentRecord(
            id="doc-2",
            request_id="req-2",
            title="Invoice",
            summary="Invoice summary",
            mime_type="text/plain",
            source_modality="text",
            kind="invoice",
            document_type="invoice",
            template="invoice",
            source_path=str(tmp_path / "invoice.txt"),
            created_at="2026-03-04T10:00:00+00:00",
            updated_at="2026-03-04T10:00:00+00:00",
            classification=DocumentClassification(
                document_type="invoice",
                template="invoice",
                title="Invoice",
                summary="Invoice summary",
                tags=["invoice"],
                language="sv",
                confidence=0.95,
                ocr_text=None,
                suggested_actions=[],
            ),
            extraction=ExtractionResult(fields={}, field_confidence={}, missing_fields=[]),
            move_plan=MovePlan(rule_name="invoices", destination=str(tmp_path / "sorted"), auto_move_allowed=True, reason="rule_matched"),
            move_result=MoveResult(attempted=False, success=False, from_path=str(tmp_path / "invoice.txt"), to_path=None, error=None),
            tags=["invoice"],
            status="move_planned",
            move_status="auto_pending_client",
        )
    )
    app = create_app(
        pipeline=FakePipeline(),
        document_registry=registry,
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.post(
            "/moves/finalize",
            json={
                "record_id": "doc-2",
                "request_id": "req-2",
                "client_id": "client-1",
                "from_path": str(tmp_path / "invoice.txt"),
                "to_path": str(tmp_path / "sorted" / "invoice.txt"),
                "success": True,
                "error": None,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["move_status"] == "moved"
    assert payload["undo_token"].startswith("mv_")


def test_moves_undo_complete_marks_move_undone(tmp_path: Path) -> None:
    registry = DocumentRegistry(
        documents_path=tmp_path / "ui_documents.jsonl",
        move_history_path=tmp_path / "move_history.jsonl",
    )
    registry.upsert_document(
        UiDocumentRecord(
            id="doc-3",
            request_id="req-3",
            title="Receipt",
            summary="Receipt summary",
            mime_type="text/plain",
            source_modality="text",
            kind="receipt",
            document_type="receipt",
            template="receipt",
            source_path=str(tmp_path / "sorted" / "receipt.txt"),
            created_at="2026-03-04T10:00:00+00:00",
            updated_at="2026-03-04T10:00:00+00:00",
            classification=DocumentClassification(
                document_type="receipt",
                template="receipt",
                title="Receipt",
                summary="Receipt summary",
                tags=["receipt"],
                language="sv",
                confidence=0.95,
                ocr_text=None,
                suggested_actions=[],
            ),
            extraction=ExtractionResult(fields={}, field_confidence={}, missing_fields=[]),
            move_plan=MovePlan(rule_name="receipts", destination=str(tmp_path / "sorted"), auto_move_allowed=True, reason="rule_matched"),
            move_result=MoveResult(attempted=True, success=True, from_path=str(tmp_path / "incoming" / "receipt.txt"), to_path=str(tmp_path / "sorted" / "receipt.txt"), error=None),
            tags=["receipt"],
            status="completed",
            undo_token="mv_seed",
            move_status="moved",
        )
    )
    move_entry = registry.record_move(
        request_id="req-3",
        record_id="doc-3",
        from_path=str(tmp_path / "incoming" / "receipt.txt"),
        to_path=str(tmp_path / "sorted" / "receipt.txt"),
        client_id="client-1",
        executor="client",
    )
    app = create_app(
        pipeline=FakePipeline(),
        document_registry=registry,
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.post(
            "/moves/undo-complete",
            json={
                "undo_token": move_entry.undo_token,
                "client_id": "client-1",
                "from_path": str(tmp_path / "sorted" / "receipt.txt"),
                "to_path": str(tmp_path / "incoming" / "receipt.txt"),
                "success": True,
                "error": None,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["record_id"] == "doc-3"


def test_moves_dismiss_updates_registry(tmp_path: Path) -> None:
    registry = DocumentRegistry(
        documents_path=tmp_path / "ui_documents.jsonl",
        move_history_path=tmp_path / "move_history.jsonl",
    )
    source_path = str(tmp_path / "contract.pdf")
    registry.upsert_document(
        UiDocumentRecord(
            id="doc-4",
            request_id="req-4",
            title="Contract",
            summary="Contract summary",
            mime_type="application/pdf",
            source_modality="text",
            kind="contract",
            document_type="contract",
            template="contract",
            source_path=source_path,
            created_at="2026-03-04T10:00:00+00:00",
            updated_at="2026-03-04T10:00:00+00:00",
            classification=DocumentClassification(
                document_type="contract",
                template="contract",
                title="Contract",
                summary="Contract summary",
                tags=["contract"],
                language="sv",
                confidence=0.95,
                ocr_text=None,
                suggested_actions=[],
            ),
            extraction=ExtractionResult(fields={}, field_confidence={}, missing_fields=[]),
            move_plan=MovePlan(
                rule_name="contracts",
                destination=str(tmp_path / "sorted"),
                auto_move_allowed=False,
                reason="rule_matched",
            ),
            move_result=MoveResult(
                attempted=False,
                success=False,
                from_path=source_path,
                to_path=None,
                error=None,
            ),
            tags=["contract"],
            status="move_planned",
            move_status="awaiting_confirmation",
        )
    )
    app = create_app(
        pipeline=FakePipeline(),
        document_registry=registry,
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.post(
            "/moves/dismiss",
            json={
                "record_id": "doc-4",
                "request_id": "req-4",
                "client_id": "client-1",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["move_status"] == "not_requested"
    refreshed = registry.list_documents(limit=10).documents[0]
    assert refreshed.move_status == "not_requested"
    assert refreshed.status == "completed"
    assert refreshed.source_path == source_path


def test_moves_dismiss_returns_422_for_non_pending_record(tmp_path: Path) -> None:
    registry = DocumentRegistry(
        documents_path=tmp_path / "ui_documents.jsonl",
        move_history_path=tmp_path / "move_history.jsonl",
    )
    registry.upsert_document(
        UiDocumentRecord(
            id="doc-5",
            request_id="req-5",
            title="Receipt",
            summary="Receipt summary",
            mime_type="text/plain",
            source_modality="text",
            kind="receipt",
            document_type="receipt",
            template="receipt",
            source_path=str(tmp_path / "receipt.txt"),
            created_at="2026-03-04T10:00:00+00:00",
            updated_at="2026-03-04T10:00:00+00:00",
            classification=DocumentClassification(
                document_type="receipt",
                template="receipt",
                title="Receipt",
                summary="Receipt summary",
                tags=["receipt"],
                language="sv",
                confidence=0.95,
                ocr_text=None,
                suggested_actions=[],
            ),
            extraction=ExtractionResult(fields={}, field_confidence={}, missing_fields=[]),
            move_plan=MovePlan(rule_name="receipts", destination=str(tmp_path / "sorted"), auto_move_allowed=True, reason="rule_matched"),
            move_result=MoveResult(attempted=False, success=False, from_path=str(tmp_path / "receipt.txt"), to_path=None, error=None),
            tags=["receipt"],
            status="completed",
            move_status="not_requested",
        )
    )
    app = create_app(
        pipeline=FakePipeline(),
        document_registry=registry,
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.post(
            "/moves/dismiss",
            json={
                "record_id": "doc-5",
                "request_id": "req-5",
                "client_id": "client-1",
            },
        )

    assert response.status_code == 422


def test_process_stages_uploaded_file_and_provides_fallback_source_path(tmp_path: Path) -> None:
    staging = tmp_path / "staging"
    app = create_app(
        config=AppConfig(staging_dir=staging),
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.post(
            "/process",
            files={"file": ("invoice.txt", BytesIO(b"invoice content"), "text/plain")},
            data={"execute_move": "false"},
        )

    assert response.status_code == 200
    payload = response.json()
    from_path = payload["move_result"]["from_path"]
    assert from_path is not None
    assert str(staging) in from_path
    assert "invoice.txt" in from_path

    staged_files = list(staging.iterdir())
    assert len(staged_files) == 1
    assert staged_files[0].read_bytes() == b"invoice content"


def test_process_prefers_client_source_path_over_staging(tmp_path: Path) -> None:
    staging = tmp_path / "staging"
    app = create_app(
        config=AppConfig(staging_dir=staging),
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        validation_report_loader=lambda: {"status": "missing"},
    )

    with TestClient(app) as client:
        response = client.post(
            "/process",
            files={"file": ("invoice.txt", BytesIO(b"invoice content"), "text/plain")},
            data={"execute_move": "false", "source_path": "/client/path/invoice.txt"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["move_result"]["from_path"] == "/client/path/invoice.txt"

    staged_files = list(staging.iterdir())
    assert len(staged_files) == 1


def test_staging_cleanup_removes_stale_files(tmp_path: Path) -> None:
    staging = tmp_path / "staging"
    staging.mkdir()

    old_file = staging / "old-file.txt"
    old_file.write_text("old")
    old_mtime = time.time() - _CLEANUP_MAX_AGE_SECONDS - 60
    os.utime(old_file, (old_mtime, old_mtime))

    new_file = staging / "new-file.txt"
    new_file.write_text("new")

    import server.api.routes as routes_mod
    original_ts = routes_mod._last_cleanup_ts
    routes_mod._last_cleanup_ts = 0.0
    try:
        _maybe_cleanup_staging(staging)
    finally:
        routes_mod._last_cleanup_ts = original_ts

    assert not old_file.exists()
    assert new_file.exists()
