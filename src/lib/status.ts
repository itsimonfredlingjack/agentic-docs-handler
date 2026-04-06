import type { UiDocument } from "../types/documents";
import { t } from "./locale";

export type UserStatus =
  | "uppladdad"
  | "bearbetas"
  | "klar"
  | "behöver_granskas"
  | "misslyckades"
  | "väntar";

export function mapToUserStatus(doc: UiDocument): UserStatus {
  switch (doc.status) {
    case "queued":
    case "uploading":
      return "uppladdad";
    case "processing":
    case "transcribing":
    case "classifying":
    case "classified":
    case "extracting":
    case "extracted":
    case "organizing":
    case "indexing":
      return "bearbetas";
    case "awaiting_confirmation":
      return "behöver_granskas";
    case "failed":
      return "misslyckades";
    case "pending_classification":
      return "väntar";
    case "completed":
    case "moved":
    case "ready":
      return "klar";
  }
}

export function userStatusLabel(status: UserStatus): string {
  switch (status) {
    case "uppladdad":
      return t("status.uploaded");
    case "bearbetas":
      return t("status.processing");
    case "klar":
      return t("status.completed");
    case "behöver_granskas":
      return t("status.review");
    case "misslyckades":
      return t("status.failed");
    case "väntar":
      return t("status.pending");
  }
}

export function userStatusColor(status: UserStatus): string {
  switch (status) {
    case "uppladdad":
      return "var(--text-muted)";
    case "bearbetas":
      return "var(--accent-primary)";
    case "klar":
      return "var(--receipt-color)";
    case "behöver_granskas":
      return "var(--meeting-color)";
    case "misslyckades":
      return "var(--invoice-color)";
    case "väntar":
      return "var(--meeting-color)";
  }
}

function fmt(value: unknown): string {
  if (value === null || typeof value === "undefined" || value === "") return "";
  return String(value);
}

export function getKeyLine(doc: UiDocument): string {
  const fields = doc.extraction?.fields ?? {};

  switch (doc.kind) {
    case "receipt":
    case "invoice": {
      const vendor = fmt(fields.vendor ?? fields.sender ?? fields.vendor_name);
      const amount = fmt(fields.amount ?? fields.total ?? fields.total_amount);
      const date = fmt(fields.due_date ?? fields.date);
      return [vendor, amount, date].filter(Boolean).join(" · ");
    }
    case "contract": {
      const parties = Array.isArray(fields.parties)
        ? fields.parties.join(", ")
        : fmt(fields.parties ?? fields.counterparties);
      const timeline = [fields.start_date, fields.end_date].filter(Boolean).join(" → ");
      return [parties, timeline].filter(Boolean).join(" · ");
    }
    case "audio":
    case "meeting_notes": {
      const lang = doc.transcription?.language ?? "";
      const dur = doc.transcription?.duration ? `${doc.transcription.duration.toFixed(1)}s` : "";
      const model = doc.transcription?.model ?? "";
      return [lang, dur, model].filter(Boolean).join(" · ");
    }
    case "report": {
      const author = fmt(fields.author ?? fields.organization);
      const date = fmt(fields.date);
      const ref = fmt(fields.reference_number);
      return [author, date, ref].filter(Boolean).join(" · ");
    }
    case "letter": {
      const sender = fmt(fields.sender);
      const subject = fmt(fields.subject ?? fields.key_message);
      const date = fmt(fields.date);
      return [sender, subject, date].filter(Boolean).join(" · ");
    }
    case "tax_document": {
      const subtype = fmt(fields.document_subtype);
      const taxYear = fmt(fields.tax_year);
      const amount = fmt(fields.tax_amount ?? fields.total_income);
      return [subtype, taxYear, amount].filter(Boolean).join(" · ");
    }
    case "file_moved": {
      const to = doc.moveResult?.to_path;
      return to ? `→ ${to}` : "";
    }
    default: {
      const entries = Object.entries(fields).filter(
        ([, v]) => v !== null && typeof v !== "undefined" && v !== "",
      );
      return entries
        .slice(0, 2)
        .map(([, v]) => fmt(v))
        .filter(Boolean)
        .join(" · ");
    }
  }
}

export function isProcessingStatus(doc: UiDocument): boolean {
  const s = mapToUserStatus(doc);
  return s === "uppladdad" || s === "bearbetas";
}

export function isInternalPipelineFlag(value: string): boolean {
  const candidate = value.trim().toLowerCase();
  return candidate.startsWith("classifier_") || candidate.startsWith("pdf_") || candidate.endsWith("_fallback");
}
