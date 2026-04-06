import { useRef, useState } from "react";
import type { WorkspaceResponse } from "../types/workspace";
import { useDocumentStore } from "../store/documentStore";
import { processFile } from "../lib/api";
import { buildQueuedDocument, mapProcessResponseToUiDocument } from "../lib/document-mappers";
import { t } from "../lib/locale";
import { ProgressBar } from "./ui/ProgressBar";

function entityIcon(type: string): string {
  switch (type) {
    case "person": return "P";
    case "company": return "C";
    case "date": return "D";
    case "amount": return "$";
    case "place": return "L";
    default: return "";
  }
}

const PROCESSING_STATUSES = new Set([
  "uploading", "processing", "classifying", "extracting", "organizing", "indexing", "transcribing", "queued",
]);

function InboxHeader({ workspace }: { workspace: WorkspaceResponse }) {
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);

  const docs = documentOrder.map((id) => documents[id]).filter(Boolean);
  const classifying = docs.filter((d) => PROCESSING_STATUSES.has(d.status)).length;
  const needsReview = docs.filter(
    (d) => d.status === "awaiting_confirmation" || d.status === "failed" || d.kind === "generic",
  ).length;
  const routed = docs.filter(
    (d) => d.moveStatus === "moved" || d.moveStatus === "auto_pending_client" || (d.workspaceId && d.workspaceId !== workspace.id),
  ).length;
  const total = docs.length;
  const progressValue = total > 0 ? (routed / total) * 100 : 0;

  const progressText = t("inbox.progress").replace("{routed}", String(routed)).replace("{total}", String(total));

  const statusParts: string[] = [];
  if (classifying > 0) {
    statusParts.push(t("inbox.classifying").replace("{count}", String(classifying)));
  }
  if (needsReview > 0) {
    statusParts.push(t("inbox.needs_review").replace("{count}", String(needsReview)));
  }

  return (
    <>
      <div className="flex items-center gap-3 min-w-0 pr-4">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: workspace.cover_color || "var(--report-color)" }}
        />
        <h1 className="truncate text-lg-ui font-semibold tracking-tight text-white m-0">
          {t("workspace.inbox")}
        </h1>
        <span className="shrink-0 text-sm-ui text-[var(--text-muted)]">
          {progressText}
        </span>
      </div>
      {total > 0 && (
        <div className="max-w-xs mt-1.5">
          <ProgressBar value={progressValue} className="[&_[role=progressbar]]:h-[2px]" />
        </div>
      )}
      {statusParts.length > 0 && (
        <p className="text-xs-ui text-[var(--text-muted)] mt-1">
          {statusParts.join(", ")}
        </p>
      )}
    </>
  );
}

function WorkspaceBriefSection({ workspace }: { workspace: WorkspaceResponse }) {
  const [briefExpanded, setBriefExpanded] = useState(false);
  const hasBrief = workspace.ai_brief.length > 0;
  const isLong = workspace.ai_brief.length > 150;

  return (
    <>
      {hasBrief && (
        <div className="max-w-3xl">
          <p className={`text-base-ui leading-relaxed text-[var(--text-secondary)] ${!briefExpanded ? "line-clamp-2" : ""}`}>
            {workspace.ai_brief}
          </p>
          {isLong && (
            <button
              type="button"
              className="text-xs-ui text-[var(--accent-primary)] hover:underline mt-0.5"
              onClick={() => setBriefExpanded((prev) => !prev)}
            >
              {briefExpanded ? t("workspace.show_less") : t("workspace.show_more")}
            </button>
          )}
        </div>
      )}

      {workspace.ai_entities.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-w-3xl mt-1.5">
          {workspace.ai_entities.slice(0, 8).map((entity, i) => {
            const name = typeof entity.name === "string" ? entity.name : "";
            const type = typeof entity.entity_type === "string" ? entity.entity_type : "";
            if (!name) return null;
            return (
              <span key={`${name}-${i}`} className="glass-badge text-xs-ui text-[var(--text-secondary)]">
                {entityIcon(type) && <span className="text-[var(--text-muted)]">{entityIcon(type)}</span>}
                {name}
              </span>
            );
          })}
        </div>
      )}

      {workspace.ai_topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-w-3xl mt-1">
          {workspace.ai_topics.slice(0, 6).map((topic) => (
            <span key={topic} className="text-xs-ui text-[var(--text-muted)]">
              #{topic}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function WorkspaceHeader({ workspace }: { workspace: WorkspaceResponse }) {
  const clientId = useDocumentStore((s) => s.clientId);
  const queueUploads = useDocumentStore((s) => s.queueUploads);
  const upsertDocument = useDocumentStore((s) => s.upsertDocument);
  const markJobFailed = useDocumentStore((s) => s.markJobFailed);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0 || !clientId) return;
    const fileArray = Array.from(files);
    const jobs = fileArray.map((file) => {
      const requestId = crypto.randomUUID();
      return { file, requestId, doc: buildQueuedDocument({ file, requestId, sourcePath: null }) };
    });
    queueUploads(jobs.map((j) => j.doc));
    for (const job of jobs) {
      try {
        const response = await processFile({ file: job.file, sourcePath: null, clientId, requestId: job.requestId });
        upsertDocument(mapProcessResponseToUiDocument(response));
      } catch (err) {
        markJobFailed(job.requestId, String(err));
      }
    }
  };

  const isInbox = workspace.is_inbox;

  return (
    <header className="px-6 pt-5 pb-3">
      <div className="flex items-center justify-between min-w-0 mb-1.5">
        {isInbox ? (
          <InboxHeader workspace={workspace} />
        ) : (
          <div className="flex items-center gap-3 min-w-0 pr-4">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: workspace.cover_color || "var(--report-color)" }}
            />
            <h1 className="truncate text-lg-ui font-semibold tracking-tight text-white m-0">
              {workspace.name}
            </h1>
            <span className="shrink-0 text-sm-ui font-[var(--font-mono)] text-[var(--text-disabled)] px-2 py-0.5 rounded-full border border-[var(--surface-6)] bg-[var(--surface-4)]">
              {workspace.file_count} {t("workspace.items").toUpperCase()}
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            className="action-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm-ui"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="-mt-px">
              <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            {t("action.import")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { void handleFilesSelected(e.target.files); e.target.value = ""; }}
          />
        </div>
      </div>

      {!isInbox && <WorkspaceBriefSection workspace={workspace} />}
    </header>
  );
}
