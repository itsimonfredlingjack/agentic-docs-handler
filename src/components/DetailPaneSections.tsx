import { useState } from "react";

import { kindAccent, kindLabel, formatMimeLabel } from "../lib/kind-utils";
import type { UiDocument, UiDocumentKind } from "../types/documents";

function formatFieldKey(key: string): string {
  return key.replace(/_/g, " ");
}

function field(fields: Record<string, unknown>, key: string): string | null {
  const v = fields[key];
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

function fieldList(fields: Record<string, unknown>, key: string): string[] {
  const v = fields[key];
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === "string" && item.length > 0);
}

// Staggered entrance wrapper for individual fields
function StaggeredField({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        animation: "detail-fade-in 200ms ease both",
        animationDelay: `${index * 60}ms`,
      }}
    >
      {children}
    </div>
  );
}

function HeroValue({ value, accent }: { value: string; accent?: string }) {
  return (
    <p
      className="text-2xl font-bold tracking-tight"
      style={accent ? { color: accent } : undefined}
    >
      {value}
    </p>
  );
}

function FieldPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function FieldList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
        {label}
      </p>
      <ul className="mt-1 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-[var(--text-primary)] before:mr-2 before:text-[var(--text-muted)] before:content-['\2022']">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfidenceBar({ confidence, fieldKey }: { confidence: number; fieldKey: string }) {
  return (
    <div
      className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/5"
      role="meter"
      aria-valuenow={Math.round(confidence * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${fieldKey} confidence`}
    >
      <div
        className="h-full rounded-full bg-[var(--accent-primary)] transition-all duration-500"
        style={{ width: `${Math.round(confidence * 100)}%`, opacity: 0.6 }}
      />
    </div>
  );
}

// --- Receipt: amount hero, vendor + date, category/payment grid ---
function ReceiptLayout({ fields, fieldConfidence }: { fields: Record<string, unknown>; fieldConfidence: Record<string, number> }) {
  const amount = field(fields, "amount");
  const currency = field(fields, "currency");
  const vendor = field(fields, "vendor");
  const date = field(fields, "date");
  const vatAmount = field(fields, "vat_amount");
  const items = fieldList(fields, "items");
  let idx = 0;

  return (
    <div className="flex flex-col gap-4">
      {amount && (
        <StaggeredField index={idx++}>
          <HeroValue value={`${currency ?? ""} ${amount}`.trim()} />
          {fieldConfidence.amount > 0 && <ConfidenceBar confidence={fieldConfidence.amount} fieldKey="amount" />}
        </StaggeredField>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {vendor && <StaggeredField index={idx++}><FieldPair label="Vendor" value={vendor} /></StaggeredField>}
        {date && <StaggeredField index={idx++}><FieldPair label="Date" value={date} /></StaggeredField>}
        {vatAmount && <StaggeredField index={idx++}><FieldPair label="VAT" value={vatAmount} /></StaggeredField>}
      </div>
      {items.length > 0 && (
        <StaggeredField index={idx++}>
          <FieldList label="Items" items={items} />
        </StaggeredField>
      )}
    </div>
  );
}

// --- Contract: parties hero, term + dates, value ---
function ContractLayout({ fields, fieldConfidence }: { fields: Record<string, unknown>; fieldConfidence: Record<string, number> }) {
  const parties = fieldList(fields, "parties");
  const startDate = field(fields, "start_date");
  const endDate = field(fields, "end_date");
  const value = field(fields, "value");
  const termination = field(fields, "termination_clause");
  let idx = 0;

  return (
    <div className="flex flex-col gap-4">
      {parties.length > 0 && (
        <StaggeredField index={idx++}>
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {parties.join("  \u2194  ")}
          </p>
        </StaggeredField>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {startDate && <StaggeredField index={idx++}><FieldPair label="Effective" value={startDate} /></StaggeredField>}
        {endDate && <StaggeredField index={idx++}><FieldPair label="Expires" value={endDate} /></StaggeredField>}
        {value && (
          <StaggeredField index={idx++}>
            <FieldPair label="Value" value={value} />
            {fieldConfidence.value > 0 && <ConfidenceBar confidence={fieldConfidence.value} fieldKey="value" />}
          </StaggeredField>
        )}
      </div>
      {termination && (
        <StaggeredField index={idx++}>
          <div>
            <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">Termination clause</p>
            <p className="mt-0.5 text-sm leading-6 text-[var(--text-secondary)]">{termination}</p>
          </div>
        </StaggeredField>
      )}
    </div>
  );
}

// --- Invoice: invoice # + due date hero, amount, from/to ---
function InvoiceLayout({ fields, fieldConfidence }: { fields: Record<string, unknown>; fieldConfidence: Record<string, number> }) {
  const invoiceNumber = field(fields, "invoice_number");
  const amount = field(fields, "amount");
  const dueDate = field(fields, "due_date");
  const sender = field(fields, "sender");
  const recipient = field(fields, "recipient");
  const items = fieldList(fields, "items");
  let idx = 0;

  return (
    <div className="flex flex-col gap-4">
      {invoiceNumber && (
        <StaggeredField index={idx++}>
          <p className="font-mono text-base font-bold text-[var(--text-primary)]">
            #{invoiceNumber}
          </p>
        </StaggeredField>
      )}
      <div className="flex items-baseline gap-4">
        {amount && (
          <StaggeredField index={idx++}>
            <HeroValue value={amount} accent="var(--invoice-color)" />
          </StaggeredField>
        )}
        {dueDate && (
          <StaggeredField index={idx++}>
            <span className="rounded-lg bg-[rgba(255,55,95,0.1)] px-2 py-0.5 text-xs font-semibold text-[var(--invoice-color)]">
              Due {dueDate}
            </span>
          </StaggeredField>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {sender && <StaggeredField index={idx++}><FieldPair label="From" value={sender} /></StaggeredField>}
        {recipient && <StaggeredField index={idx++}><FieldPair label="To" value={recipient} /></StaggeredField>}
      </div>
      {items.length > 0 && (
        <StaggeredField index={idx++}>
          <FieldList label="Line items" items={items} />
        </StaggeredField>
      )}
      {fieldConfidence.amount > 0 && <ConfidenceBar confidence={fieldConfidence.amount} fieldKey="amount" />}
    </div>
  );
}

// --- Meeting Notes: title + duration hero, decisions, action items ---
function MeetingLayout({ fields, fieldConfidence }: { fields: Record<string, unknown>; fieldConfidence: Record<string, number> }) {
  const date = field(fields, "date");
  const nextMeeting = field(fields, "next_meeting");
  const participants = fieldList(fields, "participants");
  const decisions = fieldList(fields, "decisions");
  const actionItems = fieldList(fields, "action_items");
  let idx = 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {date && (
          <StaggeredField index={idx++}>
            <span className="text-sm font-medium text-[var(--text-primary)]">{date}</span>
          </StaggeredField>
        )}
        {participants.length > 0 && (
          <StaggeredField index={idx++}>
            <span className="text-xs text-[var(--text-muted)]">
              {participants.length} participant{participants.length !== 1 ? "s" : ""}
            </span>
          </StaggeredField>
        )}
      </div>
      {decisions.length > 0 && (
        <StaggeredField index={idx++}>
          <FieldList label="Key decisions" items={decisions} />
        </StaggeredField>
      )}
      {actionItems.length > 0 && (
        <StaggeredField index={idx++}>
          <FieldList label="Action items" items={actionItems} />
        </StaggeredField>
      )}
      {nextMeeting && (
        <StaggeredField index={idx++}>
          <FieldPair label="Next meeting" value={nextMeeting} />
          {fieldConfidence.next_meeting > 0 && <ConfidenceBar confidence={fieldConfidence.next_meeting} fieldKey="next_meeting" />}
        </StaggeredField>
      )}
    </div>
  );
}

// --- Audio: duration + speakers hero, topics ---
function AudioLayout({ fields, fieldConfidence, document }: { fields: Record<string, unknown>; fieldConfidence: Record<string, number>; document: UiDocument }) {
  const duration = document.transcription?.duration;
  const durationStr = duration ? `${Math.round(duration / 60)}min` : null;
  const decisions = fieldList(fields, "decisions");
  const actionItems = fieldList(fields, "action_items");
  const participants = fieldList(fields, "participants");
  let idx = 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        {durationStr && (
          <StaggeredField index={idx++}>
            <span className="text-lg font-bold text-[var(--audio-color)]">{durationStr}</span>
          </StaggeredField>
        )}
        {participants.length > 0 && (
          <StaggeredField index={idx++}>
            <span className="text-sm text-[var(--text-muted)]">
              {participants.length} speaker{participants.length !== 1 ? "s" : ""}
            </span>
          </StaggeredField>
        )}
      </div>
      {decisions.length > 0 && (
        <StaggeredField index={idx++}>
          <FieldList label="Topics" items={decisions} />
        </StaggeredField>
      )}
      {actionItems.length > 0 && (
        <StaggeredField index={idx++}>
          <FieldList label="Action items" items={actionItems} />
        </StaggeredField>
      )}
    </div>
  );
}

// --- Generic: 2-col grid fallback ---
function GenericLayout({ fields, fieldConfidence }: { fields: Record<string, unknown>; fieldConfidence: Record<string, number> }) {
  const fieldEntries = Object.entries(fields).filter(
    ([, value]) => value !== null && typeof value !== "undefined" && value !== "",
  );

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
      {fieldEntries.map(([key, value], index) => (
        <StaggeredField key={key} index={index}>
          <div className={Array.isArray(value) || String(value).length > 60 ? "col-span-2" : ""}>
            <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              {formatFieldKey(key)}
            </p>
            <p className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">
              {Array.isArray(value) ? value.join(", ") : String(value)}
            </p>
            {fieldConfidence[key] != null && fieldConfidence[key] > 0 && (
              <ConfidenceBar confidence={fieldConfidence[key]} fieldKey={key} />
            )}
          </div>
        </StaggeredField>
      ))}
    </div>
  );
}

// Min expected fields per type for fallback detection
const MIN_EXPECTED_FIELDS: Record<string, string[]> = {
  receipt: ["vendor", "amount"],
  contract: ["parties"],
  invoice: ["invoice_number", "amount"],
  meeting_notes: ["decisions", "action_items"],
};

function shouldUseFallback(kind: UiDocumentKind, fields: Record<string, unknown>): boolean {
  const expected = MIN_EXPECTED_FIELDS[kind];
  if (!expected) return true;
  const present = expected.filter((key) => {
    const v = fields[key];
    if (Array.isArray(v)) return v.length > 0;
    return v !== null && v !== undefined && v !== "";
  });
  return present.length < 1;
}

// --- Source section ---
export function DetailPaneSource({ document }: { document: UiDocument }) {
  const accent = kindAccent(document.kind);
  const [showOcr, setShowOcr] = useState(false);
  const hasOcr = Boolean(document.classification.ocr_text);

  return (
    <section className="detail-section">
      <div className="flex items-center gap-3">
        <span
          className="glass-badge"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
        >
          <span className="status-dot" style={{ backgroundColor: accent, width: 6, height: 6 }} />
          {kindLabel(document.kind)}
        </span>
        {document.classification.confidence > 0 && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {Math.round(document.classification.confidence * 100)}% confidence
          </span>
        )}
      </div>
      <h2 className="mt-3 text-xl font-bold tracking-tight text-[var(--text-primary)]">{document.title}</h2>
      {document.summary && (
        <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{document.summary}</p>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-muted)]">
        {document.sourcePath && (
          <span className="truncate font-mono">{document.sourcePath.split("/").pop()}</span>
        )}
        <span>{formatMimeLabel(document.mimeType)}</span>
        {hasOcr && (
          <button
            type="button"
            className="focus-ring rounded-md px-1.5 py-0.5 text-[var(--text-muted)] transition hover:text-[var(--text-secondary)]"
            onClick={() => setShowOcr((v) => !v)}
          >
            {showOcr ? "Hide raw text" : "Show raw text"}
          </button>
        )}
      </div>
      {showOcr && document.classification.ocr_text && (
        <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-[var(--surface-muted)] p-3 font-mono text-xs leading-5 text-[var(--text-secondary)]">
          {document.classification.ocr_text}
        </pre>
      )}
    </section>
  );
}

// --- Extraction section (THE HERO) — type-specific smart cards ---
export function DetailPaneExtraction({ document }: { document: UiDocument }) {
  const fields = document.extraction?.fields ?? {};
  const fieldConfidence = document.extraction?.field_confidence ?? {};
  const fieldEntries = Object.entries(fields).filter(
    ([, value]) => value !== null && typeof value !== "undefined" && value !== "",
  );

  if (fieldEntries.length === 0) return null;

  const useFallback = shouldUseFallback(document.kind, fields);
  const kind = document.kind;

  let layout: React.ReactNode;
  if (useFallback) {
    layout = <GenericLayout fields={fields} fieldConfidence={fieldConfidence} />;
  } else if (kind === "receipt") {
    layout = <ReceiptLayout fields={fields} fieldConfidence={fieldConfidence} />;
  } else if (kind === "contract") {
    layout = <ContractLayout fields={fields} fieldConfidence={fieldConfidence} />;
  } else if (kind === "invoice") {
    layout = <InvoiceLayout fields={fields} fieldConfidence={fieldConfidence} />;
  } else if (kind === "meeting_notes") {
    layout = <MeetingLayout fields={fields} fieldConfidence={fieldConfidence} />;
  } else if (kind === "audio") {
    layout = <AudioLayout fields={fields} fieldConfidence={fieldConfidence} document={document} />;
  } else {
    layout = <GenericLayout fields={fields} fieldConfidence={fieldConfidence} />;
  }

  const missingFields = document.extraction?.missing_fields ?? [];

  return (
    <section className="detail-section-hero">
      <p className="detail-section-label">AI Extraction</p>
      <div className="mt-3">
        {layout}
      </div>
      {missingFields.length > 0 && (
        <div className="mt-4 space-y-1 border-t border-[var(--border-subtle)] pt-3">
          {missingFields.map((field) => (
            <p key={field} className="text-xs text-[var(--text-disabled)]">
              <span className="capitalize">{field.replace(/_/g, " ")}</span>
              <span className="ml-2 italic">- not found</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

// --- Transcription section ---
export function DetailPaneTranscription({ document }: { document: UiDocument }) {
  const hasTranscription =
    document.transcription?.text &&
    (document.kind === "audio" || document.kind === "meeting_notes");

  if (!hasTranscription) return null;

  return (
    <section className="detail-section">
      <p className="detail-section-label">Transcription</p>
      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
        {document.transcription!.text.length > 800
          ? `${document.transcription!.text.slice(0, 800)}...`
          : document.transcription!.text}
      </p>
    </section>
  );
}

// --- Organized (move) section ---
export function DetailPaneOrganized({ document }: { document: UiDocument }) {
  if (!document.movePlan?.destination && document.moveStatus === "not_requested") return null;

  return (
    <section className="detail-section">
      <p className="detail-section-label">Organization</p>
      <div className="mt-2 space-y-2">
        {document.movePlan?.destination && (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-[var(--text-muted)]">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 4.5V12h12V5.5H7L5.5 4H1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="break-all font-mono text-xs text-[var(--text-secondary)]">
              {document.movePlan.destination}
            </span>
          </div>
        )}
        {document.movePlan?.rule_name && (
          <p className="text-xs text-[var(--text-muted)]">
            Rule: <span className="text-[var(--text-secondary)]">{document.movePlan.rule_name}</span>
          </p>
        )}
        <p className="text-xs text-[var(--text-muted)]">
          Status: <span className="text-[var(--text-secondary)]">{document.moveStatus.replace(/_/g, " ")}</span>
        </p>
      </div>
    </section>
  );
}

// --- Tags section ---
export function DetailPaneTags({ document }: { document: UiDocument }) {
  if (document.tags.length === 0) return null;

  return (
    <section className="detail-section">
      <p className="detail-section-label">Tags</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {document.tags.map((tag) => (
          <span key={tag} className="glass-badge bg-[var(--surface-muted)] text-[var(--text-secondary)]">
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}

// --- Suggested actions section ---
export function DetailPaneSuggestedActions({ document }: { document: UiDocument }) {
  const actions = document.classification.suggested_actions;
  if (!actions || actions.length === 0) return null;

  return (
    <section className="detail-section">
      <p className="detail-section-label">Suggested Actions</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <span
            key={action}
            className="glass-badge bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] text-[var(--accent-primary)]"
          >
            {action}
          </span>
        ))}
      </div>
    </section>
  );
}

// --- Pipeline timings section ---
const STAGE_COLORS: Record<string, string> = {
  classify: "var(--contract-color)",
  extract: "var(--audio-color)",
  organize: "var(--receipt-color)",
  transcribe: "var(--meeting-color)",
  index: "var(--report-color)",
};

function stageColor(key: string): string {
  for (const [prefix, color] of Object.entries(STAGE_COLORS)) {
    if (key.toLowerCase().includes(prefix)) return color;
  }
  return "var(--report-color)";
}

export function DetailPaneTimings({ document }: { document: UiDocument }) {
  const timings = document.timings;
  if (!timings || Object.keys(timings).length === 0) return null;

  const entries = Object.entries(timings).filter(([, ms]) => ms > 0);
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, [, ms]) => sum + ms, 0);

  return (
    <section className="detail-section">
      <div className="flex items-center justify-between">
        <p className="detail-section-label">Pipeline</p>
        <span className="text-[11px] text-[var(--text-muted)]">
          {total < 1000 ? `${Math.round(total)}ms` : `${(total / 1000).toFixed(1)}s`}
        </span>
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
        {entries.map(([key, ms]) => (
          <div
            key={key}
            className="h-full transition-all duration-500"
            style={{
              width: `${(ms / total) * 100}%`,
              backgroundColor: stageColor(key),
              opacity: 0.7,
            }}
            title={`${key}: ${Math.round(ms)}ms`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {entries.map(([key, ms]) => (
          <span key={key} className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: stageColor(key), opacity: 0.7 }}
            />
            {key} {Math.round(ms)}ms
          </span>
        ))}
      </div>
    </section>
  );
}

// --- Warnings section ---
export function DetailPaneWarnings({ document }: { document: UiDocument }) {
  if (document.warnings.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[rgba(255,159,10,0.18)] bg-[rgba(255,159,10,0.08)] p-3">
      {document.warnings.map((warning, i) => (
        <p key={i} className="text-sm text-[var(--meeting-color)]">{warning}</p>
      ))}
    </section>
  );
}
