import type {
  BackendConnectionPayload,
  BackendServerEvent,
  CleanupResult,
  MoveExecutionResult,
  StageUploadResult,
} from "../types/documents";

type Unlisten = () => void | Promise<void>;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

type DragDropPayload =
  | { type: "enter" | "over"; paths?: string[] }
  | { type: "leave"; paths?: string[] }
  | { type: "drop"; paths: string[] };

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ !== "undefined";
}

export async function getClientId(): Promise<string> {
  if (!isTauriRuntime()) {
    return "browser-client";
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("get_client_id");
}

export async function getBackendBaseUrl(): Promise<string> {
  if (!isTauriRuntime()) {
    return import.meta.env.VITE_BACKEND_URL ?? "http://ai-server:9000";
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("get_backend_base_url");
}

export async function requestReconnect(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reconnect_backend_ws");
}

export async function moveLocalFile(sourcePath: string, destinationDir: string): Promise<MoveExecutionResult> {
  if (!isTauriRuntime()) {
    return {
      success: false,
      from_path: sourcePath,
      to_path: destinationDir,
      error: "tauri_runtime_required",
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<MoveExecutionResult>("move_local_file", {
    sourcePath,
    destinationDir,
  });
}

export async function undoLocalFileMove(fromPath: string, toPath: string): Promise<MoveExecutionResult> {
  if (!isTauriRuntime()) {
    return {
      success: false,
      from_path: fromPath,
      to_path: toPath,
      error: "tauri_runtime_required",
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<MoveExecutionResult>("undo_local_file_move", {
    fromPath,
    toPath,
  });
}

export async function stageLocalUpload(file: File): Promise<StageUploadResult> {
  if (!isTauriRuntime()) {
    return {
      success: false,
      source_path: null,
      error: "tauri_runtime_required",
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<StageUploadResult>("stage_local_upload", {
    fileName: file.name,
    bytes: Array.from(bytes),
  });
}

export async function cleanupStagedUploads(maxAgeHours = 24): Promise<CleanupResult> {
  if (!isTauriRuntime()) {
    return {
      success: true,
      removed: 0,
      error: null,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CleanupResult>("cleanup_staged_uploads", {
    maxAgeHours,
  });
}

export async function listenToBackendConnection(
  handler: (payload: BackendConnectionPayload) => void,
): Promise<Unlisten> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<BackendConnectionPayload>("backend:connection", (event) => handler(event.payload));
}

export async function listenToBackendEvent(
  handler: (payload: BackendServerEvent) => void,
): Promise<Unlisten> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<BackendServerEvent>("backend:event", (event) => handler(event.payload));
}

export async function listenToWindowFileDrops(
  handler: (payload: DragDropPayload) => void,
): Promise<Unlisten> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow().onDragDropEvent((event: { payload: DragDropPayload }) => {
    handler(event.payload);
  });
}
