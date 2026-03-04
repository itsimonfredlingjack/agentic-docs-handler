from __future__ import annotations

import base64
import json
from typing import Any

from pydantic import ValidationError

from server.schemas import DocumentClassification


class ClassificationValidationError(RuntimeError):
    """Raised when the classifier cannot produce valid structured output."""


class DocumentClassifier:
    def __init__(
        self,
        *,
        ollama_client: Any,
        classifier_prompt: str,
        image_classifier_prompt: str,
        temperature: float = 0.1,
    ) -> None:
        self.ollama_client = ollama_client
        self.classifier_prompt = classifier_prompt
        self.image_classifier_prompt = image_classifier_prompt
        self.temperature = temperature

    async def classify_text(self, text: str, request_id: str = "local-test") -> DocumentClassification:
        messages = [
            {"role": "system", "content": self.classifier_prompt},
            {"role": "user", "content": text},
        ]
        return await self._run_with_repair(
            request_id=request_id,
            prompt_name="classifier",
            input_modality="text",
            messages=messages,
        )

    async def classify_image(
        self,
        image_bytes: bytes,
        mime_type: str,
        request_id: str = "local-test",
    ) -> DocumentClassification:
        encoded = base64.b64encode(image_bytes).decode("utf-8")
        messages = [
            {"role": "system", "content": self.image_classifier_prompt},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{encoded}"},
                    },
                    {
                        "type": "text",
                        "text": "Analysera dokumentbilden och returnera endast giltig JSON.",
                    },
                ],
            },
        ]
        return await self._run_with_repair(
            request_id=request_id,
            prompt_name="image_classifier",
            input_modality="image",
            messages=messages,
        )

    async def _run_with_repair(
        self,
        *,
        request_id: str,
        prompt_name: str,
        input_modality: str,
        messages: list[dict[str, Any]],
    ) -> DocumentClassification:
        raw, meta = await self._invoke_model(
            request_id=request_id,
            prompt_name=prompt_name,
            input_modality=input_modality,
            messages=messages,
        )
        try:
            parsed = json.loads(raw)
            classification = DocumentClassification.model_validate(parsed)
            self._record_log(meta, raw, json_parse_ok=True, schema_validation_ok=True)
            return classification
        except (json.JSONDecodeError, ValidationError):
            self._record_log(meta, raw, json_parse_ok=self._is_json(raw), schema_validation_ok=False)
            repaired_messages = messages + [
                {
                    "role": "user",
                    "content": (
                        "Din senaste respons var inte giltig JSON för schemat. "
                        "Svara igen med endast ett JSON-objekt som matchar kontraktet."
                    ),
                }
            ]
            repair_prompt_name = f"{prompt_name}_repair"
            repaired_raw, repaired_meta = await self._invoke_model(
                request_id=request_id,
                prompt_name=repair_prompt_name,
                input_modality=input_modality,
                messages=repaired_messages,
            )
            try:
                repaired_parsed = json.loads(repaired_raw)
                classification = DocumentClassification.model_validate(repaired_parsed)
                self._record_log(
                    repaired_meta,
                    repaired_raw,
                    json_parse_ok=True,
                    schema_validation_ok=True,
                )
                return classification
            except (json.JSONDecodeError, ValidationError) as error:
                self._record_log(
                    repaired_meta,
                    repaired_raw,
                    json_parse_ok=self._is_json(repaired_raw),
                    schema_validation_ok=False,
                )
                raise ClassificationValidationError("classifier produced invalid JSON twice") from error

    async def _invoke_model(
        self,
        *,
        request_id: str,
        prompt_name: str,
        input_modality: str,
        messages: list[dict[str, Any]],
    ) -> tuple[str, dict[str, Any] | None]:
        if hasattr(self.ollama_client, "chat_json_with_meta"):
            result = await self.ollama_client.chat_json_with_meta(
                request_id=request_id,
                prompt_name=prompt_name,
                input_modality=input_modality,
                messages=messages,
                temperature=self.temperature,
            )
            return result["content"], result

        raw = await self.ollama_client.chat_json(
            request_id=request_id,
            prompt_name=prompt_name,
            input_modality=input_modality,
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
            input_modality=meta["input_modality"],
            latency_ms=meta["latency_ms"],
            prompt_payload=meta["prompt_payload"],
            response_payload={"content": raw},
            json_parse_ok=json_parse_ok,
            schema_validation_ok=schema_validation_ok,
        )

    @staticmethod
    def _is_json(raw: str) -> bool:
        try:
            json.loads(raw)
        except json.JSONDecodeError:
            return False
        return True
