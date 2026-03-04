from __future__ import annotations

import json
from collections.abc import Callable

import httpx

from server.schemas import TranscriptionResponse


class WhisperProxyError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 503) -> None:
        super().__init__(message)
        self.status_code = status_code


class WhisperProxy:
    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: float = 300.0,
        async_client_factory: Callable[[], httpx.AsyncClient] | None = None,
        sync_client_factory: Callable[[], httpx.Client] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.async_client_factory = async_client_factory
        self.sync_client_factory = sync_client_factory

    def healthcheck(self) -> dict[str, object]:
        try:
            with self._build_sync_client() as client:
                response = client.get("/healthz")
                response.raise_for_status()
                payload = response.json()
            return {
                "ready": payload.get("status") == "ok",
                "details": payload,
            }
        except (httpx.HTTPError, ValueError, json.JSONDecodeError) as error:
            return {
                "ready": False,
                "details": {"error": str(error)},
            }

    async def transcribe(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str | None,
        language: str | None = None,
        client_id: str | None = None,
        client_request_id: str | None = None,
    ) -> TranscriptionResponse:
        data: dict[str, str] = {}
        if language:
            data["language"] = language
        if client_id:
            data["client_id"] = client_id
        if client_request_id:
            data["client_request_id"] = client_request_id
        files = {
            "file": (
                filename,
                content,
                content_type or "application/octet-stream",
            )
        }
        try:
            async with self._build_async_client() as client:
                response = await client.post("/transcribe", data=data, files=files)
        except httpx.HTTPError as error:
            raise WhisperProxyError(f"whisper_proxy_unreachable:{error}") from error

        if response.status_code >= 400:
            raise WhisperProxyError(self._extract_detail(response), status_code=response.status_code)

        try:
            payload = response.json()
        except ValueError as error:
            raise WhisperProxyError("whisper_proxy_invalid_json") from error
        return TranscriptionResponse.model_validate(payload)

    def _build_async_client(self) -> httpx.AsyncClient:
        if self.async_client_factory is not None:
            return self.async_client_factory()
        return httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout_seconds)

    def _build_sync_client(self) -> httpx.Client:
        if self.sync_client_factory is not None:
            return self.sync_client_factory()
        return httpx.Client(base_url=self.base_url, timeout=min(self.timeout_seconds, 10.0))

    @staticmethod
    def _extract_detail(response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            text = response.text.strip()
            return text or f"whisper_proxy_status:{response.status_code}"
        if isinstance(payload, dict) and "detail" in payload:
            return str(payload["detail"])
        return json.dumps(payload, ensure_ascii=True)
