import { useEffect, useMemo, useRef, useEffectEvent } from "react";

import { useSearch } from "../hooks/useSearch";
import { useDocumentStore } from "../store/documentStore";

type SourceChip = {
  id: string;
  title: string;
  indexedOnly: boolean;
};

function statusLabel(status: ReturnType<typeof useSearch>["searchState"]["status"]): string {
  switch (status) {
    case "loading":
      return "Searching";
    case "ready":
      return "Answer ready";
    case "empty":
      return "No hits";
    case "error":
      return "Search error";
    default:
      return "Copilot";
  }
}

export function SearchBar() {
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
      <label className="glass-panel flex items-center gap-3 px-4 py-3">
        <span className="text-base text-[var(--text-secondary)]">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask your docs anything..."
          aria-label="Search copilot"
          className="focus-ring w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <span className="hidden rounded-xl border border-black/10 bg-white/55 px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)] md:inline">
          ⌘K
        </span>
      </label>

      {showPanel ? (
        <div className="glass-panel space-y-3 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Search Copilot</p>
              <span className="rounded-full border border-black/10 bg-white/45 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                {statusLabel(searchState.status)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {searchState.status === "ready" && resultCount > 0 ? (
                <button
                  type="button"
                  className="focus-ring rounded-lg border border-black/10 bg-white/55 px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:bg-white/70"
                  onClick={() => {
                    document.getElementById("document-canvas")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                >
                  Show matched docs ({resultCount})
                </button>
              ) : null}
              {hasQuery ? (
                <button
                  type="button"
                  className="focus-ring rounded-lg border border-black/10 bg-white/55 px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:bg-white/70"
                  onClick={clearSearch}
                >
                  Clear query
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-black/5 bg-white/35 px-3.5 py-3">
            {searchState.status === "idle" && hasQuery ? (
              <p className="text-sm leading-6 text-[var(--text-secondary)]">Preparing search...</p>
            ) : null}
            {searchState.status === "loading" ? (
              <p className="text-sm leading-6 text-[var(--text-secondary)]">Scanning indexed documents for your query...</p>
            ) : null}
            {searchState.status === "ready" ? (
              <p className="text-sm leading-6 text-[var(--text-primary)]">
                {searchState.answer || `Found ${resultCount} matching documents.`}
              </p>
            ) : null}
            {searchState.status === "empty" ? (
              <p className="text-sm leading-6 text-[var(--text-secondary)]">
                No matches for this query yet. Try a broader term or a different date/vendor keyword.
              </p>
            ) : null}
            {searchState.status === "error" ? (
              <p className="text-sm leading-6 text-[var(--invoice-color)]">
                Search is temporarily unavailable. {searchState.error ? `(${searchState.error})` : ""}
              </p>
            ) : null}
          </div>

          {searchState.status === "ready" && sourceChips.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {sourceChips.map((chip) => (
                <span
                  key={`${chip.id}:${chip.title}`}
                  className={`glass-badge ${chip.indexedOnly ? "border-[rgba(255,159,10,0.24)] bg-[rgba(255,159,10,0.10)] text-[var(--meeting-color)]" : "bg-white/40 text-[var(--text-secondary)]"}`}
                >
                  {chip.indexedOnly ? "Indexed-only result" : "Source"}
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
