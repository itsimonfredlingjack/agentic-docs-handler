from __future__ import annotations

import json
import time
from collections.abc import Sequence
from typing import Any
from urllib.parse import urlparse

import httpx
from openai import APIConnectionError, APITimeoutError, AsyncOpenAI

from server.logging_config import LLMLogWriter


class OllamaServiceError(RuntimeError):
    """Raised when the upstream Ollama service cannot serve a request."""


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
            try:
                response = await self.client.chat.completions.create(**payload)
                latency_ms = (time.perf_counter() - started_at) * 1000
                content = response.choices[0].message.content or ""
                return {
                    "content": content,
                    "prompt_payload": payload,
                    "latency_ms": latency_ms,
                    "prompt_name": prompt_name,
                    "input_modality": input_modality,
                    "request_id": request_id,
                }
            except (APIConnectionError, APITimeoutError, httpx.HTTPError) as error:
                if attempt >= 1:
                    raise OllamaServiceError(str(error)) from error
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
            try:
                response = await self.client.chat.completions.create(**payload)
                latency_ms = (time.perf_counter() - started_at) * 1000
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
            except (APIConnectionError, APITimeoutError, httpx.HTTPError) as error:
                if attempt >= 1:
                    raise OllamaServiceError(str(error)) from error
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
