import { useEffect } from "react";
import { createPortal } from "react-dom";

const shortcuts = [
  { keys: "⌘ K", description: "Search documents" },
  { keys: "/ ...", description: "Open command palette" },
  { keys: "↑ ↓", description: "Navigate document list" },
  { keys: "← →", description: "Navigate cards (card view)" },
  { keys: "Escape", description: "Clear search / close" },
  { keys: "⌘ N", description: "Add files" },
  { keys: "⌘ /", description: "Show this help" },
];

export function ShortcutHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div className="glass-panel relative z-10 w-[min(380px,90vw)] p-5" style={{ animation: "detail-fade-in 200ms ease" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[var(--text-primary)]">Keyboard Shortcuts</h2>
          <button
            type="button"
            className="focus-ring rounded-lg p-1 text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.keys} className="flex items-center justify-between gap-4">
              <span className="text-sm text-[var(--text-secondary)]">{shortcut.description}</span>
              <kbd className="shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--btn-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                {shortcut.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
