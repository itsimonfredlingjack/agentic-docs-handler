import { useSearch } from "../hooks/useSearch";
import { useEffect, useRef, useEffectEvent } from "react";

export function TopBar({ onDropClick }: { onDropClick: () => void }) {
  const { query, setQuery, searchState, clearSearch } = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      inputRef.current?.focus();
    }
    if (event.key === "Escape") {
      clearSearch();
      inputRef.current?.blur();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  return (
    <header className="flex items-center gap-3 px-5 py-3">
      <label className="glass-panel flex flex-1 items-center gap-3 px-4 py-2.5">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[var(--text-secondary)]">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search documents..."
          aria-label="Search documents"
          className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <span className="hidden rounded-lg border border-black/5 bg-white/50 px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)] md:inline">
          ⌘K
        </span>
      </label>

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

      {searchState.active && searchState.answer ? (
        <div className="glass-panel absolute left-5 right-5 top-[calc(var(--topbar-height)+0.5rem)] z-30 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Smart search</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-primary)]">
            {searchState.loading ? "Searching documents..." : searchState.answer}
          </p>
        </div>
      ) : null}
    </header>
  );
}
