import { mapToUserStatus, userStatusColor } from "../lib/status";
import { getTimeGroup } from "../lib/feed-utils";
import { kindRgbVar, kindColor } from "../lib/document-colors";
import { highlightSnippet } from "../lib/highlight-snippet";
import type { UiDocument } from "../types/documents";

type Props = {
  document: UiDocument;
  focused?: boolean;
  snippet?: string;
  searchQuery?: string;
  onSelect?: () => void;
  onRetry?: () => void;
  onUndo?: () => void;
  isInbox?: boolean;
};


export function DocumentRow({ document, focused, snippet, searchQuery, onSelect, onRetry, onUndo, isInbox }: Props) {
  const userStatus = mapToUserStatus(document);
  const statusColor = userStatusColor(userStatus);
  const timeLabel = getTimeGroup(document.updatedAt ?? document.createdAt);
  
  const isFailed = userStatus === "misslyckades";
  const isReview = userStatus === "behöver_granskas";
  const isClickable = userStatus === "klar" || isReview;

  const displayTitle = document.classification?.title || document.title;
  const isAiTitle = !!document.classification?.title;

  const modifierClass = isFailed
    ? "document-row--failed"
    : isReview
      ? "document-row--review"
      : "";

  const extractions = document.extraction?.fields;
  const vendor = (extractions?.vendor || extractions?.store_name || extractions?.company) as string | undefined;
  const amount = (extractions?.total_amount || extractions?.amount) as string | undefined;
  const date = (extractions?.date || extractions?.receipt_date || extractions?.invoice_date) as string | undefined;
  const hasExtractions = vendor || amount || date;

  return (
    <div
      className={`document-row animate-fade-in-up flex flex-col justify-center px-4 py-[6px] transition-colors border-b border-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.02)] ${modifierClass} ${focused ? "bg-[rgba(255,255,255,0.04)]" : ""}`}
      style={{ "--type-color-rgb": `var(${kindRgbVar(document.kind)})` } as React.CSSProperties}
      onClick={isClickable ? onSelect : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      data-testid="document-row"
    >
      <div className="flex items-center gap-3">
        {/* Type Icon Dot */}
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]"
          style={{ backgroundColor: kindColor(document.kind) }}
        />
        
        {/* Title */}
        <span className={`min-w-0 flex-[2] truncate text-[13px] tracking-tight ${isAiTitle ? "font-semibold text-[rgba(255,255,255,0.9)]" : "font-medium text-[rgba(255,255,255,0.6)]"}`}>
          {displayTitle}
        </span>

        {/* Semantic Extractions inline */}
        <div className="flex-[3] flex items-center gap-4 text-[12px] text-[rgba(255,255,255,0.5)] truncate">
          {isFailed ? (
            <span className="text-[var(--invoice-color)]">{document.summary || "Processing failed"}</span>
          ) : isInbox && document.movePlan ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.05)] text-[11px] font-medium text-[rgba(255,255,255,0.8)]">
              <span className="opacity-50">→</span> {document.movePlan.destination || "okänd"}
              <span className="h-1.5 w-1.5 rounded-full ml-1" style={{ backgroundColor: (document.classification?.confidence ?? 0) > 0.8 ? '#34C759' : '#FF9F0A' }} />
            </span>
          ) : hasExtractions ? (
            <>
              {vendor && <span className="truncate max-w-[120px] mix-blend-plus-lighter">{vendor}</span>}
              {amount && <span className="font-mono opacity-80">{amount}</span>}
              {date && <span className="font-mono opacity-60 text-[11px]">{date}</span>}
            </>
          ) : (
             <span className="truncate opacity-40">{document.title}</span>
          )}
        </div>

        {/* Time */}
        <span className="shrink-0 font-mono text-[10px] text-[rgba(255,255,255,0.3)] w-12 text-right">
          {timeLabel}
        </span>
      </div>



      {/* Row 3: search snippet */}
      {snippet && searchQuery && (
        <p className="mt-1.5 line-clamp-2 pl-[14px] text-sm italic leading-relaxed text-white/50">
          {highlightSnippet(snippet, searchQuery)}
        </p>
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
