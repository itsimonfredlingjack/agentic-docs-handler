"""Workspace suggestion pipeline.

Suggests which workspace a file should belong to based on its content,
entities, and the available workspaces.
"""
from __future__ import annotations

import json
import inspect
import logging
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from server.clients.ollama_client import extract_json_object_text
from server.schemas import DocumentClassification, EntityExtractionResult

logger = logging.getLogger(__name__)

_AUTO_ASSIGN_THRESHOLD = 0.8


class WorkspaceSuggestion(BaseModel):
    workspace_name: str | None = None
    confidence: float = 0.0
    reason: str = ""


@dataclass(slots=True)
class SuggestionResult:
    workspace_id: str | None
    workspace_name: str | None
    confidence: float
    reason: str
    auto_assigned: bool


class WorkspaceSuggester:
    def __init__(
        self,
        *,
        ollama_client: Any,
        system_prompt: str,
        temperature: float = 0.1,
    ) -> None:
        self.ollama_client = ollama_client
        self.system_prompt = system_prompt
        self.temperature = temperature

    async def suggest(
        self,
        *,
        title: str,
        summary: str,
        document_type: str,
        entities: list[dict[str, str]],
        workspaces: list[dict[str, str]],
        request_id: str,
    ) -> SuggestionResult:
        """Suggest a workspace for a file.

        Args:
            title: Document title
            summary: Document summary
            document_type: Classification type (receipt, invoice, etc.)
            entities: Extracted entities as dicts with name, entity_type
            workspaces: Available workspaces as dicts with id, name, description
            request_id: For logging

        Returns:
            SuggestionResult with workspace_id (None if no match) and confidence.
        """
        if not workspaces:
            return SuggestionResult(
                workspace_id=None, workspace_name=None,
                confidence=0.0, reason="no_workspaces_available",
                auto_assigned=False,
            )

        context = _build_suggestion_context(
            title=title,
            summary=summary,
            document_type=document_type,
            entities=entities,
            workspaces=workspaces,
        )

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": context},
        ]

        try:
            raw, meta = await self._invoke_model(
                request_id=request_id,
                messages=messages,
            )
            suggestion = _parse_suggestion(raw)
            await self._record_log(meta, raw, json_parse_ok=True, schema_validation_ok=True)
        except (json.JSONDecodeError, ValidationError, _SuggestionParseError):
            logger.warning("Workspace suggestion parse failed for %s", request_id)
            return SuggestionResult(
                workspace_id=None, workspace_name=None,
                confidence=0.0, reason="parse_failed",
                auto_assigned=False,
            )
        except Exception:
            logger.warning("Workspace suggestion LLM call failed for %s", request_id, exc_info=True)
            return SuggestionResult(
                workspace_id=None, workspace_name=None,
                confidence=0.0, reason="llm_failed",
                auto_assigned=False,
            )

        if suggestion.workspace_name is None or suggestion.confidence < 0.1:
            return SuggestionResult(
                workspace_id=None, workspace_name=None,
                confidence=suggestion.confidence,
                reason=suggestion.reason or "no_match",
                auto_assigned=False,
            )

        # Match name to workspace id
        matched_id = _match_workspace_by_name(suggestion.workspace_name, workspaces)
        if matched_id is None:
            return SuggestionResult(
                workspace_id=None, workspace_name=suggestion.workspace_name,
                confidence=suggestion.confidence,
                reason="workspace_name_not_found",
                auto_assigned=False,
            )

        auto = suggestion.confidence >= _AUTO_ASSIGN_THRESHOLD
        return SuggestionResult(
            workspace_id=matched_id,
            workspace_name=suggestion.workspace_name,
            confidence=suggestion.confidence,
            reason=suggestion.reason,
            auto_assigned=auto,
        )

    async def _invoke_model(
        self,
        *,
        request_id: str,
        messages: list[dict[str, Any]],
    ) -> tuple[str, dict[str, Any] | None]:
        if hasattr(self.ollama_client, "chat_json_with_meta"):
            result = await self.ollama_client.chat_json_with_meta(
                request_id=request_id,
                prompt_name="workspace_suggestion",
                input_modality="text",
                messages=messages,
                temperature=self.temperature,
            )
            return result["content"], result

        raw = await self.ollama_client.chat_json(
            request_id=request_id,
            prompt_name="workspace_suggestion",
            input_modality="text",
            messages=messages,
            temperature=self.temperature,
        )
        return raw, None

    async def _record_log(
        self,
        meta: dict[str, Any] | None,
        raw: str,
        *,
        json_parse_ok: bool,
        schema_validation_ok: bool,
    ) -> None:
        if not meta or not hasattr(self.ollama_client, "log_writer"):
            return
        result = self.ollama_client.log_writer.write_call(
            request_id=meta["request_id"],
            prompt_name=meta["prompt_name"],
            model=self.ollama_client.model,
            input_modality="text",
            latency_ms=meta["latency_ms"],
            prompt_payload=meta["prompt_payload"],
            response_payload={"content": raw},
            json_parse_ok=json_parse_ok,
            schema_validation_ok=schema_validation_ok,
        )
        if inspect.isawaitable(result):
            await result


class _SuggestionParseError(RuntimeError):
    pass


def _parse_suggestion(raw: str) -> WorkspaceSuggestion:
    """Parse LLM response into WorkspaceSuggestion."""
    try:
        payload = json.loads(extract_json_object_text(raw))
        return WorkspaceSuggestion.model_validate(payload)
    except (json.JSONDecodeError, ValidationError) as error:
        raise _SuggestionParseError("invalid suggestion JSON") from error


def _match_workspace_by_name(
    name: str,
    workspaces: list[dict[str, str]],
) -> str | None:
    """Find workspace id by name (case-insensitive)."""
    name_lower = name.strip().lower()
    for ws in workspaces:
        if ws["name"].strip().lower() == name_lower:
            return ws["id"]
    # Fuzzy fallback: check if name is contained in workspace name
    for ws in workspaces:
        if name_lower in ws["name"].strip().lower() or ws["name"].strip().lower() in name_lower:
            return ws["id"]
    return None


def _build_suggestion_context(
    *,
    title: str,
    summary: str,
    document_type: str,
    entities: list[dict[str, str]],
    workspaces: list[dict[str, str]],
) -> str:
    """Build the LLM context for workspace suggestion."""
    lines: list[str] = []

    lines.append("FIL:")
    lines.append(f"  Titel: {title}")
    lines.append(f"  Typ: {document_type}")
    lines.append(f"  Sammanfattning: {summary[:300]}")

    if entities:
        entity_strs = [f"{e.get('name', '')} ({e.get('entity_type', '')})" for e in entities[:15]]
        lines.append(f"  Entiteter: {', '.join(entity_strs)}")

    lines.append("")
    lines.append("WORKSPACES:")
    for ws in workspaces:
        desc = ws.get("description", "")
        brief = ws.get("ai_brief", "")
        detail = desc or brief
        if detail:
            lines.append(f"  - {ws['name']}: {detail[:150]}")
        else:
            lines.append(f"  - {ws['name']}")

    return "\n".join(lines)
