import { relativeTime } from "../lib/time";
import type { UiDocument, UiDocumentKind } from "../types/documents";

function kindAccent(kind: UiDocumentKind): string {
  switch (kind) {
    case "receipt": return "var(--receipt-color)";
    case "contract": return "var(--contract-color)";
    case "invoice": return "var(--invoice-color)";
    case "meeting_notes": return "var(--meeting-color)";
    case "audio": return "var(--audio-color)";
    default: return "var(--report-color)";
  }
}

function kindLabel(kind: UiDocumentKind): string {
  switch (kind) {
    case "meeting_notes": return "Meeting";
    case "file_moved": return "Moved";
    default: return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

const processingStatuses = new Set([
  "uploading", "processing", "classifying", "classified",
  "extracting", "organizing", "indexing", "transcribing",
]);

export function DocumentListRow({
  document,
  selected,
  onClick,
}: {
  document: UiDocument;
  selected: boolean;
  onClick: () => void;
}) {
  const isProcessing = processingStatuses.has(document.status);
  const isFailed = document.status === "failed";
  const accent = kindAccent(document.kind);

  return (
    <button
      type="button"
      className={`doc-list-row ${selected ? "is-selected" : ""}`}
      style={selected ? { borderLeftColor: accent } : undefined}
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
    >
      <span
        className="status-dot shrink-0"
        style={{
          backgroundColor: isFailed ? "var(--invoice-color)" : accent,
          animation: isProcessing ? "pulse-dot 1.5s ease-in-out infinite" : undefined,
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{document.title}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span
            className="text-[10px] font-semibold uppercase"
            style={{ color: accent }}
          >
            {kindLabel(document.kind)}
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">
            {relativeTime(document.updatedAt)}
          </span>
        </div>
      </div>
      {isProcessing && (
        <div className="processing-bar-mini" />
      )}
    </button>
  );
}
