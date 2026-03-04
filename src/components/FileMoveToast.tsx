import { useEffect } from "react";

import { undoMove } from "../lib/api";
import { useDocumentStore } from "../store/documentStore";

export function FileMoveToast() {
  const toasts = useDocumentStore((state) => state.toasts);
  const clientId = useDocumentStore((state) => state.clientId);
  const dismissToast = useDocumentStore((state) => state.dismissToast);
  const applyUndoSuccess = useDocumentStore((state) => state.applyUndoSuccess);

  useEffect(() => {
    const timers = toasts.map((toast) =>
      window.setTimeout(() => {
        dismissToast(toast.id);
      }, 6000),
    );
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [dismissToast, toasts]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[min(360px,90vw)] flex-col gap-3">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast-panel pointer-events-auto flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">File moved</p>
            <p className="mt-1 text-xs font-mono text-[var(--text-secondary)]">{toast.fromPath}</p>
            <p className="mt-1 text-xs font-mono text-[var(--text-primary)]">→ {toast.toPath}</p>
          </div>
          <button
            type="button"
            className="rounded-xl border border-black/5 bg-white/60 px-3 py-2 text-xs font-semibold text-[var(--accent-primary)] transition hover:bg-white/80"
            onClick={async () => {
              if (!clientId) {
                return;
              }
              const payload = await undoMove(toast.undoToken, clientId);
              applyUndoSuccess(payload);
              dismissToast(toast.id);
            }}
          >
            Undo
          </button>
        </div>
      ))}
    </div>
  );
}
