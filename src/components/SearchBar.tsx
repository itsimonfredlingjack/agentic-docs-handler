import { useEffect, useRef, useEffectEvent } from "react";

import { useSearch } from "../hooks/useSearch";

export function SearchBar() {
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
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onKeyDown]);

  return (
    <div className="space-y-3">
      <label className="glass-panel flex items-center gap-3 px-4 py-3">
        <span className="text-base text-[var(--text-secondary)]">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Vad letar du efter?"
          className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <span className="rounded-xl border border-black/5 bg-white/50 px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)]">
          ⌘K
        </span>
      </label>
      {searchState.active && searchState.answer ? (
        <div className="glass-panel px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Smart search</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-primary)]">
            {searchState.loading ? "Söker i dokumenten..." : searchState.answer}
          </p>
        </div>
      ) : null}
    </div>
  );
}
