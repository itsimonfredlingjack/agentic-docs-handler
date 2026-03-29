import type { WorkspaceResponse } from "../types/workspace";

type WorkspaceHeaderProps = {
  workspace: WorkspaceResponse;
  onToggleChat: () => void;
};

export function WorkspaceHeader({ workspace, onToggleChat }: WorkspaceHeaderProps) {
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
            {workspace.name}
          </h1>
          <span className="shrink-0 text-[11px] font-[var(--font-mono)] text-[var(--text-disabled)] px-2 py-0.5 rounded-full border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
            {workspace.file_count} ITEMS
          </span>
        </div>
        <div className="flex shrink-0">
          <button
            type="button"
            className="text-[11px] font-medium text-[rgba(255,255,255,0.5)] hover:text-white transition-colors bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.08)] px-2.5 py-1.5 rounded"
            onClick={onToggleChat}
            aria-label="Toggle chat"
          >
            Contextual Chat ⌘/
          </button>
        </div>
      </div>

      <div className="max-w-3xl">
        {hasBrief ? (
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)] line-clamp-2">
            {workspace.ai_brief}
          </p>
        ) : (
          <p className="text-[13px] leading-relaxed text-[var(--text-disabled)] italic">
            Waiting for AI summary generation...
          </p>
        )}
      </div>
    </header>
  );
}
