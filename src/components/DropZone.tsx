import { useEffect, useRef, useState } from "react";

import { fetchActivity, fetchCounts, finalizeClientMove, processFile } from "../lib/api";
import { buildQueuedDocument, mapProcessResponseToUiDocument } from "../lib/document-mappers";
import { basename } from "../lib/mime";
import { cleanupStagedUploads, listenToWindowFileDrops, moveLocalFile, stageLocalUpload } from "../lib/tauri-events";
import { useDocumentStore } from "../store/documentStore";
import type { ActivityEvent, ProcessResponse } from "../types/documents";

export function DropZone() {
  const clientId = useDocumentStore((state) => state.clientId);
  const activity = useDocumentStore((state) => state.activity);
  const queueUploads = useDocumentStore((state) => state.queueUploads);
  const rememberUpload = useDocumentStore((state) => state.rememberUpload);
  const clearRememberedUpload = useDocumentStore((state) => state.clearRememberedUpload);
  const upsertDocument = useDocumentStore((state) => state.upsertDocument);
  const markJobFailed = useDocumentStore((state) => state.markJobFailed);
  const applyMoveFinalized = useDocumentStore((state) => state.applyMoveFinalized);
  const bootstrap = useDocumentStore((state) => state.bootstrap);
  const [isHovered, setHovered] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTauriPathsRef = useRef<string[]>([]);

  useEffect(() => {
    let unlisten: (() => void | Promise<void>) | undefined;
    void listenToWindowFileDrops((payload) => {
      if (payload.type === "over" || payload.type === "enter") {
        setHovered(true);
        return;
      }
      if (payload.type === "leave") {
        setHovered(false);
        return;
      }
      if (payload.type === "drop") {
        lastTauriPathsRef.current = payload.paths;
        setHovered(false);
      }
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => {
      void unlisten?.();
    };
  }, []);

  useEffect(() => {
    void cleanupStagedUploads(24).catch((error) => {
      console.error("dropzone.cleanup_staged_uploads.failed", error);
    });
  }, []);

  const submitFiles = async (files: File[]) => {
    if (!clientId || files.length === 0) {
      return;
    }
    const jobs = await Promise.all(files.map(async (file, index) => {
      const requestId = crypto.randomUUID();
      let sourcePath = resolveSourcePath(file, index, lastTauriPathsRef.current);
      let stagingError: string | null = null;
      if (!sourcePath) {
        const stagedUpload = await stageLocalUpload(file);
        if (stagedUpload.success && stagedUpload.source_path) {
          sourcePath = stagedUpload.source_path;
        } else {
          stagingError = stagedUpload.error ?? "staging_failed";
        }
      }
      return {
        file,
        requestId,
        sourcePath,
        stagingError,
      };
    }));
    lastTauriPathsRef.current = [];
    queueUploads(jobs.map((job) => buildQueuedDocument(job)));
    jobs.forEach((job) => {
      if (!job.stagingError) {
        rememberUpload(job.requestId, { file: job.file, sourcePath: job.sourcePath });
      }
    });

    await Promise.allSettled(
      jobs.map(async (job) => {
        if (job.stagingError) {
          markJobFailed(job.requestId, job.stagingError, "staging_failed");
          return;
        }
        try {
          const response = await processFile({
            file: job.file,
            sourcePath: job.sourcePath,
            clientId,
            requestId: job.requestId,
            executeMove: Boolean(job.sourcePath),
            moveExecutor: "client",
          });
          await reconcileProcessResponse(response, clientId, upsertDocument, applyMoveFinalized);
          if (response.move_status !== "awaiting_confirmation") {
            clearRememberedUpload(job.requestId);
          }
        } catch (error) {
          markJobFailed(
            job.requestId,
            error instanceof Error ? error.message : "upload_failed",
            "upload_failed",
          );
        }
      }),
    );

    try {
      const [nextActivity, nextCounts] = await Promise.all([fetchActivity(10), fetchCounts()]);
      bootstrap(Object.values(useDocumentStore.getState().documents), nextCounts, nextActivity.events);
    } catch (error) {
      console.error("dropzone.refresh.failed", error);
    }
  };

  return (
    <section className="glass-panel flex flex-col gap-5 p-5">
      <div
        className={`rounded-[24px] border border-dashed px-6 py-7 text-center transition-all duration-200 ease-out ${isHovered ? "border-[var(--accent-primary)] bg-white/55 shadow-glass-hover" : "border-white/60 bg-white/35"}`}
        onDragOver={(event) => {
          event.preventDefault();
          setHovered(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setHovered(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setHovered(false);
          void submitFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <p className="text-3xl text-[var(--accent-primary)]">↑</p>
        <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">Drop files here</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">PDF, DOCX, images and audio are supported.</p>
        <p className="mt-4 font-mono text-xs text-[var(--text-muted)]">.pdf · .docx · .jpg · .png · .wav · .mp3</p>
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            className="focus-ring rounded-2xl bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            onClick={() => fileInputRef.current?.click()}
          >
            Browse files
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          onChange={(event) => {
            const fileList = event.target.files ? Array.from(event.target.files) : [];
            void submitFiles(fileList);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/30 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Recent activity</p>
          <p className="font-mono text-[11px] text-[var(--text-muted)]">{activity.length}</p>
        </div>
        <div className="mt-3 space-y-2.5">
          {activity.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">New file events will appear here once processing starts.</p>
          ) : (
            activity.slice(0, 5).map((event) => <ActivityRow key={event.id} event={event} />)
          )}
        </div>
      </div>
    </section>
  );
}

async function reconcileProcessResponse(
  response: ProcessResponse,
  clientId: string,
  upsertDocument: (document: ReturnType<typeof mapProcessResponseToUiDocument>) => void,
  applyMoveFinalized: (payload: { success: boolean; record_id: string; request_id: string; from_path: string; to_path: string; undo_token: string | null; move_status: "not_requested" | "planned" | "awaiting_confirmation" | "auto_pending_client" | "moved" | "move_failed" | "undone"; }) => void,
): Promise<void> {
  const document = mapProcessResponseToUiDocument(response);
  upsertDocument(document);
  if (
    response.move_status === "auto_pending_client" &&
    response.move_plan.destination &&
    document.sourcePath &&
    response.record_id
  ) {
    const moveResult = await moveLocalFile(document.sourcePath, response.move_plan.destination);
    const finalized = await finalizeClientMove({
      recordId: response.record_id,
      requestId: response.request_id,
      clientId,
      result: moveResult,
    });
    applyMoveFinalized(finalized);
  }
}

function resolveSourcePath(file: File, index: number, tauriPaths: string[]): string | null {
  const fileWithPath = file as File & { path?: string };
  if (typeof fileWithPath.path === "string" && fileWithPath.path.length > 0) {
    return fileWithPath.path;
  }
  const exactName = tauriPaths.find((path) => basename(path) === file.name);
  return exactName ?? tauriPaths[index] ?? null;
}

function dotColor(type: string): string {
  if (type.includes("classified") || type.includes("completed")) return "var(--receipt-color)";
  if (type.includes("transcrib")) return "var(--audio-color)";
  if (type.includes("moved")) return "var(--contract-color)";
  if (type.includes("failed") || type.includes("error")) return "var(--invoice-color)";
  return "var(--accent-primary)";
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-black/5 bg-white/45 px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="status-dot mt-1 shrink-0"
          style={{ backgroundColor: dotColor(event.type), width: 7, height: 7 }}
        />
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--text-primary)] line-clamp-1">{event.title}</p>
          <p className="text-[11px] text-[var(--text-muted)] line-clamp-1">{event.type}</p>
        </div>
      </div>
      <p className="font-mono text-[10px] text-[var(--text-muted)]">{time}</p>
    </div>
  );
}
