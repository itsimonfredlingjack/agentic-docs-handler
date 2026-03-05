import type { UiDocument } from "../types/documents";

export function FileMovedCard({ document }: { document: UiDocument }) {
  const to = document.moveResult?.to_path;

  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-1">{document.title}</h3>
        <span className="glass-badge shrink-0 border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.10)] text-[var(--receipt-color)]">
          <span className="status-dot bg-[var(--receipt-color)]" />
          moved
        </span>
      </div>
      {to ? <p className="font-mono text-xs text-[var(--text-muted)] line-clamp-1">→ {to}</p> : null}
    </article>
  );
}
