from __future__ import annotations

import json
import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx
from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI

from server.logging_config import LLMLogWriter

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class OllamaServiceError(RuntimeError):
    code: str
    retryable: bool
    upstream: str
    message: str
    status_code: int | None = None

    def __str__(self) -> str:
        return self.message


class AsyncOllamaClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float,
        log_writer: LLMLogWriter,
    ) -> None:
        self.base_url = base_url
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.log_writer = log_writer
        self.client = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout_seconds,
        )

    async def chat_json_with_meta(
        self,
        *,
        request_id: str,
        prompt_name: str,
        input_modality: str,
        messages: Sequence[dict[str, Any]],
        temperature: float,
    ) -> dict[str, Any]:
        payload = {
            "model": self.model,
            "messages": list(messages),
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }

        attempt = 0
        while True:
            started_at = time.perf_counter()
            logger.info(
                "ollama.request.start request_id=%s prompt_name=%s input_modality=%s model=%s attempt=%s",
                request_id,
                prompt_name,
                input_modality,
                self.model,
                attempt + 1,
            )
            try:
                response = await self.client.chat.completions.create(**payload)
                latency_ms = (time.perf_counter() - started_at) * 1000
                logger.info(
                    "ollama.request.done request_id=%s prompt_name=%s input_modality=%s model=%s latency_ms=%.2f",
                    request_id,
                    prompt_name,
                    input_modality,
                    self.model,
                    latency_ms,
                )
                content = response.choices[0].message.content or ""
                return {
                    "content": content,
                    "prompt_payload": payload,
                    "latency_ms": latency_ms,
                    "prompt_name": prompt_name,
                    "input_modality": input_modality,
                    "request_id": request_id,
                }
            except (APIConnectionError, APITimeoutError, APIStatusError, httpx.HTTPError) as error:
                if attempt >= 1:
                    mapped_error = self._map_error(error)
                    logger.error(
                        "ollama.request.error request_id=%s prompt_name=%s input_modality=%s model=%s code=%s retryable=%s status_code=%s",
                        request_id,
                        prompt_name,
                        input_modality,
                        self.model,
                        mapped_error.code,
                        mapped_error.retryable,
                        mapped_error.status_code,
                    )
                    raise mapped_error from error
                logger.warning(
                    "ollama.request.retry request_id=%s prompt_name=%s input_modality=%s model=%s attempt=%s error=%s",
                    request_id,
                    prompt_name,
                    input_modality,
                    self.model,
                    attempt + 1,
                    error,
                )
                attempt += 1

    async def chat_json(
        self,
        *,
        request_id: str,
        prompt_name: str,
        input_modality: str,
        messages: Sequence[dict[str, Any]],
        temperature: float,
    ) -> str:
        result = await self.chat_json_with_meta(
            request_id=request_id,
            prompt_name=prompt_name,
            input_modality=input_modality,
            messages=messages,
            temperature=temperature,
        )
        return result["content"]

    async def chat_text(
        self,
        *,
        request_id: str,
        prompt_name: str,
        input_modality: str,
        messages: Sequence[dict[str, Any]],
        temperature: float,
    ) -> str:
        payload = {
            "model": self.model,
            "messages": list(messages),
            "temperature": temperature,
        }
        attempt = 0
        while True:
            started_at = time.perf_counter()
            logger.info(
                "ollama.request.start request_id=%s prompt_name=%s input_modality=%s model=%s attempt=%s",
                request_id,
                prompt_name,
                input_modality,
                self.model,
                attempt + 1,
            )
            try:
                response = await self.client.chat.completions.create(**payload)
                latency_ms = (time.perf_counter() - started_at) * 1000
                logger.info(
                    "ollama.request.done request_id=%s prompt_name=%s input_modality=%s model=%s latency_ms=%.2f",
                    request_id,
                    prompt_name,
                    input_modality,
                    self.model,
                    latency_ms,
                )
                content = response.choices[0].message.content or ""
                self.log_writer.write_call(
                    request_id=request_id,
                    prompt_name=prompt_name,
                    model=self.model,
                    input_modality=input_modality,
                    latency_ms=latency_ms,
                    prompt_payload=payload,
                    response_payload={"content": content},
                    json_parse_ok=False,
                    schema_validation_ok=False,
                )
                return content
            except (APIConnectionError, APITimeoutError, APIStatusError, httpx.HTTPError) as error:
                if attempt >= 1:
                    mapped_error = self._map_error(error)
                    logger.error(
                        "ollama.request.error request_id=%s prompt_name=%s input_modality=%s model=%s code=%s retryable=%s status_code=%s",
                        request_id,
                        prompt_name,
                        input_modality,
                        self.model,
                        mapped_error.code,
                        mapped_error.retryable,
                        mapped_error.status_code,
                    )
                    raise mapped_error from error
                logger.warning(
                    "ollama.request.retry request_id=%s prompt_name=%s input_modality=%s model=%s attempt=%s error=%s",
                    request_id,
                    prompt_name,
                    input_modality,
                    self.model,
                    attempt + 1,
                    error,
                )
                attempt += 1

    def readiness(self) -> dict[str, bool]:
        parsed = urlparse(self.base_url)
        root_url = f"{parsed.scheme}://{parsed.netloc}/api/tags"
        try:
            response = httpx.get(root_url, timeout=min(self.timeout_seconds, 5.0))
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, json.JSONDecodeError):
            return {"ollama": False, "model": False}

        available_models = {
            model.get("name", "")
            for model in payload.get("models", [])
            if isinstance(model, dict)
        }
        model_ready = self.model in available_models
        return {"ollama": True, "model": model_ready}

    def _map_error(self, error: Exception) -> OllamaServiceError:
        if isinstance(error, APITimeoutError):
            return OllamaServiceError(
                code="ollama_timeout",
                retryable=True,
                upstream="ollama",
                message="ollama_timeout",
            )
        if isinstance(error, APIConnectionError):
            return OllamaServiceError(
                code="ollama_unavailable",
                retryable=True,
                upstream="ollama",
                message="ollama_unavailable",
            )
        status_code = getattr(getattr(error, "response", None), "status_code", None)
        return OllamaServiceError(
            code="ollama_upstream_error",
            retryable=True,
            upstream="ollama",
            message=str(error),
            status_code=status_code,
        )
