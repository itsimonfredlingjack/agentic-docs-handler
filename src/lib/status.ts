import type { UiDocument } from "../types/documents";

export type UserStatus =
  | "uppladdad"
  | "bearbetas"
  | "klar"
  | "behöver_granskas"
  | "misslyckades";

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
    case "completed":
    case "moved":
    case "ready":
      return "klar";
  }
}

export function userStatusLabel(status: UserStatus): string {
  switch (status) {
    case "uppladdad":
      return "Uppladdad";
    case "bearbetas":
      return "Bearbetas";
    case "klar":
      return "Klar";
    case "behöver_granskas":
      return "Granska";
    case "misslyckades":
      return "Misslyckades";
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
