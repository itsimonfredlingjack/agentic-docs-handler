from __future__ import annotations

import asyncio

import httpx
import pytest
from openai import APIStatusError

from server.clients.ollama_client import AsyncOllamaClient, OllamaServiceError
from server.config import LLM_MODEL
from server.logging_config import LLMLogWriter


@pytest.mark.asyncio
async def test_chat_text_maps_api_status_error_to_ollama_service_error(tmp_path) -> None:
    client = AsyncOllamaClient(
        base_url="http://localhost:11434/v1",
        api_key="ollama",
        model=LLM_MODEL,
        timeout_seconds=5,
        log_writer=LLMLogWriter(tmp_path / "llm"),
    )

    async def raise_status_error(**_: object) -> object:
        request = httpx.Request("POST", "http://localhost:11434/v1/chat/completions")
        response = httpx.Response(500, request=request, json={"error": "upstream"})
        raise APIStatusError("upstream failure", response=response, body={"error": "upstream"})

    client.client.chat.completions.create = raise_status_error  # type: ignore[method-assign]

    with pytest.raises(OllamaServiceError) as error:
        await client.chat_text(
            request_id="req-500",
            prompt_name="classifier",
            input_modality="text",
            messages=[{"role": "user", "content": "hello"}],
            temperature=0.1,
        )

    assert error.value.code == "ollama_upstream_error"
    assert error.value.status_code == 500
    assert error.value.retryable is True


@pytest.mark.asyncio
async def test_chat_text_serializes_ollama_requests_when_max_concurrency_is_one(tmp_path) -> None:
    client = AsyncOllamaClient(
        base_url="http://localhost:11434/v1",
        api_key="ollama",
        model=LLM_MODEL,
        timeout_seconds=5,
        log_writer=LLMLogWriter(tmp_path / "llm"),
        max_concurrency=1,
    )

    active_calls = 0
    max_active_calls = 0

    async def fake_create(**_: object) -> object:
        nonlocal active_calls, max_active_calls
        active_calls += 1
        max_active_calls = max(max_active_calls, active_calls)
        await asyncio.sleep(0.05)
        active_calls -= 1
        return type(
            "FakeResponse",
            (),
            {
                "choices": [
                    type(
                        "Choice",
                        (),
                        {"message": type("Message", (), {"content": "hello"})()},
                    )()
                ]
            },
        )()

    client.client.chat.completions.create = fake_create  # type: ignore[method-assign]

    await asyncio.gather(
        client.chat_text(
            request_id="req-1",
            prompt_name="classifier",
            input_modality="text",
            messages=[{"role": "user", "content": "a"}],
            temperature=0.1,
        ),
        client.chat_text(
            request_id="req-2",
            prompt_name="classifier",
            input_modality="text",
            messages=[{"role": "user", "content": "b"}],
            temperature=0.1,
        ),
    )

    assert max_active_calls == 1
