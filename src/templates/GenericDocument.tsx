import type { SearchResult, UiDocument } from "../types/documents";

type GenericDocumentProps = {
  document: UiDocument;
  searchResult?: SearchResult;
};

export function GenericDocument({ document, searchResult }: GenericDocumentProps) {
  const visibleWarnings = document.warnings.filter((warning) => !isInternalPipelineFlag(warning));
  const isFallbackUnknown =
    document.kind === "generic" &&
    document.diagnostics?.pipeline_flags.some((flag) => flag === "classifier_invalid_json_fallback");
  const badgeLabel = isFallbackUnknown ? "unknown" : document.kind;

  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-1">{document.title}</h3>
        <span className="glass-badge shrink-0 text-[var(--text-secondary)]" style={{ borderColor: "rgba(142,142,147,0.22)", backgroundColor: "rgba(142,142,147,0.10)" }}>
          <span className="status-dot bg-[var(--report-color)]" />
          {badgeLabel}
        </span>
      </div>
      <p className="text-sm text-[var(--text-secondary)] line-clamp-1">
        {searchResult?.snippet ?? document.summary}
      </p>
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
