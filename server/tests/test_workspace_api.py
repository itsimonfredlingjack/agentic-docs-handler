from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from server.main import create_app
from server.pipelines.workspace_chat import WorkspaceContext
from server.schemas import (
    DiscoveryCard,
    DiscoveryFileRef,
    DocumentClassification,
    ExtractionResult,
    MovePlan,
    MoveResult,
    ProcessResponse,
    SearchResponse,
)


class FakePipeline:
    async def process_upload(self, **kwargs: Any) -> ProcessResponse:
        return ProcessResponse(
            request_id="req-1",
            status="classified",
            mime_type="application/pdf",
            classification=DocumentClassification(
                document_type="receipt",
                template="receipt",
                title="Test",
                summary="Test",
                tags=[],
                language="sv",
                confidence=0.9,
                ocr_text=None,
                suggested_actions=[],
            ),
            extraction=ExtractionResult(fields={}, field_confidence={}, missing_fields=[]),
            move_plan=MovePlan(
                destination=None,
                auto_move_allowed=False,
                rule_name=None,
                reason="no_matching_rule",
            ),
            move_result=MoveResult(
                attempted=False,
                success=False,
                from_path=None,
                to_path=None,
                error=None,
            ),
            timings={},
            errors=[],
            record_id=None,
            source_modality=None,
            created_at=None,
            transcription=None,
            ui_kind=None,
            undo_token=None,
            move_status="not_requested",
            retryable=False,
            error_code=None,
            warnings=[],
            diagnostics=None,
            thumbnail_data=None,
        )


class FakeReadinessProbe:
    def __call__(self) -> dict[str, object]:
        return {"ready": True, "checks": {"ollama": True, "model": True, "prompts": True, "whisper": True}}


class FakeSearchService:
    async def search(self, query: str, limit: int = 5, *, mode: str = "full", document_type: str | None = None) -> SearchResponse:
        return SearchResponse(query=query, rewritten_query=query, answer="", results=[])


class FakeWorkspaceChatPipeline:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def prepare_context(
        self,
        *,
        workspace_id: str | None = None,
        category: str | None = None,
        message: str,
        history: list[dict[str, str]],
        document_id: str | None = None,
    ) -> WorkspaceContext:
        self.calls.append({"workspace_id": workspace_id, "category": category, "message": message})
        return WorkspaceContext(source_count=3, messages=[{"role": "user", "content": message}], request_id="req-1", sources=[])

    async def stream_response(self, context: WorkspaceContext) -> AsyncIterator[str]:
        for token in ["Svar", " ", "här"]:
            yield token


class FakeDiscoveryService:
    def __init__(self) -> None:
        self.generated_for: list[str] = []
        self.dismissed: list[str] = []

    def generate(self, *, workspace_id: str, force: bool = False) -> list[DiscoveryCard]:
        self.generated_for.append(workspace_id)
        return [
            DiscoveryCard(
                id="rel-1",
                relation_type="related",
                confidence=0.88,
                explanation="Delar entiteter: Acme AB, Stockholm.",
                files=[
                    DiscoveryFileRef(id="doc-1", title="Kontrakt", source_path="/tmp/kontrakt.pdf"),
                    DiscoveryFileRef(id="doc-2", title="Mötesanteckningar", source_path="/tmp/mote.pdf"),
                ],
                created_at="2026-03-28T10:00:00Z",
            )
        ]

    def dismiss_relation(self, *, relation_id: str) -> None:
        self.dismissed.append(relation_id)


def make_app(*, workspace_chat_service: Any = None, discovery_service: Any = None) -> TestClient:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        search_service=FakeSearchService(),
        validation_report_loader=lambda: {"status": "missing"},
        workspace_chat_service=workspace_chat_service,
        discovery_service=discovery_service,
    )
    return TestClient(app)


def test_workspace_categories_returns_counts() -> None:
    client = make_app(workspace_chat_service=FakeWorkspaceChatPipeline())
    response = client.get("/workspace/categories")
    assert response.status_code == 200
    data = response.json()
    assert "categories" in data
    # With no real documents, categories list should be empty
    assert isinstance(data["categories"], list)


def test_workspace_chat_streams_sse_events() -> None:
    ws_pipeline = FakeWorkspaceChatPipeline()
    client = make_app(workspace_chat_service=ws_pipeline)
    response = client.post(
        "/workspace/chat",
        json={"workspace_id": "ws-1", "message": "Vad är momsen?", "history": []},
    )
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    body = response.text
    assert "event: context" in body
    assert "event: token" in body
    assert "event: done" in body
    assert ws_pipeline.calls[0]["workspace_id"] == "ws-1"


def test_workspace_chat_returns_503_when_not_available() -> None:
    client = make_app(workspace_chat_service=None)
    response = client.post(
        "/workspace/chat",
        json={"workspace_id": "ws-1", "message": "test", "history": []},
    )
    assert response.status_code == 503


def test_workspace_discovery_returns_cards() -> None:
    discovery = FakeDiscoveryService()
    client = make_app(
        workspace_chat_service=FakeWorkspaceChatPipeline(),
        discovery_service=discovery,
    )
    workspace_id = client.get("/workspaces").json()["workspaces"][0]["id"]

    response = client.get(f"/workspaces/{workspace_id}/discovery")

    assert response.status_code == 200
    assert response.json()["cards"][0]["relation_type"] == "related"
    assert discovery.generated_for == [workspace_id]


def test_workspace_discovery_dismisses_card() -> None:
    discovery = FakeDiscoveryService()
    client = make_app(
        workspace_chat_service=FakeWorkspaceChatPipeline(),
        discovery_service=discovery,
    )
    workspace_id = client.get("/workspaces").json()["workspaces"][0]["id"]

    response = client.post(f"/workspaces/{workspace_id}/discovery/rel-1/dismiss")

    assert response.status_code == 200
    assert response.json() == {"success": True}
    assert discovery.dismissed == ["rel-1"]
