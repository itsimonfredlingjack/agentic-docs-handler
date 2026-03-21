import { useEffect, useMemo, useRef, useEffectEvent } from "react";
import Markdown from "react-markdown";

import { useSearch } from "../hooks/useSearch";
import { useSearchAiSummary } from "../hooks/useSearchAiSummary";
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
  const { summary, askAi, resetAiSummary } = useSearchAiSummary();
  const inputRef = useRef<HTMLInputElement>(null);

  const hasQuery = query.trim().length > 0;
  const resultCount = searchState.resultIds.length + searchState.orphanResults.length;
  const showPanel = hasQuery || searchState.status !== "idle";

  // Reset AI summary when search is cleared or query changes
  useEffect(() => {
    if (!hasQuery) resetAiSummary();
  }, [hasQuery, resetAiSummary]);

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
      resetAiSummary();
      inputRef.current?.blur();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onKeyDown]);

  const handleClear = () => {
    setQuery("");
    clearSearch();
    resetAiSummary();
  };

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
            placeholder="Sök i dokument..."
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
              {searchState.status === "ready" && resultCount > 0 && summary.status === "idle" ? (
                <button
                  type="button"
                  className="focus-ring action-secondary px-2.5 py-1 text-xs"
                  onClick={() => void askAi(query)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="mr-1 inline-block -mt-px">
                    <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5.5L3 13.5V11H3a1 1 0 0 1-1-1V3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M5.5 5.5h5M5.5 7.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  Fråga AI
                </button>
              ) : null}
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
                  onClick={handleClear}
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

          {/* AI Summary */}
          {summary.status !== "idle" ? (
            <div className="search-ai-summary control-card p-3">
              <p className="section-kicker text-[var(--accent-primary)]">AI-svar</p>
              {summary.status === "streaming" && !summary.text && (
                <div className="notebook-entry__thinking mt-2">
                  <span className="notebook-thinking-dot" />
                  <span className="notebook-thinking-dot" />
                  <span className="notebook-thinking-dot" />
                </div>
              )}
              {summary.text && (
                <div className="notebook-prose mt-2 text-sm">
                  <Markdown>{summary.text}</Markdown>
                  {summary.status === "streaming" && (
                    <span className="notebook-cursor">{"\u2588"}</span>
                  )}
                </div>
              )}
              {summary.status === "error" && summary.errorMessage && (
                <p className="mt-2 text-sm text-[var(--invoice-color)]">{summary.errorMessage}</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
