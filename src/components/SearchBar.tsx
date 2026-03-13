import { useEffect, useMemo, useRef, useEffectEvent } from "react";

import { useSearch } from "../hooks/useSearch";
import { useDocumentStore } from "../store/documentStore";

type SourceChip = {
  id: string;
  title: string;
  indexedOnly: boolean;
};

function statusLabel(status: ReturnType<typeof useSearch>["searchState"]["status"], resultCount: number): string {
  switch (status) {
    case "loading":
      return "Söker...";
    case "ready":
      return resultCount > 0 ? `${resultCount} träffar` : "Inga träffar";
    case "empty":
      return "Inga träffar";
    case "error":
      return "Sökfel";
    default:
      return "Sök";
  }
}

type SearchBarProps = {
  activeFilterLabel: string;
  onOpenFilters: () => void;
};

export function SearchBar({ activeFilterLabel, onOpenFilters }: SearchBarProps) {
  const documents = useDocumentStore((state) => state.documents);
  const { query, setQuery, searchState, clearSearch } = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);

  const hasQuery = query.trim().length > 0;
  const resultCount = searchState.resultIds.length + searchState.orphanResults.length;
  const showPanel = hasQuery || searchState.status !== "idle";

  const sourceChips = useMemo<SourceChip[]>(() => {
    if (searchState.status !== "ready") {
      return [];
    }
    const inMemoryResults = searchState.resultIds
      .map((id) => documents[id])
      .filter(Boolean)
      .map((document) => ({
        id: document.id,
        title: document.title,
        indexedOnly: false,
      }));
    const orphanResults = searchState.orphanResults.map((result) => ({
      id: result.doc_id,
      title: result.title,
      indexedOnly: true,
    }));
    return [...inMemoryResults, ...orphanResults].slice(0, 6);
  }, [documents, searchState.orphanResults, searchState.resultIds, searchState.status]);

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
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <label className="command-panel flex min-h-14 flex-1 items-center gap-4 px-4 py-3">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--text-muted)]"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Fråga dina dokument..."
            aria-label="Sök i dokument"
            className="focus-ring w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <span className="hidden rounded-xl border border-white/8 bg-white/6 px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)] md:inline">
            ⌘K · /
          </span>
        </label>
        <button
          type="button"
          className="focus-ring action-secondary h-14 shrink-0 px-3 text-xs lg:hidden"
          onClick={onOpenFilters}
          aria-label="Öppna filter"
        >
          Filter: {activeFilterLabel}
        </button>
      </div>

      {showPanel ? (
        <div className="glass-panel space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="section-kicker">Sökresultat</p>
              <span className="rounded-full border border-white/8 bg-white/4 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                {statusLabel(searchState.status, resultCount)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {searchState.status === "ready" && resultCount > 0 ? (
                <button
                  type="button"
                  className="focus-ring action-secondary px-2.5 py-1 text-xs"
                  onClick={() => {
                    document.getElementById("document-canvas")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                >
                  Visa träffar
                </button>
              ) : null}
              {hasQuery ? (
                <button
                  type="button"
                  className="focus-ring action-secondary px-2.5 py-1 text-xs"
                  onClick={clearSearch}
                >
                  Rensa
                </button>
              ) : null}
            </div>
          </div>

          {searchState.status === "error" ? (
            <p className="text-sm leading-6 text-[var(--invoice-color)]">
              Söktjänsten är tillfälligt otillgänglig. {searchState.error ? `(${searchState.error})` : ""}
            </p>
          ) : null}
          {searchState.status === "empty" ? (
            <p className="text-sm leading-6 text-[var(--text-secondary)]">
              Inga matchningar. Testa bredare sökord eller annan leverantör/datum.
            </p>
          ) : null}

          {searchState.status === "ready" && sourceChips.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {sourceChips.map((chip) => (
                <span
                  key={`${chip.id}:${chip.title}`}
                  className={`glass-badge ${chip.indexedOnly ? "border-[rgba(255,159,10,0.24)] bg-[rgba(255,159,10,0.10)] text-[var(--meeting-color)]" : "bg-white/6 text-[var(--text-secondary)]"}`}
                >
                  {chip.indexedOnly ? "Endast i index" : "Källa"}
                  {" · "}
                  {chip.title}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
