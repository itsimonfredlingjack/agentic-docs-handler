import type { UiDocument } from "../types/documents";
import { RequestIdMeta } from "../components/RequestIdMeta";

export function ContractCard({ document }: { document: UiDocument }) {
  const fields = document.extraction?.fields ?? {};
  const parties = Array.isArray(fields.parties) ? fields.parties.join(", ") : String(fields.parties ?? fields.counterparties ?? "—");
  const timeline = [fields.start_date, fields.end_date].filter(Boolean).join(" → ") || "—";
  const deadlines = Array.isArray(fields.deadlines) ? fields.deadlines.join(", ") : String(fields.deadlines ?? fields.renewal_date ?? "—");

  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Contract</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{document.title}</h3>
        </div>
        <span className="glass-badge text-[var(--contract-color)]" style={{ borderColor: "rgba(88,86,214,0.22)", backgroundColor: "rgba(88,86,214,0.10)" }}>
          <span className="status-dot bg-[var(--contract-color)]" />
          contract
        </span>
      </div>

      <p className="text-sm leading-6 text-[var(--text-secondary)]">{document.summary}</p>

      <dl className="space-y-3 text-sm">
        <div className="rounded-2xl bg-white/40 p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Parter</dt>
          <dd className="mt-1 text-[var(--text-primary)]">{parties}</dd>
        </div>
        <div className="rounded-2xl bg-white/40 p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Start/Slut</dt>
          <dd className="mt-1 text-[var(--text-primary)]">{timeline}</dd>
        </div>
        <div className="rounded-2xl bg-white/40 p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Deadlines</dt>
          <dd className="mt-1 text-[var(--text-primary)]">{deadlines}</dd>
        </div>
        <div className="rounded-2xl bg-white/40 p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Uppsägning</dt>
          <dd className="mt-1 text-[var(--text-primary)]">
            {String(fields.termination ?? fields.notice_period ?? "—")}
          </dd>
        </div>
      </dl>
      <RequestIdMeta document={document} />
    </article>
  );
}
