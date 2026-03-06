import { memo } from "react";

import { kindAccent, kindLabelShort } from "../lib/kind-utils";
import { relativeTime } from "../lib/time";
import type { UiDocument } from "../types/documents";

const processingStatuses = new Set([
  "uploading", "processing", "classifying", "classified",
  "extracting", "organizing", "indexing", "transcribing",
]);

export const DocumentListRow = memo(function DocumentListRow({
  document,
  selected,
  multiSelected,
  onClick,
}: {
  document: UiDocument;
  selected: boolean;
  multiSelected?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const isProcessing = processingStatuses.has(document.status);
  const isFailed = document.status === "failed";
  const accent = kindAccent(document.kind);

  return (
    <button
      type="button"
      className={`doc-list-row ${selected ? "is-selected" : ""} ${multiSelected ? "is-multi-selected" : ""}`}
      style={{ "--row-accent": accent } as React.CSSProperties}
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
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{document.title}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span
            className="text-[11px] font-medium uppercase"
            style={{ color: accent }}
          >
            {kindLabelShort(document.kind)}
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
});
