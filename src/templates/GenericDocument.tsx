import type { SearchResult, UiDocument } from "../types/documents";

type GenericDocumentProps = {
  document: UiDocument;
  searchResult?: SearchResult;
  indexedOnly?: boolean;
};

export function GenericDocument({ document, searchResult, indexedOnly = false }: GenericDocumentProps) {
  const visibleWarnings = document.warnings.filter((warning) => !isInternalPipelineFlag(warning));
  const isFallbackUnknown =
    document.kind === "generic" &&
    document.diagnostics?.pipeline_flags.some((flag) => flag === "classifier_invalid_json_fallback");
  const badgeLabel = isFallbackUnknown ? "unknown" : document.kind;

  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Document</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)] line-clamp-2">{document.title}</h3>
        </div>
        <span className="glass-badge shrink-0 text-[var(--text-secondary)]" style={{ borderColor: "rgba(142,142,147,0.22)", backgroundColor: "rgba(142,142,147,0.10)" }}>
          <span className="status-dot bg-[var(--report-color)]" />
          {badgeLabel}
        </span>
      </div>
      <p className="text-sm leading-6 text-[var(--text-secondary)] line-clamp-3">
        {searchResult?.snippet ?? document.summary}
      </p>
      {indexedOnly ? (
        <p className="w-fit rounded-full border border-[rgba(255,159,10,0.24)] bg-[rgba(255,159,10,0.10)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--meeting-color)]">
          Indexed-only result
        </p>
      ) : null}
      {visibleWarnings.length > 0 ? (
        <p className="text-xs text-[var(--meeting-color)]">{visibleWarnings.join(", ")}</p>
      ) : null}
    </article>
  );
}

function isInternalPipelineFlag(value: string): boolean {
  const candidate = value.trim().toLowerCase();
  return candidate.startsWith("classifier_") || candidate.startsWith("pdf_") || candidate.endsWith("_fallback");
}
