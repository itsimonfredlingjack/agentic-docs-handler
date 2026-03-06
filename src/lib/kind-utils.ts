import type { UiDocumentKind } from "../types/documents";

export function kindAccent(kind: UiDocumentKind): string {
  switch (kind) {
    case "receipt": return "var(--receipt-color)";
    case "contract": return "var(--contract-color)";
    case "invoice": return "var(--invoice-color)";
    case "meeting_notes": return "var(--meeting-color)";
    case "audio": return "var(--audio-color)";
    default: return "var(--report-color)";
  }
}

export function kindLabel(kind: UiDocumentKind): string {
  switch (kind) {
    case "meeting_notes": return "Meeting Notes";
    case "file_moved": return "Moved";
    default: return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

export function kindLabelShort(kind: UiDocumentKind): string {
  switch (kind) {
    case "meeting_notes": return "Meeting";
    case "file_moved": return "Moved";
    default: return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

export function formatMimeLabel(mimeType: string): string {
  const short: Record<string, string> = {
    "application/pdf": "PDF",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/webp": "WebP",
    "audio/mpeg": "MP3",
    "audio/wav": "WAV",
    "audio/ogg": "OGG",
    "text/plain": "TXT",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  };
  return short[mimeType] ?? mimeType.split("/").pop()?.toUpperCase() ?? mimeType;
}
