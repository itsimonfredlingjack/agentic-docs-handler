import { dismissPendingMove, finalizeClientMove, processFile } from "../lib/api";
import { mapProcessResponseToUiDocument } from "../lib/document-mappers";
import { moveLocalFile } from "../lib/tauri-events";
import { useDocumentStore } from "../store/documentStore";
import type { ProcessResponse, UiDocument } from "../types/documents";

import {
  DetailPaneExtraction,
  DetailPaneOrganized,
  DetailPaneSource,
  DetailPaneTags,
  DetailPaneTranscription,
  DetailPaneWarnings,
} from "./DetailPaneSections";

function getProcessingMeta(status: UiDocument["status"]): { label: string; message: string } {
  switch (status) {
    case "uploading": return { label: "Uploading", message: "Uploading file to the orchestrator." };
    case "processing": return { label: "Queued", message: "Waiting in the model queue." };
    case "classifying": return { label: "Classifying", message: "Identifying document type." };
    case "classified": return { label: "Classified", message: "Type identified, extracting fields next." };
    case "extracting": return { label: "Extracting", message: "Pulling out fields and key information." };
    case "organizing": return { label: "Organizing", message: "Planning sort and destination folder." };
    case "indexing": return { label: "Indexing", message: "Writing to the search index." };
    case "transcribing": return { label: "Transcribing", message: "Transcribing audio before classification." };
    default: return { label: "Processing", message: "Processing document." };
  }
}

const processingStatuses = new Set([
  "uploading", "processing", "classifying", "classified",
  "extracting", "organizing", "indexing", "transcribing",
]);

async function openInFinder(path: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_in_folder", { path });
  } catch {
    // Not in Tauri context
  }
}

async function confirmMove(document: UiDocument): Promise<void> {
  const state = useDocumentStore.getState();
  state.setPendingMoveError(document.id, null);
  state.setPendingMoveAction(document.id, "confirming");
  if (!state.clientId) {
    state.setPendingMoveError(document.id, "move_unavailable_missing_client");
    state.setPendingMoveAction(document.id, "idle");
    return;
  }
  if (!document.sourcePath) {
    state.setPendingMoveError(document.id, "move_unavailable_missing_source_path");
    state.setPendingMoveAction(document.id, "idle");
    return;
  }
  if (!document.movePlan?.destination) {
    state.setPendingMoveError(document.id, "move_unavailable_missing_destination");
    state.setPendingMoveAction(document.id, "idle");
    return;
  }
  try {
    const localMove = await moveLocalFile(document.sourcePath, document.movePlan.destination);
    if (!localMove.success) {
      state.setPendingMoveError(document.id, localMove.error ?? "move_failed");
      state.setPendingMoveAction(document.id, "idle");
      return;
    }
    const finalized = await finalizeClientMove({
      recordId: document.id,
      requestId: document.requestId,
      clientId: state.clientId,
      result: localMove,
    });
    if (finalized.success) {
      useDocumentStore.getState().applyMoveFinalized(finalized);
      return;
    }
    useDocumentStore.getState().setPendingMoveError(document.id, "move_failed");
    useDocumentStore.getState().setPendingMoveAction(document.id, "idle");
  } catch (error) {
    state.setPendingMoveError(document.id, error instanceof Error ? error.message : "move_failed");
    state.setPendingMoveAction(document.id, "idle");
  }
}

async function dismissMove(document: UiDocument): Promise<void> {
  const state = useDocumentStore.getState();
  state.setPendingMoveError(document.id, null);
  state.setPendingMoveAction(document.id, "dismissing");
  if (!state.clientId) {
    state.setPendingMoveError(document.id, "move_unavailable_missing_client");
    state.setPendingMoveAction(document.id, "idle");
    return;
  }
  try {
    const response = await dismissPendingMove(document.id, document.requestId, state.clientId);
    useDocumentStore.getState().applyMoveDismissed(response);
  } catch (error) {
    state.setPendingMoveError(document.id, error instanceof Error ? error.message : "move_dismiss_failed");
    state.setPendingMoveAction(document.id, "idle");
  }
}

async function retryDocument(requestId: string): Promise<void> {
  const state = useDocumentStore.getState();
  const upload = state.uploadsByRequestId[requestId];
  if (!upload || !state.clientId) return;
  state.markJobStage(requestId, "uploading");
  const response = await processFile({
    file: upload.file,
    sourcePath: upload.sourcePath,
    clientId: state.clientId,
    requestId,
    executeMove: Boolean(upload.sourcePath),
    moveExecutor: "client",
  });
  const doc = mapProcessResponseToUiDocument(response as ProcessResponse);
  state.upsertDocument(doc);
  if (
    response.move_status === "auto_pending_client" &&
    response.move_plan.destination &&
    doc.sourcePath &&
    response.record_id
  ) {
    const localMove = await moveLocalFile(doc.sourcePath, response.move_plan.destination);
    const finalized = await finalizeClientMove({
      recordId: response.record_id,
      requestId,
      clientId: state.clientId,
      result: localMove,
    });
    if (finalized.success) state.applyMoveFinalized(finalized);
  }
  if (response.move_status !== "awaiting_confirmation") {
    state.clearRememberedUpload(requestId);
  }
}

export function DetailPane() {
  const selectedDocumentId = useDocumentStore((state) => state.selectedDocumentId);
  const document = useDocumentStore((state) =>
    state.selectedDocumentId ? state.documents[state.selectedDocumentId] : null,
  );

  if (!document) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--text-muted)]">
        Select a document to view details
      </div>
    );
  }

  const isProcessing = processingStatuses.has(document.status);
  const isFailed = document.status === "failed";
  const isAwaitingConfirmation = document.moveStatus === "awaiting_confirmation" && document.movePlan?.destination;

  return (
    <div key={selectedDocumentId} className="detail-pane">
      {isProcessing && <div className="processing-bar" />}

      <div className="flex flex-col gap-5 p-5 overflow-y-auto flex-1">
        {/* Processing state */}
        {isProcessing && <ProcessingBanner status={document.status} />}

        {/* Failed state */}
        {isFailed && <FailedBanner document={document} />}

        {/* Source info */}
        <DetailPaneSource document={document} />

        {/* AI Extraction — THE HERO */}
        <DetailPaneExtraction document={document} />

        {/* Transcription */}
        <DetailPaneTranscription document={document} />

        {/* Organized / Move */}
        <DetailPaneOrganized document={document} />

        {/* Awaiting confirmation actions */}
        {isAwaitingConfirmation && <ConfirmationActions document={document} />}

        {/* Tags */}
        <DetailPaneTags document={document} />

        {/* Warnings */}
        <DetailPaneWarnings document={document} />

        {/* Footer actions */}
        {document.sourcePath && (
          <button
            type="button"
            className="focus-ring w-fit rounded-xl border border-black/5 bg-white/50 px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition-all duration-150 hover:bg-white/70"
            onClick={() => void openInFinder(document.sourcePath!)}
          >
            Open in Finder
          </button>
        )}
      </div>
    </div>
  );
}

function ProcessingBanner({ status }: { status: UiDocument["status"] }) {
  const meta = getProcessingMeta(status);
  return (
    <div className="rounded-2xl bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] p-4">
      <div className="flex items-center gap-2">
        <span
          className="status-dot bg-[var(--accent-primary)]"
          style={{ animation: "pulse-dot 1.5s ease-in-out infinite" }}
        />
        <span className="text-sm font-semibold text-[var(--accent-primary)]">{meta.label}</span>
      </div>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{meta.message}</p>
    </div>
  );
}

function FailedBanner({ document }: { document: UiDocument }) {
  return (
    <div className="rounded-2xl border border-[rgba(255,55,95,0.18)] bg-[rgba(255,55,95,0.06)] p-4">
      <div className="flex items-center gap-2">
        <span className="status-dot bg-[var(--invoice-color)]" />
        <span className="text-sm font-semibold text-[var(--invoice-color)]">Failed</span>
      </div>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        {document.errorCode === "audio_processing_unavailable"
          ? "Audio processing unavailable"
          : document.summary}
      </p>
      {document.retryable && (
        <button
          type="button"
          className="focus-ring mt-3 rounded-xl bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-white transition-all duration-150 hover:opacity-90"
          onClick={() => void retryDocument(document.requestId)}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function ConfirmationActions({ document }: { document: UiDocument }) {
  const pendingMoveAction = useDocumentStore(
    (state) => state.pendingMoveStateByRecordId[document.id]?.action ?? "idle",
  );
  const pendingMoveError = useDocumentStore(
    (state) => state.pendingMoveStateByRecordId[document.id]?.error ?? null,
  );
  const isBusy = pendingMoveAction !== "idle";

  return (
    <section className="detail-section">
      <p className="detail-section-label">Confirm Move</p>
      <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">
        → {document.movePlan?.destination ?? "—"}
      </p>
      {pendingMoveError && (
        <p className="mt-2 text-xs text-[#ff375f]">{pendingMoveError}</p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="focus-ring rounded-xl bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-white transition-all duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy}
          onClick={() => void confirmMove(document)}
        >
          {pendingMoveAction === "confirming" ? "Confirming..." : "Confirm move"}
        </button>
        <button
          type="button"
          className="focus-ring rounded-xl border border-black/5 bg-white/50 px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition-all duration-150 hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy}
          onClick={() => void dismissMove(document)}
        >
          {pendingMoveAction === "dismissing" ? "Saving..." : "Not now"}
        </button>
      </div>
    </section>
  );
}
