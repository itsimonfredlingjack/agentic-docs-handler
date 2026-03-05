import type { UiDocument } from "../types/documents";

type ReceiptCardProps = {
  document: UiDocument;
  variant?: "receipt" | "invoice";
};

function fmt(value: unknown): string {
  if (value === null || typeof value === "undefined" || value === "") return "";
  return String(value);
}

export function ReceiptCard({ document, variant = "receipt" }: ReceiptCardProps) {
  const fields = document.extraction?.fields ?? {};
  const accent = variant === "invoice" ? "var(--invoice-color)" : "var(--receipt-color)";
  const vendor = fmt(fields.vendor ?? fields.sender ?? fields.vendor_name);
  const amount = fmt(fields.amount ?? fields.total ?? fields.total_amount);
  const date = fmt(fields.due_date ?? fields.date);
  const details = [vendor, amount, date].filter(Boolean).join(" · ");

  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-1">{document.title}</h3>
        <span
          className="glass-badge shrink-0"
          style={{ color: accent, backgroundColor: `${accent}1A`, borderColor: `${accent}33` }}
        >
          <span className="status-dot" style={{ backgroundColor: accent }} />
          {variant}
        </span>
      </div>
      <p className="text-sm text-[var(--text-secondary)] line-clamp-1">{document.summary}</p>
      {details ? <p className="font-mono text-xs text-[var(--text-muted)]">{details}</p> : null}
    </article>
  );
}
