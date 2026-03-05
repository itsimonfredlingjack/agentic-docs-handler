import { useEffect, useCallback } from "react";
import { useDocumentStore } from "../store/documentStore";
import type { UiDocument, UiDocumentKind } from "../types/documents";

function getKindAccent(kind: UiDocumentKind): string {
  switch (kind) {
    case "receipt":
      return "var(--receipt-color)";
    case "contract":
      return "var(--contract-color)";
    case "invoice":
      return "var(--invoice-color)";
    case "meeting_notes":
      return "var(--meeting-color)";
    case "audio":
      return "var(--audio-color)";
    default:
      return "var(--report-color)";
  }
}

function formatKindLabel(kind: UiDocumentKind): string {
  switch (kind) {
    case "meeting_notes":
      return "Meeting Notes";
    case "file_moved":
      return "Moved";
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

function formatFieldValue(value: unknown): string {
  if (value === null || typeof value === "undefined" || value === "") {
    return "—";
  }
  return String(value);
}

async function openInFinder(path: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_in_folder", { path });
  } catch {
    // Not in Tauri context
  }
}

export function DetailPanel() {
  const selectedDocumentId = useDocumentStore((state) => state.selectedDocumentId);
  const document = useDocumentStore((state) =>
    state.selectedDocumentId ? state.documents[state.selectedDocumentId] : null,
  );
  const setSelectedDocument = useDocumentStore((state) => state.setSelectedDocument);

  const isOpen = selectedDocumentId !== null && document !== null;

  const close = useCallback(() => {
    setSelectedDocument(null);
  }, [setSelectedDocument]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  useEffect(() => {
    if (selectedDocumentId && !document) setSelectedDocument(null);
  }, [selectedDocumentId, document, setSelectedDocument]);

  return (
    <>
      <div
        className={`detail-backdrop ${isOpen ? "detail-backdrop--open" : ""}`}
        onClick={close}
      />
      <div
        className={`detail-modal ${isOpen ? "detail-modal--open" : ""}`}
        role="dialog"
        aria-label="Document details"
      >
        {document ? <ModalContent document={document} onClose={close} /> : null}
      </div>
    </>
  );
}

function ModalContent({ document, onClose }: { document: UiDocument; onClose: () => void }) {
  const accent = getKindAccent(document.kind);
  const fields = document.extraction?.fields ?? {};
  const fieldEntries = Object.entries(fields).filter(
    ([, value]) => value !== null && typeof value !== "undefined" && value !== "",
  );
  const hasTranscription =
    document.transcription?.text &&
    (document.kind === "audio" || document.kind === "meeting_notes");

  return (
    <div className="flex max-h-[80vh] flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
        <span
          className="glass-badge"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
        >
          <span className="status-dot" style={{ backgroundColor: accent, width: 6, height: 6 }} />
          {formatKindLabel(document.kind)}
        </span>
        <button
          type="button"
          className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-black/5 hover:text-[var(--text-primary)]"
          onClick={onClose}
          aria-label="Close detail panel"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-4 px-5 py-5">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{document.title}</h2>

        {document.summary ? (
          <p className="text-sm leading-6 text-[var(--text-secondary)]">{document.summary}</p>
        ) : null}

        {fieldEntries.length > 0 ? (
          <div className="rounded-2xl bg-white/40 p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Extracted Fields
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {fieldEntries.map(([key, value]) => (
                <div key={key}>
                  <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                    {key.replace(/_/g, " ")}
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">
                    {formatFieldValue(value)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {hasTranscription ? (
          <div className="rounded-2xl bg-white/40 p-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Transcription
            </p>
            <p className="text-sm leading-6 text-[var(--text-secondary)]">
              {document.transcription!.text.length > 500
                ? `${document.transcription!.text.slice(0, 500)}...`
                : document.transcription!.text}
            </p>
          </div>
        ) : null}

        {document.tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {document.tags.map((tag) => (
              <span key={tag} className="glass-badge bg-white/30 text-[var(--text-secondary)]">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {document.sourcePath ? (
          <div className="rounded-2xl bg-white/40 p-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              File Location
            </p>
            <p className="break-all font-[var(--font-mono)] text-xs text-[var(--text-secondary)]">
              {document.sourcePath}
            </p>
          </div>
        ) : null}

        {document.movePlan?.destination ? (
          <div className="rounded-2xl bg-white/40 p-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Move Plan
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-[11px] uppercase text-[var(--text-muted)]">Destination</p>
                <p className="mt-0.5 break-all font-[var(--font-mono)] text-xs text-[var(--text-secondary)]">
                  {document.movePlan.destination}
                </p>
              </div>
              {document.movePlan.rule_name ? (
                <div>
                  <p className="text-[11px] uppercase text-[var(--text-muted)]">Rule</p>
                  <p className="mt-0.5 text-[var(--text-secondary)]">{document.movePlan.rule_name}</p>
                </div>
              ) : null}
              <div>
                <p className="text-[11px] uppercase text-[var(--text-muted)]">Status</p>
                <p className="mt-0.5 text-[var(--text-secondary)]">{document.moveStatus}</p>
              </div>
            </div>
          </div>
        ) : null}

        {document.warnings.length > 0 ? (
          <div className="rounded-2xl border border-[rgba(255,159,10,0.18)] bg-[rgba(255,159,10,0.08)] p-3">
            {document.warnings.map((warning, i) => (
              <p key={i} className="text-sm text-[var(--meeting-color)]">{warning}</p>
            ))}
          </div>
        ) : null}

        {document.sourcePath ? (
          <button
            type="button"
            className="focus-ring w-fit rounded-xl border border-black/5 bg-white/50 px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition-all duration-150 hover:bg-white/70"
            onClick={() => void openInFinder(document.sourcePath!)}
          >
            Open in Finder
          </button>
        ) : null}
      </div>
    </div>
  );
}
