from __future__ import annotations

from pathlib import Path

import pytest

from server.document_registry import DocumentRegistry
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


@pytest.mark.asyncio
async def test_audio_process_upload_returns_transcription_and_registry_record(tmp_path: Path) -> None:
    registry = DocumentRegistry(
        documents_path=tmp_path / "ui_documents.jsonl",
        move_history_path=tmp_path / "move_history.jsonl",
    )
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
    assert search.documents
    assert [event["type"] for event in realtime.events] == [
        "job.started",
        "job.progress",
        "job.progress",
        "job.progress",
        "job.progress",
        "job.progress",
        "job.progress",
        "job.completed",
    ]
