from __future__ import annotations

import httpx
import pytest
from openai import APIStatusError

from server.clients.ollama_client import AsyncOllamaClient, OllamaServiceError
from server.logging_config import LLMLogWriter


@pytest.mark.asyncio
async def test_chat_text_maps_api_status_error_to_ollama_service_error(tmp_path) -> None:
    client = AsyncOllamaClient(
        base_url="http://localhost:11434/v1",
        api_key="ollama",
        model="ministral-3:14b",
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
