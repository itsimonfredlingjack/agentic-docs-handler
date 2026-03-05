import type { UiDocument } from "../types/documents";
import { RequestIdMeta } from "../components/RequestIdMeta";

type ReceiptCardProps = {
  document: UiDocument;
  variant?: "receipt" | "invoice";
};

function formatField(value: unknown): string {
  if (value === null || typeof value === "undefined" || value === "") {
    return "—";
  }
  return String(value);
}

export function ReceiptCard({ document, variant = "receipt" }: ReceiptCardProps) {
  const fields = document.extraction?.fields ?? {};
  const accent = variant === "invoice" ? "var(--invoice-color)" : "var(--receipt-color)";

  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            {variant === "invoice" ? "Invoice" : "Receipt"}
          </p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{document.title}</h3>
        </div>
        <span
          className="glass-badge"
          style={{ color: accent, backgroundColor: `${accent}1A`, borderColor: `${accent}33` }}
        >
          <span className="status-dot" style={{ backgroundColor: accent }} />
          {variant}
        </span>
      </div>

      <p className="text-sm leading-6 text-[var(--text-secondary)]">{document.summary}</p>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-white/40 p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {variant === "invoice" ? "Amount" : "Belopp"}
          </dt>
          <dd className="mt-1 font-semibold text-[var(--text-primary)]">
            {formatField(fields.amount ?? fields.total ?? fields.total_amount)}
          </dd>
        </div>
        <div className="rounded-2xl bg-white/40 p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {variant === "invoice" ? "Due date" : "Datum"}
          </dt>
          <dd className="mt-1 font-semibold text-[var(--text-primary)]">
            {formatField(fields.due_date ?? fields.date)}
          </dd>
        </div>
        <div className="rounded-2xl bg-white/40 p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {variant === "invoice" ? "Invoice #" : "Moms"}
          </dt>
          <dd className="mt-1 font-semibold text-[var(--text-primary)]">
            {formatField(fields.invoice_number ?? fields.vat ?? fields.tax)}
          </dd>
        </div>
        <div className="rounded-2xl bg-white/40 p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {variant === "invoice" ? "Sender" : "Vendor"}
          </dt>
          <dd className="mt-1 font-semibold text-[var(--text-primary)]">
            {formatField(fields.vendor ?? fields.sender ?? fields.vendor_name)}
          </dd>
        </div>
      </dl>
      <RequestIdMeta document={document} />
    </article>
  );
}
