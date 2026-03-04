import type { UiDocument } from "../types/documents";
import { RequestIdMeta } from "../components/RequestIdMeta";

export function FileMovedCard({ document }: { document: UiDocument }) {
  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Moved</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{document.title}</h3>
        </div>
        <span className="glass-badge border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.10)] text-[var(--receipt-color)]">
          <span className="status-dot bg-[var(--receipt-color)]" />
          moved
        </span>
      </div>
      <div className="space-y-3 text-sm font-mono text-[var(--text-secondary)]">
        <p>{document.moveResult?.from_path ?? "—"}</p>
        <p className="text-[var(--text-primary)]">→</p>
        <p className="text-[var(--text-primary)]">{document.moveResult?.to_path ?? "—"}</p>
      </div>
      {document.undoToken ? (
        <p className="text-xs text-[var(--text-secondary)]">Undo available</p>
      ) : null}
      <RequestIdMeta document={document} />
    </article>
  );
}
