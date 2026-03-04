from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

DocumentType = Literal[
    "receipt",
    "contract",
    "invoice",
    "meeting_notes",
    "generic",
    "unsupported",
]
FileActionType = Literal["none", "auto_moved", "needs_confirmation", "failed"]
ProcessingStatus = Literal[
    "classified",
    "extracted",
    "move_planned",
    "move_executed",
    "failed_validation",
    "failed_runtime",
]


class DocumentClassification(BaseModel):
    document_type: DocumentType
    template: str
    title: str
    summary: str
    tags: list[str] = Field(default_factory=list)
    language: str
    confidence: float = Field(ge=0.0, le=1.0)
    ocr_text: str | None = None
    suggested_actions: list[str] = Field(default_factory=list)


class ExtractionResult(BaseModel):
    fields: dict[str, Any] = Field(default_factory=dict)
    field_confidence: dict[str, float] = Field(default_factory=dict)
    missing_fields: list[str] = Field(default_factory=list)


class MovePlan(BaseModel):
    rule_name: str | None = None
    destination: str | None = None
    auto_move_allowed: bool = False
    reason: str


class MoveResult(BaseModel):
    attempted: bool = False
    success: bool = False
    from_path: str | None = None
    to_path: str | None = None
    error: str | None = None


class ProcessResponse(BaseModel):
    request_id: str
    status: ProcessingStatus
    mime_type: str
    classification: DocumentClassification
    extraction: ExtractionResult
    move_plan: MovePlan
    move_result: MoveResult
    timings: dict[str, float] = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)


class LLMCallLogEntry(BaseModel):
    request_id: str
    prompt_name: str
    model: str
    input_modality: str
    latency_ms: float
    raw_prompt_path: str
    raw_response_path: str
    json_parse_ok: bool
    schema_validation_ok: bool


class SearchResult(BaseModel):
    doc_id: str
    title: str
    source_path: str
    snippet: str
    score: float
    vector_score: float
    keyword_score: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class SearchResponse(BaseModel):
    query: str
    rewritten_query: str
    answer: str
    results: list[SearchResult] = Field(default_factory=list)
