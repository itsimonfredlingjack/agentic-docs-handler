import { useEffect } from "react";

import { listenToBackendConnection, listenToBackendEvent } from "../lib/tauri-events";
import { useDocumentStore } from "../store/documentStore";
import type { BackendServerEvent, FileMoveToastItem, UndoMoveResponse } from "../types/documents";

export function useWebSocket(): void {
  const setConnectionState = useDocumentStore((state) => state.setConnectionState);
  const updateConnectionFromPayload = useDocumentStore((state) => state.updateConnectionFromPayload);
  const markJobStage = useDocumentStore((state) => state.markJobStage);
  const markJobFailed = useDocumentStore((state) => state.markJobFailed);
  const pushMoveToast = useDocumentStore((state) => state.pushMoveToast);
  const applyUndoSuccess = useDocumentStore((state) => state.applyUndoSuccess);

  useEffect(() => {
    let unlistenConnection: (() => void | Promise<void>) | undefined;
    let unlistenEvents: (() => void | Promise<void>) | undefined;

    void listenToBackendConnection((payload) => {
      updateConnectionFromPayload(payload);
      setConnectionState(payload.state);
    }).then((unlisten) => {
      unlistenConnection = unlisten;
    });

    void listenToBackendEvent((payload) => {
      handleServerEvent(payload, {
        markJobStage,
        markJobFailed,
        pushMoveToast,
        applyUndoSuccess,
      });
    }).then((unlisten) => {
      unlistenEvents = unlisten;
    });

    return () => {
      void unlistenConnection?.();
      void unlistenEvents?.();
    };
  }, [applyUndoSuccess, markJobFailed, markJobStage, pushMoveToast, setConnectionState, updateConnectionFromPayload]);
}

function handleServerEvent(
  payload: BackendServerEvent,
  handlers: {
    markJobStage: (requestId: string, stage: "uploading" | "transcribing" | "classifying" | "extracting" | "organizing" | "indexing" | "completed" | "failed" | "ready" | "queued") => void;
    markJobFailed: (requestId: string, error: string) => void;
    pushMoveToast: (toast: FileMoveToastItem) => void;
    applyUndoSuccess: (payload: UndoMoveResponse) => void;
  },
): void {
  if (payload.type === "job.progress") {
    handlers.markJobStage(payload.request_id, payload.stage);
    return;
  }
  if (payload.type === "job.completed") {
    handlers.markJobStage(payload.request_id, "completed");
    return;
  }
  if (payload.type === "job.failed") {
    handlers.markJobFailed(payload.request_id, payload.message);
    return;
  }
  if (payload.type === "file.moved") {
    handlers.pushMoveToast({
      id: `${payload.request_id}:${payload.undo_token}`,
      requestId: payload.request_id,
      fromPath: payload.from_path,
      toPath: payload.to_path,
      undoToken: payload.undo_token,
      createdAt: new Date().toISOString(),
    });
    return;
  }
  if (payload.type === "file.move_undone") {
    handlers.applyUndoSuccess({
      success: true,
      from_path: payload.from_path,
      to_path: payload.to_path,
      request_id: payload.request_id,
    });
  }
}
