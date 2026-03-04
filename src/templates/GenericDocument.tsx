import type { SearchResult, UiDocument } from "../types/documents";

type GenericDocumentProps = {
  document: UiDocument;
  searchResult?: SearchResult;
};

export function GenericDocument({ document, searchResult }: GenericDocumentProps) {
  const tags = document.tags.length > 0 ? document.tags : Object.keys(document.extraction?.fields ?? {});

  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Document</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{document.title}</h3>
        </div>
        <span className="glass-badge border-[rgba(142,142,147,0.22)] bg-[rgba(142,142,147,0.10)] text-[var(--text-secondary)]">
          <span className="status-dot bg-[var(--report-color)]" />
          {document.kind}
        </span>
      </div>

      <p className="text-sm leading-6 text-[var(--text-secondary)]">
        {searchResult?.snippet ?? document.summary}
      </p>

      {searchResult ? (
        <div className="rounded-2xl bg-white/45 p-3 text-sm font-mono text-[var(--text-secondary)]">
          <p>{searchResult.source_path}</p>
          <p className="mt-1">score {searchResult.score.toFixed(3)}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {tags.slice(0, 5).map((tag) => (
          <span key={tag} className="glass-badge text-[var(--text-secondary)]">
            <span className="status-dot bg-[var(--report-color)]" />
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}
