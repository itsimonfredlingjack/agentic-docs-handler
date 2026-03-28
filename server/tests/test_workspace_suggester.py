"""Tests for workspace suggestion pipeline."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from server.pipelines.workspace_suggester import (
    WorkspaceSuggester,
    WorkspaceSuggestion,
    _build_suggestion_context,
    _match_workspace_by_name,
    _parse_suggestion,
)


# ------------------------------------------------------------------
# Parsing
# ------------------------------------------------------------------

class TestParseSuggestion:
    def test_valid_json(self) -> None:
        raw = json.dumps({
            "workspace_name": "Bostadsrätten",
            "confidence": 0.9,
            "reason": "Handlar om bostadsköp",
        })
        result = _parse_suggestion(raw)
        assert result.workspace_name == "Bostadsrätten"
        assert result.confidence == 0.9

    def test_null_workspace(self) -> None:
        raw = json.dumps({"workspace_name": None, "confidence": 0.1, "reason": "no match"})
        result = _parse_suggestion(raw)
        assert result.workspace_name is None

    def test_prose_wrapped_json(self) -> None:
        raw = 'Här är mitt svar:\n{"workspace_name": "Skatt", "confidence": 0.7, "reason": "Skatteärende"}'
        result = _parse_suggestion(raw)
        assert result.workspace_name == "Skatt"


# ------------------------------------------------------------------
# Name matching
# ------------------------------------------------------------------

class TestMatchWorkspaceByName:
    def test_exact_match(self) -> None:
        workspaces = [
            {"id": "ws-1", "name": "Bostadsrätten"},
            {"id": "ws-2", "name": "Skatt 2025"},
        ]
        assert _match_workspace_by_name("Bostadsrätten", workspaces) == "ws-1"

    def test_case_insensitive(self) -> None:
        workspaces = [{"id": "ws-1", "name": "Skatt 2025"}]
        assert _match_workspace_by_name("skatt 2025", workspaces) == "ws-1"

    def test_partial_match(self) -> None:
        workspaces = [{"id": "ws-1", "name": "Skatteärenden 2025"}]
        assert _match_workspace_by_name("Skatteärenden", workspaces) == "ws-1"

    def test_no_match(self) -> None:
        workspaces = [{"id": "ws-1", "name": "Bostadsrätten"}]
        assert _match_workspace_by_name("Helt annat", workspaces) is None


# ------------------------------------------------------------------
# Context building
# ------------------------------------------------------------------

class TestBuildSuggestionContext:
    def test_includes_file_and_workspaces(self) -> None:
        context = _build_suggestion_context(
            title="Kvitto IKEA",
            summary="Matinköp på IKEA",
            document_type="receipt",
            entities=[{"name": "IKEA", "entity_type": "company"}],
            workspaces=[{"id": "ws-1", "name": "Kvitton", "description": "Alla kvitton"}],
        )
        assert "Kvitto IKEA" in context
        assert "receipt" in context
        assert "IKEA" in context
        assert "Kvitton" in context


# ------------------------------------------------------------------
# Full suggester with mocked LLM
# ------------------------------------------------------------------

class TestWorkspaceSuggester:
    @pytest.fixture()
    def suggester(self) -> WorkspaceSuggester:
        mock_client = AsyncMock()
        return WorkspaceSuggester(
            ollama_client=mock_client,
            system_prompt="test prompt",
            temperature=0.1,
        )

    @pytest.mark.asyncio()
    async def test_high_confidence_auto_assigns(self, suggester: WorkspaceSuggester) -> None:
        response_json = json.dumps({
            "workspace_name": "Bostadsrätten",
            "confidence": 0.9,
            "reason": "Matchar bostadsköpet",
        })
        suggester.ollama_client.chat_json_with_meta = AsyncMock(return_value={
            "content": response_json,
            "prompt_payload": {},
            "latency_ms": 100,
            "prompt_name": "workspace_suggestion",
            "input_modality": "text",
            "request_id": "req-1",
        })

        result = await suggester.suggest(
            title="Köpeavtal",
            summary="Avtal för Storgatan 14",
            document_type="contract",
            entities=[{"name": "Nordea", "entity_type": "company"}],
            workspaces=[{"id": "ws-1", "name": "Bostadsrätten", "description": "Bostadsköp"}],
            request_id="req-1",
        )

        assert result.auto_assigned is True
        assert result.workspace_id == "ws-1"
        assert result.confidence == 0.9

    @pytest.mark.asyncio()
    async def test_low_confidence_stays_inbox(self, suggester: WorkspaceSuggester) -> None:
        response_json = json.dumps({
            "workspace_name": "Bostadsrätten",
            "confidence": 0.5,
            "reason": "Osäker match",
        })
        suggester.ollama_client.chat_json_with_meta = AsyncMock(return_value={
            "content": response_json,
            "prompt_payload": {},
            "latency_ms": 100,
            "prompt_name": "workspace_suggestion",
            "input_modality": "text",
            "request_id": "req-1",
        })

        result = await suggester.suggest(
            title="Kvitto",
            summary="Okänt kvitto",
            document_type="receipt",
            entities=[],
            workspaces=[{"id": "ws-1", "name": "Bostadsrätten", "description": ""}],
            request_id="req-1",
        )

        assert result.auto_assigned is False
        assert result.workspace_id == "ws-1"  # still suggested, just not auto-assigned

    @pytest.mark.asyncio()
    async def test_no_workspaces_returns_none(self, suggester: WorkspaceSuggester) -> None:
        result = await suggester.suggest(
            title="Test",
            summary="Test doc",
            document_type="generic",
            entities=[],
            workspaces=[],
            request_id="req-1",
        )

        assert result.workspace_id is None
        assert result.reason == "no_workspaces_available"

    @pytest.mark.asyncio()
    async def test_none_response_stays_inbox(self, suggester: WorkspaceSuggester) -> None:
        response_json = json.dumps({
            "workspace_name": None,
            "confidence": 0.0,
            "reason": "Ingen matchande workspace",
        })
        suggester.ollama_client.chat_json_with_meta = AsyncMock(return_value={
            "content": response_json,
            "prompt_payload": {},
            "latency_ms": 100,
            "prompt_name": "workspace_suggestion",
            "input_modality": "text",
            "request_id": "req-1",
        })

        result = await suggester.suggest(
            title="Random doc",
            summary="Nothing relevant",
            document_type="generic",
            entities=[],
            workspaces=[{"id": "ws-1", "name": "Bostadsrätten", "description": ""}],
            request_id="req-1",
        )

        assert result.workspace_id is None
        assert result.auto_assigned is False

    @pytest.mark.asyncio()
    async def test_llm_failure_degrades_gracefully(self, suggester: WorkspaceSuggester) -> None:
        suggester.ollama_client.chat_json_with_meta = AsyncMock(
            side_effect=RuntimeError("LLM down")
        )

        result = await suggester.suggest(
            title="Test",
            summary="Test",
            document_type="generic",
            entities=[],
            workspaces=[{"id": "ws-1", "name": "Test", "description": ""}],
            request_id="req-1",
        )

        assert result.workspace_id is None
        assert result.reason == "llm_failed"

    @pytest.mark.asyncio()
    async def test_invalid_json_degrades_gracefully(self, suggester: WorkspaceSuggester) -> None:
        suggester.ollama_client.chat_json_with_meta = AsyncMock(return_value={
            "content": "not json at all",
            "prompt_payload": {},
            "latency_ms": 100,
            "prompt_name": "workspace_suggestion",
            "input_modality": "text",
            "request_id": "req-1",
        })

        result = await suggester.suggest(
            title="Test",
            summary="Test",
            document_type="generic",
            entities=[],
            workspaces=[{"id": "ws-1", "name": "Test", "description": ""}],
            request_id="req-1",
        )

        assert result.workspace_id is None
        assert result.reason == "parse_failed"
