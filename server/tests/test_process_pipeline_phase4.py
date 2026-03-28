from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from server.document_registry import DocumentRegistry
from server.migrations.jsonl_to_sqlite import create_schema, create_inbox_workspace
from server.pipelines.classifier import ClassificationValidationError
from server.pipelines.process_pipeline import DocumentProcessPipeline
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MovePlan,
    MoveResult,
    TranscriptionResponse,
    TranscriptionSegment,
)


class FakeClassifier:
    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        return DocumentClassification(
            document_type="meeting_notes",
            template="meeting_notes",
            title="Sprint sync",
            summary="Meeting summary",
            tags=["meeting"],
            language="sv",
            confidence=0.94,
            ocr_text=None,
            suggested_actions=["summarize"],
        )

    async def classify_image(self, image_bytes: bytes, mime_type: str, request_id: str) -> DocumentClassification:
        raise AssertionError("image path not expected in this test")


class FakeExtractor:
    async def extract(
        self,
        text: str,
        classification: DocumentClassification,
        request_id: str,
    ) -> ExtractionResult:
        return ExtractionResult(
            fields={"action_items": 3},
            field_confidence={"action_items": 0.92},
            missing_fields=[],
        )


class FakeOrganizer:
    def plan_move(self, filename: str, classification: DocumentClassification) -> MovePlan:
        return MovePlan(
            rule_name="meetings",
            destination="/tmp/Documents/Motesanteckningar/2026/03",
            auto_move_allowed=True,
            reason="rule_matched",
        )

    def execute_move(self, move_plan: MovePlan, source_path: Path) -> MoveResult:
        raise AssertionError("execute_move should not run in this test")


class FakeWhisperService:
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
        return TranscriptionResponse(
            text="Hej team. Vi behöver summera sprinten.",
            language="sv",
            language_probability=0.97,
            duration=3.2,
            duration_after_vad=3.0,
            model="large-v3-turbo",
            segments=[TranscriptionSegment(start=0.0, end=3.2, text="Hej team. Vi behöver summera sprinten.")],
        )


class FakeRealtimeManager:
    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []

    async def emit_to_client(self, client_id: str, event: dict[str, object]) -> None:
        self.events.append(event)


class FakeSearchPipeline:
    def __init__(self) -> None:
        self.documents: list[object] = []

    def upsert_document(self, document: object) -> None:
        self.documents.append(document)


class BlockingSearchPipeline:
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.documents: list[object] = []

    async def upsert_document(self, document: object) -> None:
        self.started.set()
        await self.release.wait()
        self.documents.append(document)


class SequencedClassifier:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        self.events.append(f"classify:start:{request_id}")
        await asyncio.sleep(0.01)
        self.events.append(f"classify:end:{request_id}")
        return DocumentClassification(
            document_type="receipt",
            template="receipt",
            title=f"Receipt {request_id}",
            summary="Receipt summary",
            tags=["receipt"],
            language="sv",
            confidence=0.91,
            ocr_text=None,
            suggested_actions=["archive"],
        )

    async def classify_image(self, image_bytes: bytes, mime_type: str, request_id: str) -> DocumentClassification:
        raise AssertionError("image path not expected in this test")


class SequencedExtractor:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    async def extract(
        self,
        text: str,
        classification: DocumentClassification,
        request_id: str,
    ) -> ExtractionResult:
        self.events.append(f"extract:start:{request_id}")
        await asyncio.sleep(0.01)
        self.events.append(f"extract:end:{request_id}")
        return ExtractionResult(
            fields={"amount": 123},
            field_confidence={"amount": 0.91},
            missing_fields=[],
        )


class StrictExtractor:
    async def extract(
        self,
        text: str,
        classification: DocumentClassification,
        request_id: str,
    ) -> ExtractionResult:
        raise AssertionError("extract should be skipped for meeting_notes documents")


class LengthTrackingClassifier:
    def __init__(self) -> None:
        self.lengths: list[int] = []

    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        self.lengths.append(len(text))
        return DocumentClassification(
            document_type="receipt",
            template="receipt",
            title="Tracked receipt",
            summary="Tracked summary",
            tags=["receipt"],
            language="sv",
            confidence=0.9,
            ocr_text=None,
            suggested_actions=[],
        )

    async def classify_image(self, image_bytes: bytes, mime_type: str, request_id: str) -> DocumentClassification:
        raise AssertionError("image path not expected in this test")


class LengthTrackingExtractor:
    def __init__(self) -> None:
        self.lengths: list[int] = []

    async def extract(
        self,
        text: str,
        classification: DocumentClassification,
        request_id: str,
    ) -> ExtractionResult:
        self.lengths.append(len(text))
        return ExtractionResult(fields={"amount": "10"}, field_confidence={"amount": 0.9}, missing_fields=[])


class EmptyFieldClassifier:
    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        return DocumentClassification(
            document_type="generic",
            template="",
            title="",
            summary="",
            tags=[],
            language="sv",
            confidence=0.2,
            ocr_text=None,
            suggested_actions=[],
        )

    async def classify_image(self, image_bytes: bytes, mime_type: str, request_id: str) -> DocumentClassification:
        raise AssertionError("image path not expected in this test")


class PdfImageFallbackClassifier:
    def __init__(self) -> None:
        self.image_calls: list[tuple[str, int]] = []
        self.text_calls: list[int] = []

    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        self.text_calls.append(len(text))
        return DocumentClassification(
            document_type="generic",
            template="generic",
            title="No text",
            summary="No text fallback",
            tags=[],
            language="sv",
            confidence=0.5,
            ocr_text=None,
            suggested_actions=[],
        )

    async def classify_image(self, image_bytes: bytes, mime_type: str, request_id: str) -> DocumentClassification:
        self.image_calls.append((mime_type, len(image_bytes)))
        return DocumentClassification(
            document_type="receipt",
            template="receipt",
            title="Receipt from image PDF",
            summary="Image-based classification",
            tags=["receipt"],
            language="sv",
            confidence=0.87,
            ocr_text="ICA KVITTO",
            suggested_actions=[],
        )


class InvalidJsonClassifier:
    async def classify_text(self, text: str, request_id: str) -> DocumentClassification:
        raise ClassificationValidationError(
            "classifier produced invalid JSON twice",
            raw_response_path="/tmp/logs/llm/responses/failing.json",
        )

    async def classify_image(self, image_bytes: bytes, mime_type: str, request_id: str) -> DocumentClassification:
        raise AssertionError("image path not expected in this test")


@pytest.mark.asyncio
async def test_audio_process_upload_returns_transcription_and_registry_record(tmp_path: Path) -> None:
    db_path = tmp_path / "test.db"
    registry = DocumentRegistry(db_path=db_path)
    create_schema(registry.conn)
    create_inbox_workspace(registry.conn)
    realtime = FakeRealtimeManager()
    search = FakeSearchPipeline()
    pipeline = DocumentProcessPipeline(
        classifier=FakeClassifier(),
        extractor=FakeExtractor(),
        organizer=FakeOrganizer(),
        whisper_service=FakeWhisperService(),
        document_registry=registry,
        realtime_manager=realtime,
        search_pipeline=search,
    )

    response = await pipeline.process_upload(
        filename="meeting.wav",
        content=b"fake-audio",
        content_type="audio/wav",
        execute_move=False,
        source_path="/tmp/meeting.wav",
        client_id="client-1",
        client_request_id="job-1",
    )

    assert response.request_id == "job-1"
    assert response.source_modality == "audio"
    assert response.transcription is not None
    assert response.ui_kind == "audio"
    assert registry.list_documents(limit=10).total == 1
    await pipeline.drain_background_tasks()
    assert search.documents
    event_types = [event["type"] for event in realtime.events]
    assert event_types[0] == "job.started"
    assert event_types[-1] == "job.completed"
    assert event_types.count("job.progress") >= 6


@pytest.mark.asyncio
async def test_process_upload_returns_before_slow_search_indexing_finishes(tmp_path: Path) -> None:
    db_path = tmp_path / "test.db"
    registry = DocumentRegistry(db_path=db_path)
    create_schema(registry.conn)
    create_inbox_workspace(registry.conn)
    realtime = FakeRealtimeManager()
    search = BlockingSearchPipeline()
    pipeline = DocumentProcessPipeline(
        classifier=FakeClassifier(),
        extractor=FakeExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=realtime,
        search_pipeline=search,
    )

    response = await asyncio.wait_for(
        pipeline.process_upload(
            filename="meeting.txt",
            content=b"Sprint planning notes",
            content_type="text/plain",
            execute_move=False,
            source_path="/tmp/meeting.txt",
            client_id="client-1",
            client_request_id="job-blocking",
        ),
        timeout=0.2,
    )

    assert response.request_id == "job-blocking"
    assert registry.list_documents(limit=10).total == 1
    await asyncio.sleep(0)
    assert search.started.is_set() is True
    assert search.documents == []
    assert realtime.events[-1]["type"] != "job.completed"

    search.release.set()
    await pipeline.drain_background_tasks()

    assert len(search.documents) == 1
    assert realtime.events[-1]["type"] == "job.completed"


@pytest.mark.asyncio
async def test_process_upload_serializes_classify_and_extract_per_document(tmp_path: Path) -> None:
    db_path = tmp_path / "test.db"
    registry = DocumentRegistry(db_path=db_path)
    create_schema(registry.conn)
    create_inbox_workspace(registry.conn)
    events: list[str] = []
    pipeline = DocumentProcessPipeline(
        classifier=SequencedClassifier(events),
        extractor=SequencedExtractor(events),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=FakeRealtimeManager(),
    )

    await asyncio.gather(
        pipeline.process_upload(
            filename="receipt-a.txt",
            content=b"receipt-a",
            content_type="text/plain",
            execute_move=False,
            source_path="/tmp/receipt-a.txt",
            client_id="client-1",
            client_request_id="job-a",
        ),
        pipeline.process_upload(
            filename="receipt-b.txt",
            content=b"receipt-b",
            content_type="text/plain",
            execute_move=False,
            source_path="/tmp/receipt-b.txt",
            client_id="client-1",
            client_request_id="job-b",
        ),
    )

    assert events in (
        [
            "classify:start:job-a",
            "classify:end:job-a",
            "extract:start:job-a",
            "extract:end:job-a",
            "classify:start:job-b",
            "classify:end:job-b",
            "extract:start:job-b",
            "extract:end:job-b",
        ],
        [
            "classify:start:job-b",
            "classify:end:job-b",
            "extract:start:job-b",
            "extract:end:job-b",
            "classify:start:job-a",
            "classify:end:job-a",
            "extract:start:job-a",
            "extract:end:job-a",
        ],
    )


@pytest.mark.asyncio
async def test_process_upload_skips_extractor_for_meeting_notes_documents(tmp_path: Path) -> None:
    db_path = tmp_path / "test.db"
    registry = DocumentRegistry(db_path=db_path)
    create_schema(registry.conn)
    create_inbox_workspace(registry.conn)
    pipeline = DocumentProcessPipeline(
        classifier=FakeClassifier(),
        extractor=StrictExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=FakeRealtimeManager(),
    )

    response = await pipeline.process_upload(
        filename="meeting.txt",
        content=b"Sprint planning notes",
        content_type="text/plain",
        execute_move=False,
        source_path="/tmp/meeting.txt",
        client_id="client-1",
        client_request_id="job-skip-extract",
    )

    assert response.classification.document_type == "meeting_notes"
    assert response.extraction.fields == {}
    assert response.extraction.field_confidence == {}
    assert response.extraction.missing_fields == []


@pytest.mark.asyncio
async def test_process_upload_uses_shorter_text_for_classification_than_extraction(tmp_path: Path) -> None:
    db_path = tmp_path / "test.db"
    registry = DocumentRegistry(db_path=db_path)
    create_schema(registry.conn)
    create_inbox_workspace(registry.conn)
    classifier = LengthTrackingClassifier()
    extractor = LengthTrackingExtractor()
    pipeline = DocumentProcessPipeline(
        classifier=classifier,
        extractor=extractor,
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=FakeRealtimeManager(),
        max_text_characters=12000,
    )
    pipeline.classifier_max_text_characters = 4000
    long_text = ("abc123 " * 3000).encode()

    await pipeline.process_upload(
        filename="long-receipt.txt",
        content=long_text,
        content_type="text/plain",
        execute_move=False,
        source_path="/tmp/long-receipt.txt",
        client_id="client-1",
        client_request_id="job-text-window",
    )

    assert classifier.lengths == [4000]
    assert extractor.lengths == [12000]


@pytest.mark.asyncio
async def test_process_upload_uses_pdf_image_fallback_when_extracted_text_is_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = tmp_path / "test.db"
    registry = DocumentRegistry(db_path=db_path)
    create_schema(registry.conn)
    create_inbox_workspace(registry.conn)
    classifier = PdfImageFallbackClassifier()
    pipeline = DocumentProcessPipeline(
        classifier=classifier,
        extractor=FakeExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=FakeRealtimeManager(),
    )

    monkeypatch.setattr(
        pipeline,
        "_extract_text",
        lambda content, mime_type: "",
    )
    monkeypatch.setattr(
        pipeline,
        "_extract_pdf_image_for_classification",
        lambda content: (b"\x89PNG\r\n\x1a\nfake", "image/png"),
    )

    response = await pipeline.process_upload(
        filename="scanned.pdf",
        content=b"%PDF fake",
        content_type="application/pdf",
        execute_move=False,
        source_path="/tmp/scanned.pdf",
        client_id="client-1",
        client_request_id="job-pdf-image-fallback",
    )

    assert classifier.image_calls == [("image/png", len(b"\x89PNG\r\n\x1a\nfake"))]
    assert classifier.text_calls == []
    assert response.classification.document_type == "receipt"
    assert response.diagnostics is not None
    assert "pdf_text_empty_image_fallback" in response.diagnostics.pipeline_flags
    assert "pdf_text_empty_image_fallback" not in response.warnings


@pytest.mark.asyncio
async def test_process_upload_falls_back_when_classifier_returns_empty_fields(tmp_path: Path) -> None:
    db_path = tmp_path / "test.db"
    registry = DocumentRegistry(db_path=db_path)
    create_schema(registry.conn)
    create_inbox_workspace(registry.conn)
    pipeline = DocumentProcessPipeline(
        classifier=EmptyFieldClassifier(),
        extractor=FakeExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=FakeRealtimeManager(),
    )

    response = await pipeline.process_upload(
        filename="empty-model-output.pdf",
        content=b"%PDF fake content",
        content_type="text/plain",
        execute_move=False,
        source_path="/tmp/empty-model-output.pdf",
        client_id="client-1",
        client_request_id="job-empty-fields-fallback",
    )

    assert response.classification.title == "empty-model-output"
    assert response.classification.summary
    assert response.classification.template == "generic"
    assert response.diagnostics is not None
    assert "classifier_empty_fields_fallback" in response.diagnostics.pipeline_flags
    assert "classifier_empty_fields_fallback" not in response.warnings


@pytest.mark.asyncio
async def test_process_upload_invalid_json_fallback_uses_clean_title_summary_and_diagnostics(tmp_path: Path) -> None:
    db_path = tmp_path / "test.db"
    registry = DocumentRegistry(db_path=db_path)
    create_schema(registry.conn)
    create_inbox_workspace(registry.conn)
    pipeline = DocumentProcessPipeline(
        classifier=InvalidJsonClassifier(),
        extractor=FakeExtractor(),
        organizer=FakeOrganizer(),
        document_registry=registry,
        realtime_manager=FakeRealtimeManager(),
    )

    response = await pipeline.process_upload(
        filename="b95f5280-4ec5-4bd6-a977-bce198ea2165.pdf",
        content=b"Detta ar ett intyg med flera rader.\n\npdf_text_empty_image_fallback\nNyttig text ska visas.",
        content_type="text/plain",
        execute_move=False,
        source_path="/tmp/agentic-docs/uploads/fe68f9f1-bf7a-4f7b-a97f-f6f31f52a6f1-Intyg_2026.pdf",
        client_id="client-1",
        client_request_id="job-invalid-json-fallback",
    )

    assert response.classification.document_type == "generic"
    assert response.classification.template == "generic"
    assert response.classification.title == "Intyg_2026"
    assert len(response.classification.summary) <= 200
    assert "pdf_text_empty_image_fallback" not in response.classification.summary
    assert response.diagnostics is not None
    assert "classifier_invalid_json_fallback" in response.diagnostics.pipeline_flags
    assert response.diagnostics.classifier_raw_response_path == "/tmp/logs/llm/responses/failing.json"
    assert "classifier_invalid_json_fallback" not in response.warnings
