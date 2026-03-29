import { useEffect, useCallback, useState, useRef } from "react";
import { useDocumentStore } from "../store/documentStore";
import { InlineEdit } from "./InlineEdit";
import { PipelineStepper } from "./PipelineStepper";
import { kindRgbVar, kindColor } from "../lib/document-colors";
import type { UiDocument, UiDocumentKind } from "../types/documents";


function formatKindLabel(kind: UiDocumentKind): string {
  switch (kind) {
    case "receipt":
      return "Kvitto";
    case "contract":
      return "Avtal";
    case "invoice":
      return "Faktura";
    case "meeting_notes":
      return "Mötesanteckning";
    case "audio":
      return "Ljud";
    case "file_moved":
      return "Flyttad";
    default:
      return "Dokument";
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

function InlineEditField({ documentId, fieldKey, value }: { documentId: string; fieldKey: string; value: string }) {
  const updateExtractionField = useDocumentStore((state) => state.updateExtractionField);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => { clearTimeout(timerRef.current); };
  }, []);

  const handleSave = (newValue: string) => {
    updateExtractionField(documentId, fieldKey, newValue);
    setSaved(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), 1200);
  };
  return (
    <span className={`inline-edit-field-wrapper ${saved ? "is-rippling" : ""}`}>
      <InlineEdit value={value} onSave={handleSave} className="data-pill" />
      {saved && <span className="inline-edit-saved" aria-label="Sparad">✓</span>}
    </span>
  );
}

const EMPTY_HISTORY: import("../store/documentStore").StageEntry[] = [];

export function InspectorPane() {
  const selectedDocumentId = useDocumentStore((state) => state.selectedDocumentId);
  const document = useDocumentStore((state) =>
    state.selectedDocumentId ? state.documents[state.selectedDocumentId] : null,
  );
  const stageHistory = useDocumentStore((state) => {
    if (!state.selectedDocumentId) return EMPTY_HISTORY;
    const doc = state.documents[state.selectedDocumentId];
    if (!doc) return EMPTY_HISTORY;
    return state.stageHistory[doc.requestId] ?? EMPTY_HISTORY;
  });
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
    <aside
      className="inspector-pane"
      role="region"
      aria-label="Dokumentdetaljer"
      style={{ "--type-color": document ? kindColor(document.kind) : "var(--accent-primary)" } as React.CSSProperties}
    >
      {document ? (
        <ModalContent document={document} history={stageHistory} onClose={close} />
      ) : (
        <InspectorEmptyState />
      )}
    </aside>
  );
}

function InspectorEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center bg-[rgba(255,255,255,0.01)]">
      {/* Ghost preview placeholder */}
      <div className="w-full max-w-[180px] aspect-[3/4] rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)] mb-8 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[rgba(255,255,255,0.02)] to-transparent animate-pulse" />
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[rgba(255,255,255,0.06)] relative z-10">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </div>

      <div className="w-full max-w-[200px] space-y-6">
        <div className="space-y-2">
          <div className="h-[10px] w-24 rounded bg-[rgba(255,255,255,0.05)] mx-auto" />
          <div className="h-[6px] w-32 rounded bg-[rgba(255,255,255,0.03)] mx-auto" />
        </div>

        {/* Ghost summary block */}
        <div className="space-y-2 p-3 rounded-lg border border-[rgba(255,255,255,0.03)] bg-[rgba(255,255,255,0.01)]">
          <div className="h-[5px] w-full rounded bg-[rgba(255,255,255,0.03)]" />
          <div className="h-[5px] w-full rounded bg-[rgba(255,255,255,0.03)]" />
          <div className="h-[5px] w-3/4 rounded bg-[rgba(255,255,255,0.02)]" />
        </div>

        {/* Action hint */}
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[rgba(255,255,255,0.2)] mt-4">
          Select record to inspect
        </p>
      </div>
    </div>
  );
}

function ModalContent({ document, history, onClose }: { document: UiDocument; history: import("../store/documentStore").StageEntry[]; onClose: () => void }) {
  const setActiveDocumentChat = useDocumentStore((state) => state.setActiveDocumentChat);
  const accent = kindColor(document.kind);
  const fields = document.extraction?.fields ?? {};
  const fieldEntries = Object.entries(fields).filter(
    ([, value]) => value !== null && typeof value !== "undefined" && value !== "",
  );
  const hasTranscription =
    document.transcription?.text &&
    (document.kind === "audio" || document.kind === "meeting_notes");

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="hud-section flex items-start justify-between border-b border-white/6 px-5 py-4">
        <div className="space-y-2">
          <span
            className="glass-badge"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
          >
            <span className="status-dot" style={{ backgroundColor: accent, width: 6, height: 6 }} />
            {formatKindLabel(document.kind)}
          </span>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{document.title}</h2>
          <p className="font-mono text-[11px] text-[var(--text-muted)]">
            Req {document.requestId.slice(0, 8)} · Doc {document.id.slice(0, 8)}
          </p>
        </div>
        <button
          type="button"
          className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-white/6 hover:text-[var(--text-primary)]"
          onClick={onClose}
          aria-label="Stäng detaljpanel"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-5 py-5">
        {history.length > 0 && (
          <div className="hud-section">
            <PipelineStepper
              currentStage={document.status}
              history={history}
              failed={document.status === "failed"}
            />
          </div>
        )}

        {document.summary ? (
          <section className="hud-section control-card p-4">
            <p className="section-kicker">Sammanfattning</p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{document.summary}</p>
          </section>
        ) : null}

        {fieldEntries.length > 0 ? (
          <section
            className="hud-section control-card p-4"
            style={{ "--type-color-rgb": `var(${kindRgbVar(document.kind)})` } as React.CSSProperties}
          >
            <p className="section-kicker">Extraherade fält</p>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              {fieldEntries.map(([key, value]) => (
                <div key={key}>
                  <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                    {key.replace(/_/g, " ")}
                  </p>
                  <InlineEditField
                    documentId={document.id}
                    fieldKey={key}
                    value={formatFieldValue(value)}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {hasTranscription ? (
          <section className="hud-section control-card p-4">
            <p className="section-kicker">Transkribering</p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              {document.transcription!.text.length > 500
                ? `${document.transcription!.text.slice(0, 500)}...`
                : document.transcription!.text}
            </p>
          </section>
        ) : null}

        {document.tags.length > 0 ? (
          <section className="hud-section control-card p-4">
            <p className="section-kicker">Taggar</p>
            <div className="mt-2 flex flex-wrap gap-2">
            {document.tags.map((tag) => (
              <span key={tag} className="glass-badge bg-white/6 text-[var(--text-secondary)]">
                {tag}
              </span>
            ))}
            </div>
          </section>
        ) : null}

        {document.sourcePath ? (
          <section className="hud-section control-card p-4">
            <p className="section-kicker">Filplats</p>
            <p className="mt-2 break-all font-[var(--font-mono)] text-xs text-[var(--text-secondary)]">
              {document.sourcePath}
            </p>
          </section>
        ) : null}

        {document.movePlan?.destination ? (
          <section className="hud-section control-card p-4">
            <p className="section-kicker">Flyttplan</p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-[11px] uppercase text-[var(--text-muted)]">Mål</p>
                <p className="mt-0.5 break-all font-[var(--font-mono)] text-xs text-[var(--text-secondary)]">
                  {document.movePlan.destination}
                </p>
              </div>
              {document.movePlan.rule_name ? (
                <div>
                  <p className="text-[11px] uppercase text-[var(--text-muted)]">Regel</p>
                  <p className="mt-0.5 text-[var(--text-secondary)]">{document.movePlan.rule_name}</p>
                </div>
              ) : null}
              <div>
                <p className="text-[11px] uppercase text-[var(--text-muted)]">Status</p>
                <p className="mt-0.5 text-[var(--text-secondary)]">{formatMoveStatus(document.moveStatus)}</p>
              </div>
            </div>
          </section>
        ) : null}

        {document.warnings.length > 0 ? (
          <section className="hud-section rounded-2xl border border-[rgba(255,159,10,0.18)] bg-[rgba(255,159,10,0.08)] p-3">
            <p className="section-kicker text-[var(--meeting-color)]">Varningar</p>
            {document.warnings.map((warning, i) => (
              <p key={i} className="mt-1 text-sm text-[var(--meeting-color)]">{warning}</p>
            ))}
          </section>
        ) : null}

        <div className="hud-section mt-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="focus-ring action-secondary px-3 py-1.5 text-xs"
            onClick={() => { setActiveDocumentChat(document.id); onClose(); }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="mr-1.5 inline-block -mt-px">
              <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5.5L3 13.5V11H3a1 1 0 0 1-1-1V3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M5.5 5.5h5M5.5 7.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Chatta om dokumentet
          </button>
          {document.sourcePath ? (
            <button
              type="button"
              className="focus-ring action-secondary px-3 py-1.5 text-xs"
              onClick={() => void openInFinder(document.sourcePath!)}
            >
              Öppna i Finder
            </button>
          ) : null}
        </div>

        <section className="hud-section control-card p-3">
          <p className="section-kicker">Meta</p>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
            <span className="font-mono">Req {document.requestId.slice(0, 8)}</span>
            <span className="font-mono">Doc {document.id.slice(0, 8)}</span>
            <span className="uppercase">{document.sourceModality}</span>
            <span className="line-clamp-1">{document.mimeType}</span>
          </div>
        </section>
      </div>
    </div>
  );
}

function formatMoveStatus(status: UiDocument["moveStatus"]): string {
  switch (status) {
    case "not_requested":
      return "Ej begärd";
    case "planned":
      return "Planerad";
    case "awaiting_confirmation":
      return "Väntar på bekräftelse";
    case "auto_pending_client":
      return "Väntar på klient";
    case "moved":
      return "Flyttad";
    case "move_failed":
      return "Misslyckad";
    case "undone":
      return "Återställd";
    default:
      return status;
  }
}
