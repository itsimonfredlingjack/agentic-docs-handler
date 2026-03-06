import { useEffect, useRef } from "react";

import { listenToBackendEvent } from "../lib/tauri-events";
import type { BackendServerEvent } from "../types/documents";
import { useDocumentStore } from "../store/documentStore";

function getTitle(event: BackendServerEvent): string | null {
  if (event.type === "job.completed") return "Document processed";
  if (event.type === "job.failed") return "Processing failed";
  if (event.type === "file.moved") return "File moved";
  return null;
}

function getBody(event: BackendServerEvent): string {
  if (event.type === "job.completed" || event.type === "job.failed") {
    // Try to find the document title from the store
    const state = useDocumentStore.getState();
    const doc = Object.values(state.documents).find((d) => d.requestId === event.request_id);
    if (doc) return doc.title;
    return event.request_id;
  }
  if (event.type === "file.moved") {
    return event.to_path.split("/").pop() ?? "File organized";
  }
  return "";
}

async function sendNotification(title: string, body: string): Promise<void> {
  // Use Web Notification API (works in Tauri webview and browser)
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      new Notification(title, { body });
    }
  }
}

export function useNotifications(): void {
  const unlistenRef = useRef<(() => void | Promise<void>) | undefined>(undefined);

  useEffect(() => {
    void listenToBackendEvent((event) => {
      // Only notify when app is not focused
      if (document.hasFocus()) return;

      const title = getTitle(event);
      if (!title) return;

      const body = getBody(event);
      void sendNotification(title, body);
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    return () => {
      void unlistenRef.current?.();
    };
  }, []);
}
