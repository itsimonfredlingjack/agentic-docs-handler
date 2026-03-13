import { mapToUserStatus, userStatusLabel, userStatusColor, getKeyLine } from "../lib/status";
import { getTimeGroup } from "../lib/feed-utils";
import type { UiDocument, UiDocumentKind } from "../types/documents";

type Props = {
  document: UiDocument;
  focused?: boolean;
  onSelect?: () => void;
  onRetry?: () => void;
  onUndo?: () => void;
};

function kindRgbVar(kind: UiDocumentKind): string {
  const map: Record<string, string> = {
    receipt: "--receipt-color-rgb",
    contract: "--contract-color-rgb",
    invoice: "--invoice-color-rgb",
    meeting_notes: "--meeting-color-rgb",
    audio: "--audio-color-rgb",
  };
  return map[kind] ?? "--report-color-rgb";
}

function kindDotColor(kind: UiDocumentKind): string {
  switch (kind) {
    case "receipt":
      return "var(--receipt-color)";
    case "contract":
      return "var(--contract-color)";
    case "invoice":
      return "var(--invoice-color)";
    case "meeting_notes":
      return "var(--meeting-color)";
    case "audio":
      return "var(--audio-color)";
    default:
      return "var(--report-color)";
  }
}

export function DocumentRow({ document, focused, onSelect, onRetry, onUndo }: Props) {
  const userStatus = mapToUserStatus(document);
  const statusLabel = userStatusLabel(userStatus);
  const statusColor = userStatusColor(userStatus);
  const keyLine = getKeyLine(document);
  const timeLabel = getTimeGroup(document.updatedAt ?? document.createdAt);
  const dest = document.moveResult?.to_path;

  const isFailed = userStatus === "misslyckades";
  const isReview = userStatus === "behöver_granskas";
  const isClickable = userStatus === "klar" || isReview;

  const modifierClass = isFailed
    ? "document-row--failed"
    : isReview
      ? "document-row--review"
      : "";

  return (
    <div
      className={`document-row animate-fade-in-up ${modifierClass} ${focused ? "document-row--focused" : ""}`}
      style={{ "--type-color-rgb": `var(${kindRgbVar(document.kind)})` } as React.CSSProperties}
      onClick={isClickable ? onSelect : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      data-testid="document-row"
    >
      {/* Row 1: dot + title + status pill + time */}
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-[6px] w-[6px] shrink-0 rounded-full"
          style={{ backgroundColor: kindDotColor(document.kind) }}
        />
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-[var(--text-primary)]">
          {document.title}
        </span>
        <span
          className="status-pill shrink-0"
          style={{
            color: statusColor,
            backgroundColor: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
          }}
        >
          {statusLabel}
        </span>
        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{timeLabel}</span>
      </div>

      {/* Row 2: key line + destination */}
      {(keyLine || dest) && (
        <div className="mt-1 flex items-center justify-between gap-4 pl-[14px]">
          {keyLine && (
            <span className="min-w-0 truncate text-[13px] text-[var(--text-secondary)]">{keyLine}</span>
          )}
          {dest && (
            <span
              className="shrink-0 truncate font-[var(--font-mono)] text-[11px] text-[var(--text-muted)]"
              title={dest}
            >
              → {dest.split("/").slice(-3).join("/")}
            </span>
          )}
        </div>
      )}

      {/* Undo move */}
      {document.moveStatus === "moved" && document.undoToken && onUndo && (
        <div className="mt-2 flex items-center justify-between gap-2 pl-[14px]">
          <span className="text-xs text-[var(--text-muted)]">
            {document.moveResult?.from_path
              ? `Flyttad från ${document.moveResult.from_path.split("/").pop()}`
              : "Flyttad"}
          </span>
          <button
            type="button"
            className="action-secondary shrink-0 px-3 py-1 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onUndo();
            }}
          >
            Ångra flytt
          </button>
        </div>
      )}

      {/* Failed state */}
      {isFailed && (
        <div className="mt-2 flex items-center justify-between gap-2 pl-[14px]">
          <span className="text-xs text-[var(--invoice-color)]">
            {document.summary || "Behandlingen misslyckades"}
          </span>
          {document.retryable && onRetry && (
            <button
              type="button"
              className="action-secondary shrink-0 px-3 py-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
            >
              Försök igen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
