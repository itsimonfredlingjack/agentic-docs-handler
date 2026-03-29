import { mapToUserStatus, userStatusColor, userStatusLabel } from "../lib/status";
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

  const isFailed = userStatus === "misslyckades";
  const isReview = userStatus === "behöver_granskas";
  const isProcessing = userStatus === "uppladdad" || userStatus === "bearbetas";
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
      className={`document-row animate-fade-in-up flex flex-col justify-center px-4 py-2.5 transition-colors border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.03)] ${modifierClass} ${focused ? "bg-[rgba(255,255,255,0.06)] border-l-2 border-l-[var(--type-accent)]" : "border-l-2 border-l-transparent"}`}
      style={{ "--type-color-rgb": `var(${kindRgbVar(document.kind)})`, "--type-accent": kindColor(document.kind) } as React.CSSProperties}
      onClick={isClickable ? onSelect : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      data-testid="document-row"
    >
      <div className="flex items-center gap-3">
        {/* Type Icon Dot */}
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: kindColor(document.kind) }}
        />

        {/* Title */}
        <span className={`min-w-0 flex-[2] truncate text-[13px] tracking-tight ${isAiTitle ? "font-semibold text-[rgba(255,255,255,0.9)]" : "font-medium text-[rgba(255,255,255,0.55)]"}`}>
          {displayTitle}
        </span>

        {/* Semantic Extractions inline */}
        <div className="flex-[3] flex items-center gap-4 text-[12px] text-[rgba(255,255,255,0.5)] truncate">
          {isFailed ? (
            <span className="text-[var(--invoice-color)]">{document.summary || "Processing failed"}</span>
          ) : isInbox && document.movePlan ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] text-[11px] font-medium text-[rgba(255,255,255,0.75)]">
              <span className="opacity-40">→</span> {document.movePlan.destination || "unknown"}
              {focused && <kbd className="ml-1.5 text-[9px] font-mono text-[rgba(255,255,255,0.3)] bg-[rgba(255,255,255,0.06)] px-1 rounded">↵</kbd>}
            </span>
          ) : hasExtractions ? (
            <>
              {vendor && <span className="truncate max-w-[120px]">{vendor}</span>}
              {amount && <span className="font-mono opacity-80">{amount}</span>}
              {date && <span className="font-mono opacity-60 text-[11px]">{date}</span>}
            </>
          ) : (
             <span className="truncate opacity-40">{document.title}</span>
          )}
        </div>

        {/* Status */}
        <span className="shrink-0 flex items-center gap-1.5 w-16 justify-end">
          {isProcessing ? (
            <>
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-40" style={{ backgroundColor: statusColor }} />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ backgroundColor: statusColor }} />
              </span>
              <span className="text-[10px] font-mono" style={{ color: statusColor }}>{userStatusLabel(userStatus)}</span>
            </>
          ) : isFailed ? (
            <span className="text-[10px] font-semibold font-mono" style={{ color: statusColor }}>{userStatusLabel(userStatus)}</span>
          ) : isReview ? (
            <span className="text-[10px] font-semibold font-mono" style={{ color: statusColor }}>{userStatusLabel(userStatus)}</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full" style={{ backgroundColor: statusColor }} />
              <span className="text-[10px] font-mono text-[rgba(255,255,255,0.3)]">{userStatusLabel(userStatus)}</span>
            </span>
          )}
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
