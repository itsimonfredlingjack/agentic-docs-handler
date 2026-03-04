from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from server.schemas import TranscriptionResponse, TranscriptionSegment


def load_whisper_server_module():
    module_path = Path(__file__).resolve().parents[2] / "whisper-server" / "whisper_server.py"
    spec = importlib.util.spec_from_file_location("adh_whisper_server", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeWhisperRuntime:
    def transcribe(self, *, filename: str, content: bytes, language: str | None = None) -> TranscriptionResponse:
        return TranscriptionResponse(
            text=f"{filename}:{language or 'auto'}:{len(content)}",
            language=language or "en",
            language_probability=0.88,
            duration=1.5,
            duration_after_vad=1.3,
            model="large-v3-turbo",
            segments=[TranscriptionSegment(start=0.0, end=1.5, text="hello test")],
        )


def test_whisper_server_transcribe_endpoint_returns_response() -> None:
    module = load_whisper_server_module()
    app = module.create_app(service=FakeWhisperRuntime())

    with TestClient(app) as client:
        response = client.post(
            "/transcribe",
            files={"file": ("clip.wav", b"fake-audio", "audio/wav")},
            data={"language": "en"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["language"] == "en"
    assert payload["segments"][0]["text"] == "hello test"
