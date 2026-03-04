import { useEffect, useRef, useState } from "react";

import { fetchActivity, fetchCounts, processFile } from "../lib/api";
import { buildQueuedDocument, mapProcessResponseToUiDocument } from "../lib/document-mappers";
import { basename, inferSourceModality } from "../lib/mime";
import { listenToWindowFileDrops } from "../lib/tauri-events";
import { useDocumentStore } from "../store/documentStore";
import type { ActivityEvent } from "../types/documents";

export function DropZone() {
  const clientId = useDocumentStore((state) => state.clientId);
  const activity = useDocumentStore((state) => state.activity);
  const queueUploads = useDocumentStore((state) => state.queueUploads);
  const upsertDocument = useDocumentStore((state) => state.upsertDocument);
  const markJobFailed = useDocumentStore((state) => state.markJobFailed);
  const bootstrap = useDocumentStore((state) => state.bootstrap);
  const counts = useDocumentStore((state) => state.counts);
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

  const submitFiles = async (files: File[]) => {
    if (!clientId || files.length === 0) {
      return;
    }
    const jobs = files.map((file, index) => {
      const requestId = crypto.randomUUID();
      return {
        file,
        requestId,
        sourcePath: resolveSourcePath(file, index, lastTauriPathsRef.current),
      };
    });
    lastTauriPathsRef.current = [];
    queueUploads(jobs.map((job) => buildQueuedDocument(job)));

    await Promise.allSettled(
      jobs.map(async (job) => {
        try {
          const response = await processFile({
            file: job.file,
            sourcePath: job.sourcePath,
            clientId,
            requestId: job.requestId,
            executeMove: Boolean(job.sourcePath),
          });
          upsertDocument(mapProcessResponseToUiDocument(response));
        } catch (error) {
          markJobFailed(job.requestId, error instanceof Error ? error.message : "upload_failed");
        }
      }),
    );

    const [nextActivity, nextCounts] = await Promise.all([fetchActivity(10), fetchCounts()]);
    bootstrap(Object.values(useDocumentStore.getState().documents), nextCounts, nextActivity.events);
  };

  return (
    <section className="glass-panel flex flex-col gap-5 p-5">
      <div
        className={`rounded-[24px] border border-dashed px-6 py-10 text-center transition ${isHovered ? "border-[var(--accent-primary)] bg-white/55 shadow-glass-hover" : "border-white/60 bg-white/35"}`}
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
            className="rounded-2xl bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
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

      <div>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Recent activity</p>
          <p className="font-mono text-[11px] text-[var(--text-muted)]">{activity.length} events</p>
        </div>
        <div className="mt-3 space-y-2">
          {activity.slice(0, 5).map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))}
        </div>
      </div>
    </section>
  );
}

function resolveSourcePath(file: File, index: number, tauriPaths: string[]): string | null {
  const fileWithPath = file as File & { path?: string };
  if (typeof fileWithPath.path === "string" && fileWithPath.path.length > 0) {
    return fileWithPath.path;
  }
  const exactName = tauriPaths.find((path) => basename(path) === file.name);
  return exactName ?? tauriPaths[index] ?? null;
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/35 px-4 py-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="status-dot bg-[var(--accent-primary)]" />
        <div>
          <p className="font-semibold text-[var(--text-primary)]">{event.title}</p>
          <p className="text-xs text-[var(--text-secondary)]">{event.type}</p>
        </div>
      </div>
      <p className="font-mono text-[11px] text-[var(--text-muted)]">{new Date(event.timestamp).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</p>
    </div>
  );
}
