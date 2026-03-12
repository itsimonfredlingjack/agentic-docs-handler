import { useEffect, useRef, useState } from "react";

import { fetchActivity, fetchCounts, finalizeClientMove, processFile } from "../lib/api";
import { buildQueuedDocument, mapProcessResponseToUiDocument } from "../lib/document-mappers";
import { basename } from "../lib/mime";
import { cleanupStagedUploads, listenToWindowFileDrops, moveLocalFile, stageLocalUpload } from "../lib/tauri-events";
import { useDocumentStore } from "../store/documentStore";
import type { ProcessResponse } from "../types/documents";

export function DropZone() {
  const clientId = useDocumentStore((state) => state.clientId);
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
    <section className="space-y-4">
      <article className="glass-panel p-4">
        <div className="mb-3">
          <p className="section-kicker">Inmatning</p>
          <h2 className="mt-1 section-heading">Lägg till dokument</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
            Dra in filer eller välj manuellt. Systemet klassificerar, extraherar och föreslår sortering.
          </p>
        </div>
        <div
          className={`control-card rounded-[16px] border border-dashed px-4 py-8 text-center transition-all duration-300 ease-out ${
            isHovered
              ? "border-[var(--accent-primary)] bg-[var(--accent-surface)] scale-[1.02] shadow-xl"
              : "border-[rgba(17,31,58,0.2)]"
          }`}
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
          <p className="text-2xl text-[var(--accent-primary)]">↑</p>
          <h3 className="mt-3 text-base font-semibold text-[var(--text-primary)]">Släpp filer här</h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Stöd för PDF, DOCX, bilder och ljud.</p>
          <p className="mt-3 font-mono text-[11px] text-[var(--text-muted)]">.pdf · .docx · .jpg · .png · .wav · .mp3</p>
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              className="focus-ring action-primary px-4 py-2 text-sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Välj filer
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
      </article>
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

