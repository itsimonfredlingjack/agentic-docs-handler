import { useEffect, useRef } from "react";

import { fetchActivity, fetchCounts, fetchDocuments } from "../lib/api";
import { listenToBackendConnection, listenToBackendEvent } from "../lib/tauri-events";
import { useDocumentStore } from "../store/documentStore";
import { useToastStore } from "../store/toastStore";
import type { BackendServerEvent, FileMoveToastItem, UndoMoveResponse } from "../types/documents";

const debugWebSocket = import.meta.env.DEV;

export function useWebSocket(): void {
  const previousConnection = useRef<string>("connecting");
  const setConnectionState = useDocumentStore((state) => state.setConnectionState);
  const updateConnectionFromPayload = useDocumentStore((state) => state.updateConnectionFromPayload);
  const markJobStage = useDocumentStore((state) => state.markJobStage);
  const markJobFailed = useDocumentStore((state) => state.markJobFailed);
  const pushMoveToast = useDocumentStore((state) => state.pushMoveToast);
  const applyUndoSuccess = useDocumentStore((state) => state.applyUndoSuccess);
  const applyMoveDismissed = useDocumentStore((state) => state.applyMoveDismissed);
  const resyncFromBackend = useDocumentStore((state) => state.resyncFromBackend);
  const setDocumentThumbnail = useDocumentStore((state) => state.setDocumentThumbnail);
  const showToast = useToastStore((s) => s.show);

  useEffect(() => {
    let unlistenConnection: (() => void | Promise<void>) | undefined;
    let unlistenEvents: (() => void | Promise<void>) | undefined;

    void listenToBackendConnection((payload) => {
      if (debugWebSocket) {
        console.debug("backend:connection", payload);
      }
      const wasReconnecting = previousConnection.current === "reconnecting";
      previousConnection.current = payload.state;
      updateConnectionFromPayload(payload);
      setConnectionState(payload.state);
      if (wasReconnecting && payload.state === "connected") {
        void Promise.all([fetchDocuments(50), fetchCounts(), fetchActivity(10)])
          .then(([documentsPayload, counts, activity]) => {
            resyncFromBackend(documentsPayload.documents, counts, activity.events);
          })
          .catch((error) => {
            console.error("ws.resync.failed", error);
          });
      }
    }).then((unlisten) => {
      unlistenConnection = unlisten;
    });

    void listenToBackendEvent((payload) => {
      if (debugWebSocket) {
        console.debug("backend:event", payload);
      }
      handleServerEvent(payload, {
        markJobStage,
        markJobFailed,
        pushMoveToast,
        applyUndoSuccess,
        applyMoveDismissed,
        setDocumentThumbnail,
        showToast,
      });
    }).then((unlisten) => {
      unlistenEvents = unlisten;
    });

    return () => {
      void unlistenConnection?.();
      void unlistenEvents?.();
    };
  }, [applyMoveDismissed, applyUndoSuccess, markJobFailed, markJobStage, pushMoveToast, resyncFromBackend, setConnectionState, setDocumentThumbnail, showToast, updateConnectionFromPayload]);
}

function handleServerEvent(
  payload: BackendServerEvent,
  handlers: {
    markJobStage: (requestId: string, stage: "uploading" | "processing" | "transcribing" | "classified" | "classifying" | "extracting" | "extracted" | "organizing" | "indexing" | "awaiting_confirmation" | "moved" | "completed" | "failed" | "ready" | "queued", data?: { classification?: import("../types/documents").DocumentClassification; extraction?: import("../types/documents").ExtractionResult }) => void;
    markJobFailed: (requestId: string, error: string, errorCode?: string | null) => void;
    pushMoveToast: (toast: FileMoveToastItem) => void;
    applyUndoSuccess: (payload: UndoMoveResponse) => void;
    applyMoveDismissed: (payload: { success: true; record_id: string; request_id: string; move_status: "not_requested" }) => void;
    setDocumentThumbnail: (requestId: string, thumbnailData: string) => void;
    showToast: (message: string, type?: "success" | "info" | "error", opts?: { duration?: number; action?: { label: string; onClick: () => void } }) => void;
  },
): void {
  if (payload.type === "job.started") {
    // job.started carries no stage data; only conditionally sets thumbnail.
    if (payload.thumbnail_data) {
      handlers.setDocumentThumbnail(payload.request_id, payload.thumbnail_data);
    }
    return;
  }
  if (payload.type === "job.progress") {
    if (debugWebSocket) {
      console.debug("backend:event:markJobStage", payload.request_id, payload.stage);
    }
    handlers.markJobStage(payload.request_id, payload.stage, payload.data);
    return;
  }
  if (payload.type === "job.completed") {
    if (debugWebSocket) {
      console.debug("backend:event:completed", payload.request_id);
    }
    handlers.markJobStage(payload.request_id, "completed");
    handlers.showToast("Dokument bearbetat", "success");
    return;
  }
  if (payload.type === "job.failed") {
    if (debugWebSocket) {
      console.debug("backend:event:failed", payload.request_id, payload.message);
    }
    handlers.markJobFailed(payload.request_id, payload.message);
    handlers.showToast("Bearbetning misslyckades", "error");
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
      record_id: null,
    });
    return;
  }
  if (payload.type === "move.dismissed") {
    handlers.applyMoveDismissed({
      success: true,
      record_id: payload.record_id,
      request_id: payload.request_id,
      move_status: "not_requested",
    });
  }
}
