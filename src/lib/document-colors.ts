import type { UiDocumentKind } from "../types/documents";

const KIND_RGB_MAP: Record<string, string> = {
  receipt: "--receipt-color-rgb",
  contract: "--contract-color-rgb",
  invoice: "--invoice-color-rgb",
  meeting_notes: "--meeting-color-rgb",
  audio: "--audio-color-rgb",
};

export function kindRgbVar(kind: UiDocumentKind): string {
  return KIND_RGB_MAP[kind] ?? "--report-color-rgb";
}

export function kindColor(kind: UiDocumentKind): string {
  const map: Record<string, string> = {
    receipt: "var(--receipt-color)",
    contract: "var(--contract-color)",
    invoice: "var(--invoice-color)",
    meeting_notes: "var(--meeting-color)",
    audio: "var(--audio-color)",
  };
  return map[kind] ?? "var(--report-color)";
}
