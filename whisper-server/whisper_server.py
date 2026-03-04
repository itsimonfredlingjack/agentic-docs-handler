from __future__ import annotations

import sys
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from server.schemas import TranscriptionResponse, TranscriptionSegment, TranscriptionWord


class WhisperServerSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ADH_WHISPER_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "0.0.0.0"
    port: int = 8090
    model_name: str = "turbo"
    model_label: str = "large-v3-turbo"
    device: str = "cuda"
    compute_type: str = "float16"
    beam_size: int = 5
    vad_filter: bool = True
    word_timestamps: bool = True


class WhisperServerError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 500) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass
class FasterWhisperService:
    settings: WhisperServerSettings
    _model: Any | None = None

    def transcribe(
        self,
        *,
        filename: str,
        content: bytes,
        language: str | None = None,
    ) -> TranscriptionResponse:
        if not content:
            raise WhisperServerError("empty_audio_payload", status_code=422)

        model = self._load_model()
        segments, info = model.transcribe(
            BytesIO(content),
            task="transcribe",
            language=language,
            beam_size=self.settings.beam_size,
            vad_filter=self.settings.vad_filter,
            word_timestamps=self.settings.word_timestamps,
            multilingual=language is None,
            condition_on_previous_text=True,
        )
        segment_list = list(segments)
        text = " ".join(segment.text.strip() for segment in segment_list if segment.text.strip()).strip()
        return TranscriptionResponse(
            text=text,
            language=getattr(info, "language", language or "unknown"),
            language_probability=getattr(info, "language_probability", None),
            duration=getattr(info, "duration", None),
            duration_after_vad=getattr(info, "duration_after_vad", None),
            model=self.settings.model_label,
            source="whisper_server",
            segments=[
                TranscriptionSegment(
                    start=segment.start,
                    end=segment.end,
                    text=segment.text.strip(),
                    avg_logprob=getattr(segment, "avg_logprob", None),
                    no_speech_prob=getattr(segment, "no_speech_prob", None),
                    words=[
                        TranscriptionWord(
                            start=word.start,
                            end=word.end,
                            word=word.word,
                            probability=getattr(word, "probability", None),
                        )
                        for word in (getattr(segment, "words", None) or [])
                    ],
                )
                for segment in segment_list
            ],
        )

    def _load_model(self) -> Any:
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.settings.model_name,
                device=self.settings.device,
                compute_type=self.settings.compute_type,
            )
        return self._model


def create_app(
    *,
    settings: WhisperServerSettings | None = None,
    service: FasterWhisperService | None = None,
) -> FastAPI:
    settings = settings or WhisperServerSettings()
    service = service or FasterWhisperService(settings=settings)
    app = FastAPI(title="Agentic Docs Handler Whisper Server")

    @app.get("/", include_in_schema=False)
    async def root() -> JSONResponse:
        return JSONResponse({"name": "agentic-docs-handler-whisper", "status": "ok", "phase": 3})

    @app.get("/healthz")
    async def healthz() -> dict[str, object]:
        return {
            "status": "ok",
            "model": settings.model_label,
            "device": settings.device,
            "compute_type": settings.compute_type,
        }

    @app.post("/transcribe", response_model=TranscriptionResponse)
    async def transcribe(file: UploadFile = File(...), language: str | None = Form(None)) -> TranscriptionResponse:
        try:
            content = await file.read()
            return await run_in_threadpool(
                service.transcribe,
                filename=file.filename or "audio.bin",
                content=content,
                language=language,
            )
        except WhisperServerError as error:
            raise HTTPException(status_code=error.status_code, detail=str(error)) from error

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    current_settings = WhisperServerSettings()
    uvicorn.run(
        "whisper_server:app",
        host=current_settings.host,
        port=current_settings.port,
        reload=False,
        app_dir=str(Path(__file__).resolve().parent),
    )
