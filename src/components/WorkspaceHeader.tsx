import type { WorkspaceResponse } from "../types/workspace";

export function WorkspaceHeader({ workspace }: { workspace: WorkspaceResponse }) {
  const hasBrief = workspace.ai_brief.length > 0;

  return (
    <header className="px-6 pt-5 pb-3">
      <div className="flex items-center justify-between min-w-0 mb-1.5">
        <div className="flex items-center gap-3 min-w-0 pr-4">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: workspace.cover_color || "var(--report-color)" }}
          />
          <h1 className="truncate text-lg font-semibold tracking-tight text-white m-0">
            {workspace.is_inbox || workspace.name === "Inkorg" ? "Inbox" : workspace.name}
          </h1>
          <span className="shrink-0 text-[11px] font-[var(--font-mono)] text-[var(--text-disabled)] px-2 py-0.5 rounded-full border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
            {workspace.file_count} ITEMS
          </span>
        </div>
      </div>

      {hasBrief && (
        <div className="max-w-3xl">
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)] line-clamp-2">
            {workspace.ai_brief}
          </p>
        </div>
      )}
    </header>
  );
}
