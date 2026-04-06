import { useEffect, useCallback, useState, useRef } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useToastStore } from "../store/toastStore";
import { InlineEdit } from "./InlineEdit";
import { PipelineStepper } from "./PipelineStepper";
import { kindRgbVar, kindColor } from "../lib/document-colors";
import { deleteDocument, fetchWorkspaceDiscovery } from "../lib/api";
import { t } from "../lib/locale";
import type { UiDocument, UiDocumentKind, DiscoveryCard } from "../types/documents";


function formatKindLabel(kind: UiDocumentKind): string {
  switch (kind) {
    case "receipt":
      return t("kind.receipt");
    case "contract":
      return t("kind.contract");
    case "invoice":
      return t("kind.invoice");
    case "meeting_notes":
      return t("kind.meeting_notes");
    case "audio":
      return t("kind.audio");
    case "file_moved":
      return t("kind.file_moved");
    default:
      return t("kind.generic");
  }
}

function formatFieldValue(value: unknown): string {
  if (value === null || typeof value === "undefined" || value === "") {
    return "\u2014";
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
  const showToast = useToastStore((s) => s.show);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => { clearTimeout(timerRef.current); };
  }, []);

  const handleSave = (newValue: string) => {
    updateExtractionField(documentId, fieldKey, newValue);
    showToast(t("toast.field_saved"), "success");
    setSaved(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), 1200);
  };
  return (
    <span className={`inline-edit-field-wrapper ${saved ? "is-rippling" : ""}`}>
      <InlineEdit value={value} onSave={handleSave} className="data-pill" />
      {saved && <span className="inline-edit-saved" aria-label="Sparad">{"\u2713"}</span>}
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

  const close = useCallback(() => {
    setSelectedDocument(null);
  }, [setSelectedDocument]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  useEffect(() => {
    if (selectedDocumentId && !document) setSelectedDocument(null);
  }, [selectedDocumentId, document, setSelectedDocument]);

  return (
    <aside
      className="inspector-pane"
      role="region"
      aria-label={t("inspector.summary")}
      style={{ "--type-color": document ? kindColor(document.kind) : "var(--accent-primary)" } as React.CSSProperties}
    >
      {document && <ModalContent document={document} history={stageHistory} onClose={close} />}
    </aside>
  );
}

function entityTypeLabel(type: string): string {
  switch (type) {
    case "person": return "P \u00b7";
    case "company": return "C \u00b7";
    case "date": return "D \u00b7";
    case "amount": return "$ \u00b7";
    case "place": return "L \u00b7";
    default: return "";
  }
}

function RelatedFilesSection({ documentId, workspaceId }: { documentId: string; workspaceId?: string | null }) {
  const [relations, setRelations] = useState<Array<{ title: string; type: string; id: string }>>([]);
  const setSelectedDocument = useDocumentStore((state) => state.setSelectedDocument);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await fetchWorkspaceDiscovery(workspaceId!);
        if (cancelled) return;

        // Filter out self-referential duplicate cards (all files share the same title)
        const meaningfulCards = response.cards.filter((card: DiscoveryCard) => {
          if (card.relation_type === "duplicate") {
            const titles = card.files.map((f) => f.title);
            return new Set(titles).size > 1;
          }
          return true;
        });

        const related = meaningfulCards
          .filter((card: DiscoveryCard) => card.files.some((f) => f.id === documentId))
          .flatMap((card: DiscoveryCard) =>
            card.files
              .filter((f) => f.id !== documentId)
              .map((f) => ({ title: f.title, type: card.relation_type, id: f.id }))
          );
        setRelations(related);
      } catch {
        // Related files are optional — silent fail
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [documentId, workspaceId]);

  if (relations.length === 0) return null;

  return (
    <section className="hud-section control-card p-4">
      <p className="section-kicker">{t("inspector.related_files")}</p>
      <div className="mt-2 space-y-1.5">
        {relations.map((rel) => (
          <button
            key={rel.id}
            type="button"
            className="flex items-center gap-2 w-full text-left rounded-lg px-2 py-1.5 text-sm-ui text-[var(--text-secondary)] hover:bg-[var(--surface-4)] transition-colors"
            onClick={() => setSelectedDocument(rel.id)}
          >
            <span className="text-xs-ui text-[var(--text-muted)] uppercase tracking-[0.04em]">{rel.type}</span>
            <span className="truncate">{rel.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ModalContent({ document, history, onClose }: { document: UiDocument; history: import("../store/documentStore").StageEntry[]; onClose: () => void }) {
  const removeDocument = useDocumentStore((s) => s.removeDocument);
  const showToast = useToastStore((s) => s.show);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [debugExpanded, setDebugExpanded] = useState(false);

  // Determine if document is in the inbox
  const inboxWorkspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.is_inbox));
  const isInbox = Boolean(
    document.workspaceId && inboxWorkspace && document.workspaceId === inboxWorkspace.id,
  );

  useEffect(() => {
    setConfirmDelete(false);
    setDebugExpanded(false);
  }, [document.id]);

  const handleDelete = async () => {
    try {
      await deleteDocument(document.id);
      removeDocument(document.id);
      showToast(t("toast.document_deleted"), "success");
    } catch {
      showToast(t("toast.delete_failed"), "error");
    }
    setConfirmDelete(false);
  };

  const accent = kindColor(document.kind);
  const fields = document.extraction?.fields ?? {};
  const fieldEntries = Object.entries(fields).filter(
    ([, value]) => value !== null && typeof value !== "undefined" && value !== "",
  );
  const hasTranscription =
    document.transcription?.text &&
    (document.kind === "audio" || document.kind === "meeting_notes");

  const entities = (document.extraction as any)?.entities as Array<{ name: string; entity_type: string }> | undefined;
  const hasEntities = Array.isArray(entities) && entities.length > 0;
  const hasTags = document.tags.length > 0;
  const hasTagsOrEntities = hasTags || hasEntities;

  const hasSuggestion = isInbox && document.movePlan?.suggested_workspace_name;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* ---- Header: type badge + title (no IDs) ---- */}
      <div className="hud-section flex items-start justify-between border-b border-[var(--surface-6)] px-5 py-4">
        <div className="space-y-2">
          <span
            className="glass-badge"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
          >
            <span className="status-dot" style={{ backgroundColor: accent, width: 6, height: 6 }} />
            {formatKindLabel(document.kind)}
          </span>
          <h2 className="text-lg-ui font-bold text-[var(--text-primary)]">{document.title}</h2>
        </div>
        <button
          type="button"
          className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-6)] hover:text-[var(--text-primary)]"
          onClick={onClose}
          aria-label={t("inspector.summary")}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-5 py-5">
        {/* ---- Inbox AI suggestion (only for inbox documents with a suggestion) ---- */}
        {hasSuggestion ? (
          <section className="hud-section control-card p-4">
            <p className="section-kicker">{t("inbox.suggested_for")}</p>
            <div className="mt-2 text-base-ui text-[var(--text-secondary)]">
              <p className="font-bold">{document.movePlan!.suggested_workspace_name}</p>
              {document.movePlan!.suggestion_confidence != null && (
                <p className="mt-1 text-sm-ui text-[var(--text-muted)]">
                  {Math.round(document.movePlan!.suggestion_confidence * 100)}%
                </p>
              )}
              {document.movePlan!.suggestion_reason ? (
                <p className="mt-1 text-sm-ui text-[var(--text-muted)]">{document.movePlan!.suggestion_reason}</p>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ---- Summary ---- */}
        {document.summary ? (
          <section className="hud-section control-card p-4">
            <p className="section-kicker">{t("inspector.summary")}</p>
            <p className="mt-2 text-base-ui leading-6 text-[var(--text-secondary)]">{document.summary}</p>
          </section>
        ) : null}

        {/* ---- Extracted fields (editable) ---- */}
        {fieldEntries.length > 0 ? (
          <section
            className="hud-section control-card p-4"
            style={{ "--type-color-rgb": `var(${kindRgbVar(document.kind)})` } as React.CSSProperties}
          >
            <p className="section-kicker">{t("inspector.extracted_fields")}</p>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              {fieldEntries.map(([key, value]) => (
                <div key={key}>
                  <p className="text-sm-ui uppercase tracking-[0.08em] text-[var(--text-muted)]">
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

        {/* ---- Transcription (audio / meeting_notes only) ---- */}
        {hasTranscription ? (
          <section className="hud-section control-card p-4">
            <p className="section-kicker">{t("inspector.transcription")}</p>
            <p className="mt-2 text-base-ui leading-6 text-[var(--text-secondary)]">
              {document.transcription!.text.length > 500
                ? `${document.transcription!.text.slice(0, 500)}...`
                : document.transcription!.text}
            </p>
          </section>
        ) : null}

        {/* ---- Tags + Entities (compact, combined) ---- */}
        {hasTagsOrEntities ? (
          <section className="hud-section control-card p-4">
            {hasTags ? (
              <>
                <p className="section-kicker">{t("inspector.tags")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {document.tags.map((tag) => (
                    <span key={tag} className="glass-badge bg-[var(--surface-6)] text-[var(--text-secondary)]">
                      {tag}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
            {hasEntities ? (
              <div className={hasTags ? "mt-3" : ""}>
                <p className="section-kicker">{t("inspector.entities")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {entities!.map((entity, i) => (
                    <span key={`${entity.name}-${i}`} className="glass-badge bg-[var(--surface-6)] text-[var(--text-secondary)]">
                      {entityTypeLabel(entity.entity_type) && (
                        <span className="text-[var(--text-muted)] text-xs-ui">{entityTypeLabel(entity.entity_type)}</span>
                      )}
                      {entity.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ---- Move plan (non-inbox documents only) ---- */}
        {!isInbox && document.movePlan?.destination ? (
          <section className="hud-section control-card p-4">
            <p className="section-kicker">{t("inspector.move_plan")}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-base-ui">
              <div>
                <p className="text-sm-ui uppercase text-[var(--text-muted)]">{t("inspector.move_target")}</p>
                <p className="mt-0.5 break-all font-[var(--font-mono)] text-sm-ui text-[var(--text-secondary)]">
                  {document.movePlan.destination}
                </p>
              </div>
              {document.movePlan.rule_name ? (
                <div>
                  <p className="text-sm-ui uppercase text-[var(--text-muted)]">{t("inspector.move_rule")}</p>
                  <p className="mt-0.5 text-[var(--text-secondary)]">{document.movePlan.rule_name}</p>
                </div>
              ) : null}
              <div>
                <p className="text-sm-ui uppercase text-[var(--text-muted)]">{t("inspector.move_status")}</p>
                <p className="mt-0.5 text-[var(--text-secondary)]">{formatMoveStatus(document.moveStatus)}</p>
              </div>
            </div>
          </section>
        ) : null}

        {/* ---- Related files (filtered for meaningful relations) ---- */}
        <RelatedFilesSection documentId={document.id} workspaceId={document.workspaceId} />

        {/* ---- Warnings ---- */}
        {document.warnings.length > 0 ? (
          <section className="hud-section rounded-2xl border border-[rgba(255,159,10,0.18)] bg-[rgba(255,159,10,0.08)] p-3">
            <p className="section-kicker text-[var(--meeting-color)]">{t("inspector.warnings")}</p>
            {document.warnings.map((warning, i) => (
              <p key={i} className="mt-1 text-base-ui text-[var(--meeting-color)]">{warning}</p>
            ))}
          </section>
        ) : null}

        {/* ---- Action buttons ---- */}
        <div className="hud-section mt-auto flex flex-wrap items-center gap-2">
          {document.sourcePath ? (
            <button
              type="button"
              className="focus-ring action-secondary px-3 py-1.5 text-sm-ui"
              onClick={() => void openInFinder(document.sourcePath!)}
            >
              {t("inspector.open_in_finder")}
            </button>
          ) : null}
          {confirmDelete ? (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs-ui text-[var(--invoice-color)]">
                {t("inspector.delete_confirm")}
              </span>
              <button
                type="button"
                onClick={handleDelete}
                className="px-2 py-0.5 text-xs-ui rounded-[var(--badge-radius)] bg-[rgba(var(--invoice-color-rgb),0.12)] text-[var(--invoice-color)] hover:bg-[rgba(var(--invoice-color-rgb),0.25)] transition-colors"
              >
                {t("inspector.confirm_delete")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-0.5 text-xs-ui rounded-[var(--badge-radius)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="mt-2 px-3 py-1 text-xs-ui rounded-[var(--badge-radius)] text-[var(--invoice-color)] hover:bg-[rgba(var(--invoice-color-rgb),0.12)] transition-colors"
            >
              {t("inspector.delete_button")}
            </button>
          )}
        </div>

        {/* ---- Collapsible Filinfo section ---- */}
        <section className="hud-section control-card">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-4 py-3 text-sm-ui text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            onClick={() => setDebugExpanded((prev) => !prev)}
            aria-expanded={debugExpanded}
          >
            <span className="text-xs-ui" style={{ display: "inline-block", transform: debugExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>{"\u25b8"}</span>
            {t("inspector.file_info")}
          </button>
          {debugExpanded ? (
            <div className="px-4 pb-4 grid grid-cols-2 gap-x-4 gap-y-3">
              {document.sourcePath ? (
                <div className="col-span-2">
                  <p className="text-sm-ui uppercase tracking-[0.08em] text-[var(--text-muted)]">{t("inspector.file_location")}</p>
                  <p className="mt-0.5 break-all font-[var(--font-mono)] text-sm-ui text-[var(--text-secondary)]">
                    {document.sourcePath}
                  </p>
                </div>
              ) : null}
              <div>
                <p className="text-sm-ui uppercase tracking-[0.08em] text-[var(--text-muted)]">Modality</p>
                <p className="mt-0.5 text-sm-ui uppercase text-[var(--text-secondary)]">{document.sourceModality}</p>
              </div>
              <div>
                <p className="text-sm-ui uppercase tracking-[0.08em] text-[var(--text-muted)]">MIME</p>
                <p className="mt-0.5 text-sm-ui text-[var(--text-secondary)] line-clamp-1">{document.mimeType}</p>
              </div>
              <div>
                <p className="text-sm-ui uppercase tracking-[0.08em] text-[var(--text-muted)]">Req ID</p>
                <p className="mt-0.5 font-mono text-sm-ui text-[var(--text-secondary)]">{document.requestId.slice(0, 8)}</p>
              </div>
              <div>
                <p className="text-sm-ui uppercase tracking-[0.08em] text-[var(--text-muted)]">Doc ID</p>
                <p className="mt-0.5 font-mono text-sm-ui text-[var(--text-secondary)]">{document.id.slice(0, 8)}</p>
              </div>
              {history.length > 0 ? (
                <div className="col-span-2">
                  <p className="text-sm-ui uppercase tracking-[0.08em] text-[var(--text-muted)] mb-2">Pipeline</p>
                  <PipelineStepper
                    currentStage={document.status}
                    history={history}
                    failed={document.status === "failed"}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function formatMoveStatus(status: UiDocument["moveStatus"]): string {
  switch (status) {
    case "not_requested":
      return t("move.not_requested");
    case "planned":
      return t("move.planned");
    case "awaiting_confirmation":
      return t("move.awaiting_confirmation");
    case "auto_pending_client":
      return t("move.pending_client");
    case "moved":
      return t("move.moved");
    case "move_failed":
      return t("move.failed");
    case "undone":
      return t("move.undone");
    default:
      return status;
  }
}
