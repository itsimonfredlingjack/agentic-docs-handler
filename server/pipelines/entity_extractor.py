"""Entity extraction pipeline.

Extracts structured entities (people, companies, dates, amounts, places, topics)
from document text using the configured Ollama model.
"""
from __future__ import annotations

import json
import inspect
import logging
from typing import Any

from pydantic import ValidationError

from server.clients.ollama_client import extract_json_object_text
from server.schemas import EntityExtractionResult, ExtractedEntity

logger = logging.getLogger(__name__)

# Entities with names shorter than this are likely noise
_MIN_ENTITY_NAME_LENGTH = 2
# Cap to avoid runaway LLM output
_MAX_ENTITIES = 30


class EntityExtractionError(RuntimeError):
    """Raised when entity extraction fails validation."""


class EntityExtractor:
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

    async def extract(
        self,
        *,
        text: str,
        request_id: str,
    ) -> EntityExtractionResult:
        """Extract entities from document text.

        Returns EntityExtractionResult with deduplicated, normalized entities.
        Raises EntityExtractionError if the model returns unparseable output.
        """
        if not text.strip():
            return EntityExtractionResult(entities=[])

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": text},
        ]
        raw, meta = await self._invoke_model(
            request_id=request_id,
            prompt_name="entity_extraction",
            messages=messages,
        )
        try:
            payload = json.loads(extract_json_object_text(raw))
            result = EntityExtractionResult.model_validate(payload)
            await self._record_log(meta, raw, json_parse_ok=True, schema_validation_ok=True)
            return _normalize_and_deduplicate(result)
        except (json.JSONDecodeError, ValidationError) as error:
            await self._record_log(meta, raw, json_parse_ok=_is_json(raw), schema_validation_ok=False)
            raise EntityExtractionError("entity extractor produced invalid JSON") from error

    async def _invoke_model(
        self,
        *,
        request_id: str,
        prompt_name: str,
        messages: list[dict[str, Any]],
    ) -> tuple[str, dict[str, Any] | None]:
        if hasattr(self.ollama_client, "chat_json_with_meta"):
            result = await self.ollama_client.chat_json_with_meta(
                request_id=request_id,
                prompt_name=prompt_name,
                input_modality="text",
                messages=messages,
                temperature=self.temperature,
            )
            return result["content"], result

        raw = await self.ollama_client.chat_json(
            request_id=request_id,
            prompt_name=prompt_name,
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


def _normalize_and_deduplicate(result: EntityExtractionResult) -> EntityExtractionResult:
    """Normalize entity names and deduplicate by (normalized_name, type)."""
    seen: dict[tuple[str, str], ExtractedEntity] = {}
    for entity in result.entities:
        name = _normalize_name(entity.name)
        if len(name) < _MIN_ENTITY_NAME_LENGTH:
            continue
        key = (name.lower(), entity.entity_type)
        existing = seen.get(key)
        if existing is None:
            seen[key] = ExtractedEntity(
                name=name,
                entity_type=entity.entity_type,
                context=entity.context.strip(),
            )
        elif len(entity.context) > len(existing.context):
            # Keep the longer context
            seen[key] = ExtractedEntity(
                name=name if len(name) > len(existing.name) else existing.name,
                entity_type=entity.entity_type,
                context=entity.context.strip(),
            )

    entities = list(seen.values())[:_MAX_ENTITIES]
    return EntityExtractionResult(entities=entities)


def _normalize_name(name: str) -> str:
    """Clean up entity name: strip whitespace, collapse internal spaces."""
    return " ".join(name.split())


def _is_json(raw: str) -> bool:
    try:
        json.loads(extract_json_object_text(raw))
    except json.JSONDecodeError:
        return False
    return True
