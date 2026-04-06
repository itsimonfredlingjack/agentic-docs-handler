import { useCallback, useState } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { batchDeleteDocuments, batchRetryDocuments, moveFilesToWorkspace } from "../lib/api";
import { useToastStore } from "../store/toastStore";
import { t } from "../lib/locale";
import type { UiDocument } from "../types/documents";

export function BulkActionBar() {
  const selectedIds = useDocumentStore((s) => s.selectedDocumentIds);
  const documents = useDocumentStore((s) => s.documents);
  const clearSelection = useDocumentStore((s) => s.clearSelection);
  const removeDocuments = useDocumentStore((s) => s.removeDocuments);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const showToast = useToastStore((s) => s.show);
  const [busy, setBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const count = selectedIds.size;
  if (count === 0) return null;

  const selectedDocs: UiDocument[] = [];
  for (const id of selectedIds) {
    const doc = documents[id];
    if (doc) selectedDocs.push(doc);
  }

  const retryableCount = selectedDocs.filter(
    (d) => d.retryable && d.status === "pending_classification",
  ).length;

  const nonInboxWorkspaces = workspaces.filter((w) => !w.is_inbox && w.id !== activeWorkspaceId);

  const handleDelete = useCallback(async () => {
    if (!window.confirm(t("bulk.confirm_delete").replace("{count}", String(count)))) return;
    setBusy(true);
    try {
      const ids = [...selectedIds];
      const result = await batchDeleteDocuments(ids);
      removeDocuments(ids.filter((_, i) => i < result.succeeded));
      if (result.failed > 0) {
        showToast(t("bulk.deleted_partial").replace("{succeeded}", String(result.succeeded)).replace("{failed}", String(result.failed)), "error");
      } else {
        showToast(t("bulk.deleted_success").replace("{count}", String(result.succeeded)), "success");
      }
      clearSelection();
    } catch {
      showToast(t("bulk.delete_error"), "error");
    } finally {
      setBusy(false);
    }
  }, [selectedIds, count, removeDocuments, clearSelection, showToast]);

  const handleRetry = useCallback(async () => {
    setBusy(true);
    try {
      const retryableIds = selectedDocs
        .filter((d) => d.retryable && d.status === "pending_classification")
        .map((d) => d.id);
      const result = await batchRetryDocuments(retryableIds);
      if (result.succeeded > 0) {
        showToast(t("bulk.retried_success").replace("{count}", String(result.succeeded)), "success");
      }
      if (result.failed > 0) {
        showToast(t("bulk.retry_failed").replace("{count}", String(result.failed)), "error");
      }
      clearSelection();
    } catch {
      showToast(t("bulk.retry_error"), "error");
    } finally {
      setBusy(false);
    }
  }, [selectedDocs, clearSelection, showToast]);

  const handleMove = useCallback(async (targetWorkspaceId: string) => {
    setBusy(true);
    setMoveOpen(false);
    try {
      const ids = [...selectedIds];
      const result = await moveFilesToWorkspace(targetWorkspaceId, ids);
      showToast(t("bulk.moved_success").replace("{count}", String(result.moved)), "success");
      clearSelection();
    } catch {
      showToast(t("bulk.move_error"), "error");
    } finally {
      setBusy(false);
    }
  }, [selectedIds, clearSelection, showToast]);

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--accent-surface)] bg-[var(--accent-surface)]">
      <span className="text-sm-ui font-semibold text-[var(--accent-primary)]">
        {count} {t("bulk.selected")}
      </span>

      <button
        type="button"
        className="text-xs-ui text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        onClick={clearSelection}
      >
        {t("bulk.clear")}
      </button>

      <span className="flex-1" />

      {/* Move */}
      <div className="relative">
        <button
          type="button"
          className="action-secondary px-3 py-1 text-xs-ui"
          disabled={busy}
          onClick={() => setMoveOpen(!moveOpen)}
        >
          {t("bulk.move")}
        </button>
        {moveOpen && (
          <div className="absolute right-0 top-full mt-1 z-30 min-w-[180px] rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] py-1 shadow-lg">
            {nonInboxWorkspaces.length === 0 ? (
              <div className="px-3 py-2 text-xs-ui text-[var(--text-muted)]">{t("bulk.no_workspaces")}</div>
            ) : (
              nonInboxWorkspaces.map((ws) => (
                <button
                  key={ws.id}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm-ui text-[var(--text-secondary)] hover:bg-[var(--surface-6)] transition-colors"
                  onClick={() => handleMove(ws.id)}
                >
                  {ws.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Retry */}
      {retryableCount > 0 && (
        <button
          type="button"
          className="action-secondary px-3 py-1 text-xs-ui"
          disabled={busy}
          onClick={handleRetry}
        >
          {t("bulk.retry")} ({retryableCount})
        </button>
      )}

      {/* Delete */}
      <button
        type="button"
        className="action-secondary px-3 py-1 text-xs-ui text-[var(--invoice-color)] hover:bg-[rgba(var(--invoice-color-rgb),0.1)]"
        disabled={busy}
        onClick={handleDelete}
      >
        {t("bulk.delete")}
      </button>
    </div>
  );
}
