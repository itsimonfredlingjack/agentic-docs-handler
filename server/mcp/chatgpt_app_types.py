from __future__ import annotations

from pydantic import BaseModel, Field, HttpUrl


class UploadedFileRef(BaseModel):
    download_url: HttpUrl
    file_id: str = Field(min_length=1, max_length=256)


class SessionSeed(BaseModel):
    session_id: str
    query: str = ""
    results: list[dict[str, object]] = Field(default_factory=list)


class SessionSearchInput(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=5, ge=1, le=50)


class SessionFetchInput(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)
    id: str = Field(min_length=1, max_length=256)


class AnalyzeUploadedInput(BaseModel):
    file: UploadedFileRef
    session_id: str | None = Field(default=None, min_length=1, max_length=128)
    language: str | None = Field(default=None, min_length=2, max_length=10)


class PreviewOrganizeInput(BaseModel):
    file: UploadedFileRef
    session_id: str | None = Field(default=None, min_length=1, max_length=128)


class ConfirmOrganizeInput(BaseModel):
    write_plan_id: str = Field(min_length=1, max_length=128)
    confirm_token: str = Field(min_length=1, max_length=256)
    idempotency_key: str = Field(min_length=1, max_length=256)


class RenderConsoleInput(BaseModel):
    session_id: str | None = Field(default=None, min_length=1, max_length=128)
    query: str | None = Field(default=None, min_length=1, max_length=500)
