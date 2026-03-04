from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from server.clients.ollama_client import extract_json_object_text
from server.schemas import DocumentClassification, ExtractionResult


class ExtractionValidationError(RuntimeError):
    """Raised when extraction cannot be validated."""


class DocumentExtractor:
    def __init__(
        self,
        *,
        ollama_client: Any,
        prompts: dict[str, str],
        temperature: float = 0.1,
    ) -> None:
        self.ollama_client = ollama_client
        self.prompts = prompts
        self.temperature = temperature

    async def extract(
        self,
        text: str,
        classification: DocumentClassification,
        request_id: str,
    ) -> ExtractionResult:
        document_type = classification.document_type
        system_prompt = self.prompts.get(document_type, self.prompts["generic"])
        prompt_name = f"extract_{document_type}"
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text},
        ]
        raw, meta = await self._invoke_model(
            request_id=request_id,
            prompt_name=prompt_name,
            messages=messages,
        )
        try:
            payload = json.loads(extract_json_object_text(raw))
            result = ExtractionResult.model_validate(payload)
            self._record_log(meta, raw, json_parse_ok=True, schema_validation_ok=True)
            return result
        except (json.JSONDecodeError, ValidationError) as error:
            self._record_log(meta, raw, json_parse_ok=self._is_json(raw), schema_validation_ok=False)
            raise ExtractionValidationError("extractor produced invalid JSON") from error

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

    def _record_log(
        self,
        meta: dict[str, Any] | None,
        raw: str,
        *,
        json_parse_ok: bool,
        schema_validation_ok: bool,
    ) -> None:
        if not meta or not hasattr(self.ollama_client, "log_writer"):
            return
        self.ollama_client.log_writer.write_call(
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

    @staticmethod
    def _is_json(raw: str) -> bool:
        try:
            json.loads(extract_json_object_text(raw))
        except json.JSONDecodeError:
            return False
        return True
