from __future__ import annotations

import json
import logging
import time
import asyncio
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx
from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI

from server.logging_config import LLMLogWriter

logger = logging.getLogger(__name__)


def extract_json_object_text(raw: str) -> str:
    candidate = raw.strip()
    if not candidate:
        return candidate
    try:
        json.loads(candidate)
        return candidate
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    for index, char in enumerate(candidate):
        if char not in "{[":
            continue
        try:
            _, end = decoder.raw_decode(candidate[index:])
        except json.JSONDecodeError:
            continue
        return candidate[index : index + end]
    return candidate


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
        max_concurrency: int = 1,
        num_ctx: int | None = None,
    ) -> None:
        self.base_url = base_url
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.log_writer = log_writer
        self.num_ctx = num_ctx
        self.max_concurrency = max(1, max_concurrency)
        self._semaphore = asyncio.Semaphore(self.max_concurrency)
        self.client = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout_seconds,
            max_retries=0,
        )

    def _extra_body(self) -> dict[str, Any]:
        body: dict[str, Any] = {"think": False}
        if self.num_ctx is not None:
            body["options"] = {"num_ctx": self.num_ctx}
        return body

    async def chat_json_with_meta(
        self,
        *,
        request_id: str,
        prompt_name: str,
        input_modality: str,
        messages: Sequence[dict[str, Any]],
        temperature: float,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": list(messages),
            "temperature": temperature,
        }
        payload["extra_body"] = self._extra_body()

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
                async with self._semaphore:
                    logger.info(
                        "ollama.request.acquired request_id=%s prompt_name=%s input_modality=%s model=%s max_concurrency=%s",
                        request_id,
                        prompt_name,
                        input_modality,
                        self.model,
                        self.max_concurrency,
                    )
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
                raw_content = response.choices[0].message.content or ""
                content = extract_json_object_text(raw_content)
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
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": list(messages),
            "temperature": temperature,
        }
        payload["extra_body"] = self._extra_body()
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
                async with self._semaphore:
                    logger.info(
                        "ollama.request.acquired request_id=%s prompt_name=%s input_modality=%s model=%s max_concurrency=%s",
                        request_id,
                        prompt_name,
                        input_modality,
                        self.model,
                        self.max_concurrency,
                    )
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

    async def chat_text_stream(
        self,
        *,
        request_id: str,
        prompt_name: str,
        input_modality: str,
        messages: Sequence[dict[str, Any]],
        temperature: float,
    ) -> AsyncIterator[str]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": list(messages),
            "temperature": temperature,
            "stream": True,
        }
        payload["extra_body"] = self._extra_body()
        started_at = time.perf_counter()
        logger.info(
            "ollama.stream.start request_id=%s prompt_name=%s model=%s",
            request_id,
            prompt_name,
            self.model,
        )
        try:
            async with self._semaphore:
                response = await self.client.chat.completions.create(**payload)
                async for chunk in response:
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield chunk.choices[0].delta.content
        except (APIConnectionError, APITimeoutError, APIStatusError, httpx.HTTPError) as error:
            raise self._map_error(error) from error
        finally:
            latency_ms = (time.perf_counter() - started_at) * 1000
            logger.info(
                "ollama.stream.done request_id=%s prompt_name=%s latency_ms=%.2f",
                request_id,
                prompt_name,
                latency_ms,
            )

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
