export type DocumentType =
  | "receipt"
  | "contract"
  | "invoice"
  | "meeting_notes"
  | "generic"
  | "unsupported";

export type SourceModality = "text" | "image" | "audio";

export type UiDocumentKind =
  | "receipt"
  | "contract"
  | "invoice"
  | "meeting_notes"
  | "audio"
  | "generic"
  | "file_moved";

export type JobStage =
  | "queued"
  | "uploading"
  | "transcribing"
  | "classifying"
  | "extracting"
  | "organizing"
  | "indexing"
  | "completed"
  | "failed";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export type SidebarFilter =
  | "all"
  | "processing"
  | "receipt"
  | "contract"
  | "invoice"
  | "meeting_notes"
  | "audio"
  | "generic"
  | "moved";

export type DocumentClassification = {
  document_type: DocumentType;
  template: string;
  title: string;
  summary: string;
  tags: string[];
  language: string;
  confidence: number;
  ocr_text: string | null;
  suggested_actions: string[];
};

export type ExtractionResult = {
  fields: Record<string, unknown>;
  field_confidence: Record<string, number>;
  missing_fields: string[];
};

export type MovePlan = {
  rule_name: string | null;
  destination: string | null;
  auto_move_allowed: boolean;
  reason: string;
};

export type MoveResult = {
  attempted: boolean;
  success: boolean;
  from_path: string | null;
  to_path: string | null;
  error: string | null;
};

export type TranscriptionWord = {
  start: number;
  end: number;
  word: string;
  probability?: number | null;
};

export type TranscriptionSegment = {
  start: number;
  end: number;
  text: string;
  avg_logprob?: number | null;
  no_speech_prob?: number | null;
  words: TranscriptionWord[];
};

export type TranscriptionResponse = {
  text: string;
  language: string;
  language_probability?: number | null;
  duration?: number | null;
  duration_after_vad?: number | null;
  model: string;
  source: string;
  segments: TranscriptionSegment[];
};

export type ProcessResponse = {
  request_id: string;
  status: string;
  mime_type: string;
  classification: DocumentClassification;
  extraction: ExtractionResult;
  move_plan: MovePlan;
  move_result: MoveResult;
  timings: Record<string, number>;
  errors: string[];
  record_id: string | null;
  source_modality: SourceModality | null;
  created_at: string | null;
  transcription: TranscriptionResponse | null;
  ui_kind: UiDocumentKind | null;
  undo_token: string | null;
};

export type UiDocument = {
  id: string;
  requestId: string;
  title: string;
  summary: string;
  mimeType: string;
  sourceModality: SourceModality;
  kind: UiDocumentKind;
  documentType: string;
  template: string;
  sourcePath: string | null;
  createdAt: string;
  updatedAt: string;
  classification: DocumentClassification;
  extraction: ExtractionResult | null;
  transcription: TranscriptionResponse | null;
  movePlan: MovePlan | null;
  moveResult: MoveResult | null;
  status: JobStage | "ready";
  tags: string[];
  undoToken: string | null;
};

export type DocumentListResponse = {
  documents: UiDocument[];
  total: number;
};

export type DocumentCounts = {
  all: number;
  processing: number;
  receipt: number;
  contract: number;
  invoice: number;
  meeting_notes: number;
  audio: number;
  generic: number;
  moved: number;
};

export type ActivityEvent = {
  id: string;
  type: string;
  timestamp: string;
  title: string;
  status: string;
  kind: string;
  request_id?: string | null;
};

export type ActivityResponse = {
  events: ActivityEvent[];
};

export type SearchResult = {
  doc_id: string;
  title: string;
  source_path: string;
  snippet: string;
  score: number;
  vector_score: number;
  keyword_score: number;
  metadata: Record<string, unknown>;
};

export type SearchResponse = {
  query: string;
  rewritten_query: string;
  answer: string;
  results: SearchResult[];
};

export type UndoMoveResponse = {
  success: boolean;
  from_path: string;
  to_path: string;
  request_id: string;
};

export type BackendConnectionPayload = {
  state: ConnectionState;
  clientId?: string;
  url?: string;
  error?: string;
};

export type BackendServerEvent =
  | {
      type: "connection.ready";
      client_id: string;
      server_phase: number;
    }
  | {
      type: "job.started";
      request_id: string;
      client_id?: string | null;
      job_kind: string;
      filename: string;
      source_modality: SourceModality;
    }
  | {
      type: "job.progress";
      request_id: string;
      client_id?: string | null;
      stage: JobStage;
      message: string;
    }
  | {
      type: "job.completed";
      request_id: string;
      client_id?: string | null;
      record_id: string;
      ui_kind: UiDocumentKind;
    }
  | {
      type: "job.failed";
      request_id: string;
      client_id?: string | null;
      message: string;
    }
  | {
      type: "file.moved";
      request_id: string;
      client_id?: string | null;
      record_id: string;
      from_path: string;
      to_path: string;
      undo_token: string;
    }
  | {
      type: "file.move_undone";
      request_id: string;
      client_id?: string | null;
      from_path: string;
      to_path: string;
    }
  | {
      type: "heartbeat";
      ts: string;
    };

export type FileMoveToastItem = {
  id: string;
  requestId: string;
  fromPath: string;
  toPath: string;
  undoToken: string;
  createdAt: string;
};

export type SearchState = {
  query: string;
  rewrittenQuery: string;
  answer: string;
  loading: boolean;
  active: boolean;
  resultIds: string[];
  orphanResults: SearchResult[];
};
