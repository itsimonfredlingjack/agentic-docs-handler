import type { UiDocument, UiDocumentKind } from "../types/documents";

function getKindAccent(kind: UiDocumentKind): string {
  switch (kind) {
    case "receipt": return "var(--receipt-color)";
    case "contract": return "var(--contract-color)";
    case "invoice": return "var(--invoice-color)";
    case "meeting_notes": return "var(--meeting-color)";
    case "audio": return "var(--audio-color)";
    default: return "var(--report-color)";
  }
}

function formatKindLabel(kind: UiDocumentKind): string {
  switch (kind) {
    case "meeting_notes": return "Meeting Notes";
    case "file_moved": return "Moved";
    default: return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

function formatFieldKey(key: string): string {
  return key.replace(/_/g, " ");
}

function formatFileSize(mimeType: string): string {
  return mimeType;
}

// --- Source section ---
export function DetailPaneSource({ document }: { document: UiDocument }) {
  const accent = getKindAccent(document.kind);
  return (
    <section className="detail-section">
      <div className="flex items-center gap-3">
        <span
          className="glass-badge"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
        >
          <span className="status-dot" style={{ backgroundColor: accent, width: 6, height: 6 }} />
          {formatKindLabel(document.kind)}
        </span>
        {document.classification.confidence > 0 && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {Math.round(document.classification.confidence * 100)}% confidence
          </span>
        )}
      </div>
      <h2 className="mt-3 text-lg font-bold text-[var(--text-primary)]">{document.title}</h2>
      {document.summary && (
        <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{document.summary}</p>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-muted)]">
        {document.sourcePath && (
          <span className="truncate font-mono">{document.sourcePath.split("/").pop()}</span>
        )}
        <span>{formatFileSize(document.mimeType)}</span>
      </div>
    </section>
  );
}

// --- Extraction section (THE HERO) ---
export function DetailPaneExtraction({ document }: { document: UiDocument }) {
  const fields = document.extraction?.fields ?? {};
  const fieldConfidence = document.extraction?.field_confidence ?? {};
  const fieldEntries = Object.entries(fields).filter(
    ([, value]) => value !== null && typeof value !== "undefined" && value !== "",
  );

  if (fieldEntries.length === 0) return null;

  return (
    <section className="detail-section">
      <p className="detail-section-label">AI Extraction</p>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
        {fieldEntries.map(([key, value]) => (
          <div key={key}>
            <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              {formatFieldKey(key)}
            </p>
            <p className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">
              {String(value)}
            </p>
            {fieldConfidence[key] != null && fieldConfidence[key] > 0 && (
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/5">
                <div
                  className="h-full rounded-full bg-[var(--accent-primary)]"
                  style={{ width: `${Math.round(fieldConfidence[key] * 100)}%`, opacity: 0.6 }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Transcription section ---
export function DetailPaneTranscription({ document }: { document: UiDocument }) {
  const hasTranscription =
    document.transcription?.text &&
    (document.kind === "audio" || document.kind === "meeting_notes");

  if (!hasTranscription) return null;

  return (
    <section className="detail-section">
      <p className="detail-section-label">Transcription</p>
      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
        {document.transcription!.text.length > 800
          ? `${document.transcription!.text.slice(0, 800)}...`
          : document.transcription!.text}
      </p>
    </section>
  );
}

// --- Organized (move) section ---
export function DetailPaneOrganized({ document }: { document: UiDocument }) {
  if (!document.movePlan?.destination && document.moveStatus === "not_requested") return null;

  return (
    <section className="detail-section">
      <p className="detail-section-label">Organization</p>
      <div className="mt-2 space-y-2">
        {document.movePlan?.destination && (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-[var(--text-muted)]">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 4.5V12h12V5.5H7L5.5 4H1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="break-all font-mono text-xs text-[var(--text-secondary)]">
              {document.movePlan.destination}
            </span>
          </div>
        )}
        {document.movePlan?.rule_name && (
          <p className="text-xs text-[var(--text-muted)]">
            Rule: <span className="text-[var(--text-secondary)]">{document.movePlan.rule_name}</span>
          </p>
        )}
        <p className="text-xs text-[var(--text-muted)]">
          Status: <span className="text-[var(--text-secondary)]">{document.moveStatus.replace(/_/g, " ")}</span>
        </p>
      </div>
    </section>
  );
}

// --- Tags section ---
export function DetailPaneTags({ document }: { document: UiDocument }) {
  if (document.tags.length === 0) return null;

  return (
    <section className="detail-section">
      <p className="detail-section-label">Tags</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {document.tags.map((tag) => (
          <span key={tag} className="glass-badge bg-white/30 text-[var(--text-secondary)]">
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}

// --- Warnings section ---
export function DetailPaneWarnings({ document }: { document: UiDocument }) {
  if (document.warnings.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[rgba(255,159,10,0.18)] bg-[rgba(255,159,10,0.08)] p-3">
      {document.warnings.map((warning, i) => (
        <p key={i} className="text-sm text-[var(--meeting-color)]">{warning}</p>
      ))}
    </section>
  );
}
