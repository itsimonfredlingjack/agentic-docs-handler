import { useSearch } from "../hooks/useSearch";
import { useDocumentStore } from "../store/documentStore";
import { useEffect, useRef, useEffectEvent } from "react";

import { CommandPalette } from "./CommandPalette";

const CONNECTION_META: Record<string, { color: string; label: string }> = {
  connected: { color: "var(--receipt-color)", label: "Connected" },
  connecting: { color: "var(--meeting-color)", label: "Connecting..." },
  reconnecting: { color: "var(--meeting-color)", label: "Reconnecting..." },
  disconnected: { color: "var(--invoice-color)", label: "Disconnected" },
};

export type ViewMode = "tinder" | "split";

export function TopBar({
  onDropClick,
  viewMode,
  onToggleView,
  onShowShortcuts,
  onToggleActivity,
  activityOpen,
}: {
  onDropClick: () => void;
  viewMode: ViewMode;
  onToggleView: () => void;
  onShowShortcuts: () => void;
  onToggleActivity: () => void;
  activityOpen: boolean;
}) {
  const hasDocuments = useDocumentStore((s) => s.documentOrder.length > 0);
  const connectionState = useDocumentStore((s) => s.connectionState);
  const { query, setQuery, searchState, clearSearch } = useSearch();
  const connMeta = CONNECTION_META[connectionState] ?? CONNECTION_META.disconnected;
  const inputRef = useRef<HTMLInputElement>(null);

  const isCommandMode = query.startsWith("/");
  const commandQuery = isCommandMode ? query.slice(1) : "";

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      inputRef.current?.focus();
    }
    if (event.key === "Escape") {
      if (isCommandMode) {
        setQuery("");
      } else {
        clearSearch();
      }
      inputRef.current?.blur();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  return (
    <header className="flex items-center gap-3 px-5 py-3">
      <span
        className="status-dot shrink-0"
        style={{ backgroundColor: connMeta.color }}
        title={connMeta.label}
        aria-label={connMeta.label}
      />
      <label className="glass-panel flex flex-1 items-center gap-3 px-4 py-2.5">
        {isCommandMode ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[var(--accent-primary)]">
            <path d="M4 4l8 8M4 12l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[var(--text-secondary)]">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={isCommandMode ? "Type a command..." : "Search documents... (/ for commands)"}
          aria-label={isCommandMode ? "Command palette" : "Search documents"}
          className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <span className="hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--btn-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)] md:inline">
          ⌘K
        </span>
      </label>

      {hasDocuments && (
        <div className="flex overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)]">
          <button
            type="button"
            className={`focus-ring p-2 transition ${viewMode === "tinder" ? "bg-[var(--btn-bg-active)]" : "hover:bg-[var(--btn-bg)]"}`}
            onClick={viewMode !== "tinder" ? onToggleView : undefined}
            aria-label="Card view"
            aria-pressed={viewMode === "tinder"}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-[var(--text-secondary)]">
              <rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          <button
            type="button"
            className={`focus-ring p-2 transition ${viewMode === "split" ? "bg-[var(--btn-bg-active)]" : "hover:bg-[var(--btn-bg)]"}`}
            onClick={viewMode !== "split" ? onToggleView : undefined}
            aria-label="Split view"
            aria-pressed={viewMode === "split"}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-[var(--text-secondary)]">
              <rect x="1" y="2" width="5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <rect x="8" y="2" width="5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        </div>
      )}

      <button
        type="button"
        className={`focus-ring glass-panel p-2.5 transition-all duration-150 hover:bg-[var(--glass-bg-hover)] ${
          activityOpen ? "text-[var(--accent-primary)]" : "text-[var(--text-muted)]"
        }`}
        onClick={onToggleActivity}
        aria-label="Toggle activity feed"
        aria-pressed={activityOpen}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>

      <button
        type="button"
        className="focus-ring glass-panel flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-[var(--accent-primary)] transition-all duration-150 hover:bg-[var(--glass-bg-hover)]"
        onClick={onDropClick}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">Add files</span>
      </button>

      {isCommandMode ? (
        <CommandPalette
          commandQuery={commandQuery}
          onClose={() => { setQuery(""); inputRef.current?.blur(); }}
          onAddFiles={onDropClick}
          onToggleView={onToggleView}
          onShowShortcuts={onShowShortcuts}
        />
      ) : searchState.active && searchState.answer ? (
        <div className="glass-panel absolute left-5 right-5 top-[calc(var(--topbar-height)+0.5rem)] z-30 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Smart search</p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-primary)]">
                {searchState.loading ? "Searching documents..." : searchState.answer}
              </p>
            </div>
            <button
              type="button"
              className="focus-ring shrink-0 rounded-lg p-1 text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
              onClick={() => { setQuery(""); clearSearch(); }}
              aria-label="Close search results"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
