import { useRef } from "react";
import type { WorkspaceResponse } from "../types/workspace";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useDocumentStore } from "../store/documentStore";
import { processFile } from "../lib/api";
import { buildQueuedDocument, mapProcessResponseToUiDocument } from "../lib/document-mappers";

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

export function WorkspaceHeader({ workspace }: { workspace: WorkspaceResponse }) {
  const hasBrief = workspace.ai_brief.length > 0;
  const toggleChatPanel = useWorkspaceStore((s) => s.toggleChatPanel);
  const chatPanelOpen = useWorkspaceStore((s) => s.chatPanelOpen);
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

  return (
    <header className="px-6 pt-5 pb-3">
      <div className="flex items-center justify-between min-w-0 mb-1.5">
        <div className="flex items-center gap-3 min-w-0 pr-4">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: workspace.cover_color || "var(--report-color)" }}
          />
          <h1 className="truncate text-lg-ui font-semibold tracking-tight text-white m-0">
            {workspace.is_inbox || workspace.name === "Inkorg" ? "Inbox" : workspace.name}
          </h1>
          <span className="shrink-0 text-sm-ui font-[var(--font-mono)] text-[var(--text-disabled)] px-2 py-0.5 rounded-full border border-[var(--surface-6)] bg-[var(--surface-4)]">
            {workspace.file_count} ITEMS
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            className="action-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm-ui"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="-mt-px">
              <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            Import
          </button>
          <button
            type="button"
            className={`action-secondary flex items-center justify-center px-2 py-1.5 ${chatPanelOpen ? "bg-[var(--surface-10)] border-[rgba(255,255,255,0.18)]" : ""}`}
            onClick={toggleChatPanel}
            aria-label="Toggle notebook"
            title="Toggle notebook"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M12.5 10l.75 1.75L15 12.5l-1.75.75L12.5 15l-.75-1.75L10 12.5l1.75-.75L12.5 10Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
            </svg>
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

      {hasBrief && (
        <div className="max-w-3xl">
          <p className="text-base-ui leading-relaxed text-[var(--text-secondary)] line-clamp-2">
            {workspace.ai_brief}
          </p>
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
    </header>
  );
}
