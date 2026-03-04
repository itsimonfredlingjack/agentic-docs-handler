import { inferSourceModality } from "./mime";
import type { ProcessResponse, SearchResult, SourceModality, UiDocument, UiDocumentKind } from "../types/documents";

function nowIso(): string {
  return new Date().toISOString();
}

const INTERNAL_PIPELINE_FLAG_REGEX = /^(classifier_|pdf_).*|.*_fallback$/i;

export function isInternalPipelineFlag(value: string): boolean {
  return INTERNAL_PIPELINE_FLAG_REGEX.test(value.trim());
}

function sanitizeWarnings(warnings: string[]): string[] {
  return warnings.filter((warning) => !isInternalPipelineFlag(warning));
}

function resolveUiKind(payload: ProcessResponse): UiDocumentKind {
  if (payload.ui_kind) {
    return payload.ui_kind;
  }
  if (payload.source_modality === "audio") {
    return "audio";
  }
  if (payload.classification.document_type === "invoice") {
    return "invoice";
  }
  if (payload.classification.document_type === "receipt") {
    return "receipt";
  }
  if (payload.classification.document_type === "contract") {
    return "contract";
  }
  if (payload.classification.document_type === "meeting_notes") {
    return "meeting_notes";
  }
  return "generic";
}

export function mapProcessResponseToUiDocument(payload: ProcessResponse): UiDocument {
  const createdAt = payload.created_at ?? nowIso();
  const sourceModality = payload.source_modality ?? inferSourceModality(payload.mime_type);
  return {
    id: payload.record_id ?? payload.request_id,
    requestId: payload.request_id,
    title: payload.classification.title,
    summary: payload.classification.summary,
    mimeType: payload.mime_type,
    sourceModality,
    kind: resolveUiKind(payload),
    documentType: payload.classification.document_type,
    template: payload.classification.template,
    sourcePath: payload.move_result.to_path ?? payload.move_result.from_path ?? null,
    createdAt,
    updatedAt: nowIso(),
    classification: payload.classification,
    extraction: payload.extraction,
    transcription: payload.transcription,
    movePlan: payload.move_plan,
    moveResult: payload.move_result,
    status:
      payload.move_status === "awaiting_confirmation"
        ? "awaiting_confirmation"
        : payload.status === "failed_runtime"
          ? "failed"
          : "ready",
    tags: payload.classification.tags,
    undoToken: payload.undo_token,
    retryable: payload.retryable,
    errorCode: payload.error_code,
    warnings: sanitizeWarnings(payload.warnings),
    moveStatus: payload.move_status,
    diagnostics: payload.diagnostics ?? null,
  };
}

export function mapRegistryRecordToUiDocument(payload: {
  id: string;
  request_id: string;
  title: string;
  summary: string;
  mime_type: string;
  source_modality: SourceModality;
  kind: UiDocumentKind;
  document_type: string;
  template: string;
  source_path: string | null;
  created_at: string;
  updated_at: string;
  classification: ProcessResponse["classification"];
  extraction: ProcessResponse["extraction"] | null;
  transcription: ProcessResponse["transcription"] | null;
  move_plan: ProcessResponse["move_plan"] | null;
  move_result: ProcessResponse["move_result"] | null;
  tags: string[];
  status: UiDocument["status"];
  undo_token: string | null;
  retryable?: boolean;
  error_code?: string | null;
  warnings?: string[];
  move_status?: UiDocument["moveStatus"];
  diagnostics?: UiDocument["diagnostics"];
}): UiDocument {
  return {
    id: payload.id,
    requestId: payload.request_id,
    title: payload.title,
    summary: payload.summary,
    mimeType: payload.mime_type,
    sourceModality: payload.source_modality,
    kind: payload.kind,
    documentType: payload.document_type,
    template: payload.template,
    sourcePath: payload.source_path,
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    classification: payload.classification,
    extraction: payload.extraction,
    transcription: payload.transcription,
    movePlan: payload.move_plan,
    moveResult: payload.move_result,
    tags: payload.tags,
    status: payload.status,
    undoToken: payload.undo_token,
    retryable: payload.retryable ?? false,
    errorCode: payload.error_code ?? null,
    warnings: sanitizeWarnings(payload.warnings ?? []),
    moveStatus: payload.move_status ?? "not_requested",
    diagnostics: payload.diagnostics ?? null,
  };
}

export function buildQueuedDocument(args: {
  file: File;
  requestId: string;
  sourcePath: string | null;
}): UiDocument {
  const modality = inferSourceModality(args.file.type || "text/plain");
  return {
    id: `local:${args.requestId}`,
    requestId: args.requestId,
    title: args.file.name,
    summary: "Bearbetar dokument...",
    mimeType: args.file.type || "application/octet-stream",
    sourceModality: modality,
    kind: modality === "audio" ? "audio" : "generic",
    documentType: "generic",
    template: "processing",
    sourcePath: args.sourcePath,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    classification: {
      document_type: "generic",
      template: "processing",
      title: args.file.name,
      summary: "Bearbetar dokument...",
      tags: [],
      language: "sv",
      confidence: 0,
      ocr_text: null,
      suggested_actions: [],
    },
    extraction: null,
    transcription: null,
    movePlan: null,
    moveResult: null,
    status: "uploading",
    tags: [],
    undoToken: null,
    retryable: false,
    errorCode: null,
    warnings: [],
    moveStatus: "not_requested",
    diagnostics: null,
  };
}

export function mapSearchResultToGenericDocument(result: SearchResult): UiDocument {
  const timestamp = nowIso();
  return {
    id: `search:${result.doc_id}`,
    requestId: `search:${result.doc_id}`,
    title: result.title,
    summary: result.snippet,
    mimeType: "text/plain",
    sourceModality: "text",
    kind: "generic",
    documentType: String(result.metadata.document_type ?? "generic"),
    template: "search_result",
    sourcePath: result.source_path,
    createdAt: timestamp,
    updatedAt: timestamp,
    classification: {
      document_type: "generic",
      template: "search_result",
      title: result.title,
      summary: result.snippet,
      tags: [],
      language: "sv",
      confidence: 1,
      ocr_text: null,
      suggested_actions: [],
    },
    extraction: null,
    transcription: null,
    movePlan: null,
    moveResult: null,
    status: "ready",
    tags: [],
    undoToken: null,
    retryable: false,
    errorCode: null,
    warnings: [],
    moveStatus: "not_requested",
    diagnostics: null,
  };
}
