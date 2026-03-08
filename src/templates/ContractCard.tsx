import type { UiDocument } from "../types/documents";

function fmt(value: unknown): string {
  if (value === null || typeof value === "undefined" || value === "") return "";
  return String(value);
}

export function ContractCard({ document }: { document: UiDocument }) {
  const fields = document.extraction?.fields ?? {};
  const parties = Array.isArray(fields.parties) ? fields.parties.join(", ") : fmt(fields.parties ?? fields.counterparties);
  const timeline = [fields.start_date, fields.end_date].filter(Boolean).join(" → ");
  const details = [parties, timeline].filter(Boolean).join(" · ");

  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Contract</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)] line-clamp-2">{document.title}</h3>
        </div>
        <span className="glass-badge shrink-0 text-[var(--contract-color)]" style={{ borderColor: "rgba(88,86,214,0.22)", backgroundColor: "rgba(88,86,214,0.10)" }}>
          <span className="status-dot bg-[var(--contract-color)]" />
          contract
        </span>
      </div>
      <p className="text-sm leading-6 text-[var(--text-secondary)] line-clamp-2">{document.summary}</p>
      {details ? <p className="font-mono text-xs text-[var(--text-muted)] line-clamp-1">{details}</p> : null}
    </article>
  );
}
