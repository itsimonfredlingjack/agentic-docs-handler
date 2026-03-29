import type {
    ActivityResponse,
    DismissMoveResponse,
    DocumentCounts,
    DocumentListResponse,
    FinalizeMoveResponse,
    EngagementEventResponse,
    MoveExecutionResult,
    ProcessResponse,
    SearchResponse,
    SearchShareBriefResponse,
    ShareBriefSource,
    UiDocument,
    UndoMoveResponse,
    WorkspaceDiscoveryResponse,
    WorkspaceChatEvent,
} from "../types/documents";
import type { WorkspaceListResponse, WorkspaceResponse } from "../types/workspace";
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

export async function fetchDocument(recordId: string): Promise<UiDocument> {
  const payload = await fetchJson<Parameters<typeof mapRegistryRecordToUiDocument>[0]>(`/documents/${recordId}`);
  return mapRegistryRecordToUiDocument(payload) as UiDocument;
}

export async function fetchCounts(): Promise<DocumentCounts> {
  return fetchJson<DocumentCounts>("/documents/counts");
}

export async function fetchActivity(limit = 10): Promise<ActivityResponse> {
  return fetchJson<ActivityResponse>(`/activity?limit=${limit}`);
}

export async function searchDocuments(
  query: string,
  limit = 8,
  mode: "fast" | "full" = "fast",
  workspaceId?: string | null,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ query, limit: String(limit), mode });
  if (workspaceId) {
    params.set("workspace_id", workspaceId);
  }
  return fetchJson<SearchResponse>(`/search?${params.toString()}`);
}

export async function createSearchShareBrief(args: {
  query: string;
  rewrittenQuery: string;
  answer: string;
  sources: ShareBriefSource[];
}): Promise<SearchShareBriefResponse> {
  return fetchJson<SearchShareBriefResponse>("/search/share-brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: args.query,
      rewritten_query: args.rewrittenQuery,
      answer: args.answer,
      sources: args.sources,
    }),
  });
}

export async function trackEngagementEvent(args: {
  name: string;
  surface: string;
  metadata?: Record<string, unknown>;
}): Promise<EngagementEventResponse> {
  return fetchJson<EngagementEventResponse>("/engagement/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: args.name,
      surface: args.surface,
      metadata: args.metadata ?? {},
    }),
  });
}

export async function processFile(args: {
  file: File;
  sourcePath: string | null;
  clientId: string;
  requestId: string;
  executeMove?: boolean;
  moveExecutor?: "none" | "client";
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

export async function dismissPendingMove(recordId: string, requestId: string, clientId: string): Promise<DismissMoveResponse> {
  return fetchJson<DismissMoveResponse>("/moves/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      record_id: recordId,
      request_id: requestId,
      client_id: clientId,
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

export async function fetchWorkspaces(): Promise<WorkspaceListResponse> {
  return fetchJson<WorkspaceListResponse>("/workspaces");
}

export async function createWorkspace(
  name: string,
  description?: string,
  cover_color?: string,
): Promise<WorkspaceResponse> {
  return fetchJson<WorkspaceResponse>("/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, cover_color }),
  });
}

export async function updateWorkspace(
  id: string,
  fields: Partial<Pick<WorkspaceResponse, "name" | "description" | "cover_color">>,
): Promise<WorkspaceResponse> {
  return fetchJson<WorkspaceResponse>(`/workspaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
}

export async function deleteWorkspace(id: string): Promise<void> {
  const baseUrl = await resolveBaseUrl();
  const response = await fetch(`${baseUrl}/workspaces/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`/workspaces/${id}:${response.status}`);
  }
}

export async function fetchWorkspaceFiles(
  workspaceId: string,
  limit = 50,
  offset = 0,
): Promise<DocumentListResponse> {
  const payload = await fetchJson<{
    documents: Array<Parameters<typeof mapRegistryRecordToUiDocument>[0]>;
    total: number;
  }>(`/workspaces/${workspaceId}/files?limit=${limit}&offset=${offset}`);
  return {
    documents: payload.documents.map((document) => mapRegistryRecordToUiDocument(document)) as UiDocument[],
    total: payload.total,
  };
}

export async function fetchWorkspaceDiscovery(
  workspaceId: string,
): Promise<WorkspaceDiscoveryResponse> {
  return fetchJson<WorkspaceDiscoveryResponse>(`/workspaces/${workspaceId}/discovery`);
}

export async function dismissWorkspaceDiscovery(
  workspaceId: string,
  relationId: string,
): Promise<{ success: boolean }> {
  return fetchJson<{ success: boolean }>(`/workspaces/${workspaceId}/discovery/${relationId}/dismiss`, {
    method: "POST",
  });
}

export async function moveFilesToWorkspace(
  workspaceId: string,
  fileIds: string[],
): Promise<{ moved: number }> {
  return fetchJson<{ moved: number }>(`/workspaces/${workspaceId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_ids: fileIds }),
  });
}

export async function* streamWorkspaceChat(
  category: string | undefined,
  message: string,
  history: Array<{ role: string; content: string }>,
  options?: { signal?: AbortSignal; document_id?: string; workspace_id?: string },
): AsyncGenerator<WorkspaceChatEvent> {
  const baseUrl = await resolveBaseUrl();
  const body: Record<string, unknown> = { message, history };
  if (category) body.category = category;
  if (options?.document_id) body.document_id = options.document_id;
  if (options?.workspace_id) body.workspace_id = options.workspace_id;
  const response = await fetch(`${baseUrl}/workspace/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`workspace/chat: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("workspace/chat: empty response body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop()!;

    for (const part of parts) {
      let eventType = "";
      let dataStr = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7);
        else if (line.startsWith("data: ")) dataStr = line.slice(6);
      }
      if (eventType && dataStr) {
        yield { type: eventType, data: JSON.parse(dataStr) } as WorkspaceChatEvent;
      } else if (part.trim()) {
        console.warn("[workspace-chat] dropped malformed SSE event", part);
      }
    }
  }
}
