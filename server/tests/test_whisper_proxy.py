from __future__ import annotations

import httpx
import pytest

from server.pipelines.whisper_proxy import WhisperProxy, WhisperProxyError


def test_whisper_proxy_healthcheck_reports_ready() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/healthz"
        return httpx.Response(200, json={"status": "ok"})

    proxy = WhisperProxy(
        base_url="http://whisper",
        sync_client_factory=lambda: httpx.Client(
            transport=httpx.MockTransport(handler),
            base_url="http://whisper",
        ),
    )

    payload = proxy.healthcheck()

    assert payload["ready"] is True


@pytest.mark.asyncio
async def test_whisper_proxy_transcribes_bytes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/transcribe"
        return httpx.Response(
            200,
            json={
                "text": "Hello world",
                "language": "en",
                "language_probability": 0.99,
                "duration": 1.2,
                "duration_after_vad": 1.0,
                "model": "large-v3-turbo",
                "source": "whisper_server",
                "segments": [{"start": 0.0, "end": 1.2, "text": "Hello world", "words": []}],
            },
        )

    proxy = WhisperProxy(
        base_url="http://whisper",
        async_client_factory=lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            base_url="http://whisper",
        ),
    )

    result = await proxy.transcribe(
        filename="clip.wav",
        content=b"fake-audio",
        content_type="audio/wav",
        language="en",
    )

    assert result.language == "en"
    assert result.text == "Hello world"


@pytest.mark.asyncio
async def test_whisper_proxy_surfaces_upstream_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "whisper_booting"})

    proxy = WhisperProxy(
        base_url="http://whisper",
        async_client_factory=lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            base_url="http://whisper",
        ),
    )

    with pytest.raises(WhisperProxyError) as error:
        await proxy.transcribe(
            filename="clip.wav",
            content=b"fake-audio",
            content_type="audio/wav",
        )

    assert error.value.status_code == 503
    assert "whisper_booting" in str(error.value)
