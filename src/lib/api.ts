import type {
    ActivityResponse,
    DocumentCounts,
    DocumentListResponse,
    FinalizeMoveResponse,
    MoveExecutionResult,
    ProcessResponse,
    SearchResponse,
    UiDocument,
    UndoMoveResponse,
} from "../types/documents";
import { mapRegistryRecordToUiDocument } from "./document-mappers";
import { getBackendBaseUrl } from "./tauri-events";

let backendBaseUrlPromise: Promise<string> | null = null;

async function resolveBaseUrl(): Promise<string> {
  backendBaseUrlPromise ??= getBackendBaseUrl();
  return backendBaseUrlPromise;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = await resolveBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`${path}:${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchDocuments(limit = 50): Promise<DocumentListResponse> {
  const payload = await fetchJson<{
    documents: Array<Parameters<typeof mapRegistryRecordToUiDocument>[0]>;
    total: number;
  }>(`/documents?limit=${limit}`);
  return {
    documents: payload.documents.map((document) => mapRegistryRecordToUiDocument(document)) as UiDocument[],
    total: payload.total,
  };
}

export async function fetchCounts(): Promise<DocumentCounts> {
  return fetchJson<DocumentCounts>("/documents/counts");
}

export async function fetchActivity(limit = 10): Promise<ActivityResponse> {
  return fetchJson<ActivityResponse>(`/activity?limit=${limit}`);
}

export async function searchDocuments(query: string, limit = 8): Promise<SearchResponse> {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return fetchJson<SearchResponse>(`/search?${params.toString()}`);
}

export async function processFile(args: {
  file: File;
  sourcePath: string | null;
  clientId: string;
  requestId: string;
  executeMove?: boolean;
  moveExecutor?: "none" | "client" | "server";
}): Promise<ProcessResponse> {
  const formData = new FormData();
  formData.append("file", args.file);
  formData.append("execute_move", String(args.executeMove ?? false));
  formData.append("client_id", args.clientId);
  formData.append("client_request_id", args.requestId);
  formData.append("move_executor", args.moveExecutor ?? "client");
  if (args.sourcePath) {
    formData.append("source_path", args.sourcePath);
  }
  return fetchJson<ProcessResponse>("/process", {
    method: "POST",
    body: formData,
  });
}

export async function undoMove(undoToken: string, clientId: string): Promise<UndoMoveResponse> {
  return fetchJson<UndoMoveResponse>("/moves/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ undo_token: undoToken, client_id: clientId }),
  });
}

export async function finalizeClientMove(args: {
  recordId: string;
  requestId: string;
  clientId: string;
  result: MoveExecutionResult;
}): Promise<FinalizeMoveResponse> {
  return fetchJson<FinalizeMoveResponse>("/moves/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      record_id: args.recordId,
      request_id: args.requestId,
      client_id: args.clientId,
      from_path: args.result.from_path,
      to_path: args.result.to_path,
      success: args.result.success,
      error: args.result.error ?? null,
    }),
  });
}

export async function completeClientUndo(args: {
  undoToken: string;
  clientId: string;
  result: MoveExecutionResult;
}): Promise<UndoMoveResponse> {
  return fetchJson<UndoMoveResponse>("/moves/undo-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      undo_token: args.undoToken,
      client_id: args.clientId,
      from_path: args.result.from_path,
      to_path: args.result.to_path,
      success: args.result.success,
      error: args.result.error ?? null,
    }),
  });
}
