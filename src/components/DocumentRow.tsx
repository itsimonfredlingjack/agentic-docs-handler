import { memo } from "react";
import { mapToUserStatus, userStatusColor, userStatusLabel } from "../lib/status";
import { kindRgbVar, kindColor } from "../lib/document-colors";
import { highlightSnippet } from "../lib/highlight-snippet";
import { t } from "../lib/locale";
import type { UiDocument } from "../types/documents";
import { Button } from "./ui/Button";

type Props = {
  document: UiDocument;
  focused?: boolean;
  selected?: boolean;
  snippet?: string;
  searchQuery?: string;
  onSelectId?: (id: string) => void;
  onToggleSelect?: (id: string) => void;
  onRetry?: () => void;
  onUndo?: () => void;
  onMoveToWorkspace?: (documentId: string) => void;
  isInbox?: boolean;
};


export const DocumentRow = memo(function DocumentRow({ document, focused, selected, snippet, searchQuery, onSelectId, onToggleSelect, onRetry, onUndo, onMoveToWorkspace, isInbox }: Props) {
  const userStatus = mapToUserStatus(document);
  const statusColor = userStatusColor(userStatus);

  const isFailed = userStatus === "misslyckades";
  const isPending = userStatus === "väntar";
  const isReview = userStatus === "behöver_granskas";
  const isProcessing = userStatus === "uppladdad" || userStatus === "bearbetas";
  const isClickable = userStatus !== "uppladdad";

  const displayTitle = document.classification?.title || document.title;
  const isAiTitle = !!document.classification?.title;

  const modifierClass = isFailed
    ? "document-row--failed"
    : isPending
      ? "document-row--pending"
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
      className={`document-row animate-fade-in-up flex flex-col justify-center px-4 py-2.5 transition-colors border-b border-[var(--surface-4)] hover:bg-[var(--surface-4)] ${modifierClass} ${focused ? "bg-[var(--surface-6)] border-l-2 border-l-[var(--type-accent)]" : "border-l-2 border-l-transparent"} ${selected ? "bg-[var(--accent-surface)]" : ""}`}
      style={{ "--type-color-rgb": `var(${kindRgbVar(document.kind)})`, "--type-accent": kindColor(document.kind) } as React.CSSProperties}
      onClick={isClickable ? (e) => {
        if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
          onToggleSelect(document.id);
        } else if (onSelectId) {
          onSelectId(document.id);
        }
      } : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      data-testid="document-row"
    >
      <div className="flex items-center gap-3">
        {/* Type dot / selection checkbox */}
        {selected ? (
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-[var(--accent-primary)] text-white text-[9px] leading-none font-bold">
            ✓
          </span>
        ) : (
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: kindColor(document.kind) }}
          />
        )}

        {/* Title */}
        <span className={`min-w-0 flex-[2] truncate text-base-ui tracking-tight ${isAiTitle ? "font-semibold text-[var(--text-primary)]" : "font-medium text-[var(--text-secondary)]"}`}>
          {displayTitle}
        </span>

        {/* Semantic Extractions inline */}
        <div className="flex-[3] flex items-center gap-4 text-sm-ui text-[var(--text-secondary)] truncate">
          {isFailed ? (
            <span className="text-[var(--invoice-color)]">{document.summary || t("doc.failed_default")}</span>
          ) : isInbox && document.movePlan ? (
            <span className="flex items-center gap-1.5">
              <span className="truncate max-w-[160px] text-xs-ui text-[var(--text-muted)]">
                {document.movePlan.destination?.split("/").pop() || t("extraction.no_details")}
              </span>
              {onMoveToWorkspace && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0 px-2 py-0.5 text-xs-ui"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveToWorkspace(document.id);
                  }}
                >
                  {t("action.move")}
                </Button>
              )}
              {focused && <kbd className="ml-1 text-xs-ui font-mono text-[var(--text-disabled)] bg-[var(--surface-6)] px-1 rounded">↵</kbd>}
            </span>
          ) : hasExtractions ? (
            <>
              {vendor && <span className="truncate max-w-[120px]">{vendor}</span>}
              {amount && <span className="font-mono opacity-80">{amount}</span>}
              {date && <span className="font-mono opacity-60 text-sm-ui">{date}</span>}
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
              <span className="text-xs-ui font-mono" style={{ color: statusColor }}>{userStatusLabel(userStatus)}</span>
            </>
          ) : isFailed ? (
            <span className="text-xs-ui font-semibold font-mono" style={{ color: statusColor }}>{userStatusLabel(userStatus)}</span>
          ) : isReview ? (
            <span className="text-xs-ui font-semibold font-mono" style={{ color: statusColor }}>{userStatusLabel(userStatus)}</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full" style={{ backgroundColor: statusColor }} />
              <span className="text-xs-ui font-mono text-[var(--text-disabled)]">{userStatusLabel(userStatus)}</span>
            </span>
          )}
        </span>
      </div>



      {/* Row 3: search snippet */}
      {snippet && searchQuery && (
        <p className="mt-1.5 line-clamp-2 pl-[14px] text-base-ui italic leading-relaxed text-[var(--text-secondary)]">
          {highlightSnippet(snippet, searchQuery)}
        </p>
      )}

      {/* Undo move */}
      {document.moveStatus === "moved" && document.undoToken && onUndo && (
        <div className="mt-2 flex items-center justify-between gap-2 pl-[14px]">
          <span className="text-xs text-[var(--text-muted)]">
            {document.moveResult?.from_path
              ? `${t("doc.moved_from")} ${document.moveResult.from_path.split("/").pop()}`
              : t("doc.moved_from")}
          </span>
          <button
            type="button"
            className="action-secondary shrink-0 px-3 py-1 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onUndo();
            }}
          >
            {t("doc.undo_move")}
          </button>
        </div>
      )}

      {/* Pending state — accepted but waiting for AI */}
      {isPending && (
        <div className="mt-2 flex items-center justify-between gap-2 pl-[14px]">
          <span className="text-xs text-[var(--meeting-color)]">
            {t("doc.pending_message")}
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
              {t("common.retry")}
            </button>
          )}
        </div>
      )}

      {/* Failed state */}
      {isFailed && (
        <div className="mt-2 flex items-center justify-between gap-2 pl-[14px]">
          <span className="text-xs text-[var(--invoice-color)]">
            {document.summary || t("doc.failed_default")}
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
              {t("common.retry")}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
