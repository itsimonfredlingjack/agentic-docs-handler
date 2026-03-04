from __future__ import annotations

import base64
import json
import logging
from io import BytesIO
from typing import Any

from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from server.schemas import DocumentClassification

logger = logging.getLogger(__name__)


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
        max_image_dimension: int = 1600,
    ) -> None:
        self.ollama_client = ollama_client
        self.classifier_prompt = classifier_prompt
        self.image_classifier_prompt = image_classifier_prompt
        self.temperature = temperature
        self.max_image_dimension = max_image_dimension

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
        prepared_bytes = self._prepare_image_bytes(image_bytes, mime_type)
        encoded = base64.b64encode(prepared_bytes).decode("utf-8")
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
            logger.warning(
                "classifier.parse_failed request_id=%s prompt_name=%s modality=%s repair_attempt=1",
                request_id,
                prompt_name,
                input_modality,
            )
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
            logger.info(
                "classifier.repair.start request_id=%s prompt_name=%s modality=%s",
                request_id,
                repair_prompt_name,
                input_modality,
            )
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
                logger.info(
                    "classifier.repair.done request_id=%s prompt_name=%s modality=%s",
                    request_id,
                    repair_prompt_name,
                    input_modality,
                )
                return classification
            except (json.JSONDecodeError, ValidationError) as error:
                logger.error(
                    "classifier.repair.failed request_id=%s prompt_name=%s modality=%s",
                    request_id,
                    repair_prompt_name,
                    input_modality,
                )
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

    def _prepare_image_bytes(self, image_bytes: bytes, mime_type: str) -> bytes:
        try:
            image = Image.open(BytesIO(image_bytes))
        except (UnidentifiedImageError, OSError):
            return image_bytes

        original_size = image.size
        if max(original_size) <= self.max_image_dimension:
            return image_bytes

        resized = image.copy()
        resized.thumbnail((self.max_image_dimension, self.max_image_dimension), Image.Resampling.LANCZOS)
        buffer = BytesIO()
        save_format = {
            "image/jpeg": "JPEG",
            "image/png": "PNG",
            "image/webp": "WEBP",
        }.get(mime_type, image.format or "PNG")
        save_kwargs: dict[str, Any] = {"optimize": True}
        if save_format == "JPEG":
            if resized.mode not in {"RGB", "L"}:
                resized = resized.convert("RGB")
            save_kwargs.update({"quality": 85, "progressive": True})
        resized.save(buffer, format=save_format, **save_kwargs)
        logger.info(
            "classifier.image_prepared original_size=%sx%s resized_size=%sx%s bytes_before=%s bytes_after=%s",
            original_size[0],
            original_size[1],
            resized.size[0],
            resized.size[1],
            len(image_bytes),
            buffer.tell(),
        )
        return buffer.getvalue()
