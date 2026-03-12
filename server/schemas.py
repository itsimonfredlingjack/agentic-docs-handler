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
SourceModality = Literal["text", "image", "audio"]
FileActionType = Literal["none", "auto_moved", "needs_confirmation", "failed"]
MoveExecutor = Literal["none", "client", "server"]
MoveStatus = Literal[
    "not_requested",
    "planned",
    "awaiting_confirmation",
    "auto_pending_client",
    "moved",
    "move_failed",
    "undone",
]
UiDocumentKind = Literal[
    "receipt",
    "contract",
    "invoice",
    "meeting_notes",
    "audio",
    "generic",
    "file_moved",
]
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


class ProcessDiagnostics(BaseModel):
    pipeline_flags: list[str] = Field(default_factory=list)
    classifier_raw_response_path: str | None = None
    fallback_reason: str | None = None


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
    record_id: str | None = None
    source_modality: SourceModality | None = None
    created_at: str | None = None
    transcription: TranscriptionResponse | None = None
    ui_kind: UiDocumentKind | None = None
    undo_token: str | None = None
    move_status: MoveStatus = "not_requested"
    retryable: bool = False
    error_code: str | None = None
    warnings: list[str] = Field(default_factory=list)
    diagnostics: ProcessDiagnostics | None = None
    thumbnail_data: str | None = None


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


class TranscriptionWord(BaseModel):
    start: float
    end: float
    word: str
    probability: float | None = None


class TranscriptionSegment(BaseModel):
    start: float
    end: float
    text: str
    avg_logprob: float | None = None
    no_speech_prob: float | None = None
    words: list[TranscriptionWord] = Field(default_factory=list)


class TranscriptionResponse(BaseModel):
    text: str
    language: str
    language_probability: float | None = None
    duration: float | None = None
    duration_after_vad: float | None = None
    model: str
    source: str = "whisper_server"
    segments: list[TranscriptionSegment] = Field(default_factory=list)


class UiDocumentRecord(BaseModel):
    id: str
    request_id: str
    title: str
    summary: str
    mime_type: str
    source_modality: SourceModality
    kind: UiDocumentKind
    document_type: str
    template: str
    source_path: str | None = None
    created_at: str
    updated_at: str
    classification: DocumentClassification
    extraction: ExtractionResult | None = None
    transcription: TranscriptionResponse | None = None
    move_plan: MovePlan | None = None
    move_result: MoveResult | None = None
    tags: list[str] = Field(default_factory=list)
    status: str = "ready"
    undo_token: str | None = None
    move_status: MoveStatus = "not_requested"
    retryable: bool = False
    error_code: str | None = None
    warnings: list[str] = Field(default_factory=list)
    diagnostics: ProcessDiagnostics | None = None
    thumbnail_data: str | None = None


class DocumentListResponse(BaseModel):
    documents: list[UiDocumentRecord] = Field(default_factory=list)
    total: int = 0


class DocumentCountsResponse(BaseModel):
    all: int = 0
    processing: int = 0
    receipt: int = 0
    contract: int = 0
    invoice: int = 0
    meeting_notes: int = 0
    audio: int = 0
    generic: int = 0
    moved: int = 0


class ActivityEvent(BaseModel):
    id: str
    type: str
    timestamp: str
    title: str
    status: str
    kind: str
    request_id: str | None = None
    debug: dict[str, Any] | None = None


class ActivityResponse(BaseModel):
    events: list[ActivityEvent] = Field(default_factory=list)


class UndoMoveRequest(BaseModel):
    undo_token: str
    client_id: str | None = None


class UndoMoveResponse(BaseModel):
    success: bool
    from_path: str
    to_path: str
    request_id: str
    record_id: str | None = None


class FinalizeMoveRequest(BaseModel):
    record_id: str
    request_id: str
    client_id: str | None = None
    from_path: str
    to_path: str
    success: bool
    error: str | None = None


class FinalizeMoveResponse(BaseModel):
    success: bool
    record_id: str
    request_id: str
    from_path: str
    to_path: str
    undo_token: str | None = None
    move_status: MoveStatus


class DismissMoveRequest(BaseModel):
    record_id: str
    request_id: str
    client_id: str | None = None


class DismissMoveResponse(BaseModel):
    success: bool
    record_id: str
    request_id: str
    move_status: MoveStatus


class CompleteUndoMoveRequest(BaseModel):
    undo_token: str
    client_id: str | None = None
    from_path: str
    to_path: str
    success: bool
    error: str | None = None
