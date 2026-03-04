import { dismissPendingMove, finalizeClientMove, processFile } from "../lib/api";
import { mapProcessResponseToUiDocument, mapSearchResultToGenericDocument } from "../lib/document-mappers";
import { moveLocalFile } from "../lib/tauri-events";
import { GenericDocument } from "../templates/GenericDocument";
import { AudioTranscript } from "../templates/AudioTranscript";
import { ContractCard } from "../templates/ContractCard";
import { FileMovedCard } from "../templates/FileMovedCard";
import { ReceiptCard } from "../templates/ReceiptCard";
import { useDocumentStore } from "../store/documentStore";
import type { ProcessResponse, UiDocument } from "../types/documents";

export function FileGrid() {
  const documents = useDocumentStore((state) => state.documents);
  const documentOrder = useDocumentStore((state) => state.documentOrder);
  const sidebarFilter = useDocumentStore((state) => state.sidebarFilter);
  const search = useDocumentStore((state) => state.search);

  const documentList = documentOrder.map((id) => documents[id]).filter(Boolean);
  const filteredDocuments = search.active
    ? [
        ...search.resultIds.map((id) => documents[id]).filter(Boolean),
        ...search.orphanResults.map((result) => mapSearchResultToGenericDocument(result)),
      ]
    : documentList.filter((document) => matchesFilter(document, sidebarFilter));

  if (filteredDocuments.length === 0) {
    return (
      <div className="glass-panel flex min-h-[260px] items-center justify-center p-10 text-center text-sm text-[var(--text-secondary)]">
        Droppa ett dokument eller skriv en fråga för att fylla den här vyn.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 lg:grid-cols-2">
      {filteredDocuments.map((document) => (
        <div key={document.id} className={document.kind === "audio" ? "xl:col-span-2" : ""}>
          {renderDocument(document, search.active ? search.orphanResults.find((result) => `search:${result.doc_id}` === document.id) : undefined)}
        </div>
      ))}
    </div>
  );
}

function matchesFilter(document: UiDocument, filter: ReturnType<typeof useDocumentStore.getState>["sidebarFilter"]): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "processing") {
    return document.status !== "ready" && document.status !== "completed";
  }
  if (filter === "moved") {
    return document.moveStatus === "moved";
  }
  return document.kind === filter;
}

function renderDocument(document: UiDocument, orphanResult?: ReturnType<typeof useDocumentStore.getState>["search"]["orphanResults"][number]) {
  if (document.status === "uploading" || document.status === "processing" || document.status === "classifying" || document.status === "classified" || document.status === "extracting" || document.status === "indexing" || document.status === "organizing" || document.status === "transcribing") {
    const processingMeta = getProcessingMeta(document.status);
    return (
      <article className="glass-panel flex h-full flex-col gap-4 p-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">{processingMeta.label}</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{document.title}</h3>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">{processingMeta.message}</p>
        <div className="processing-bar" />
      </article>
    );
  }
  if (document.status === "failed") {
    return <FailureCard document={document} />;
  }
  if (document.moveStatus === "awaiting_confirmation" && document.movePlan?.destination) {
    return <PendingMoveCard document={document} />;
  }
  if (document.kind === "receipt") {
    return <ReceiptCard document={document} />;
  }
  if (document.kind === "invoice") {
    return <ReceiptCard document={document} variant="invoice" />;
  }
  if (document.kind === "contract") {
    return <ContractCard document={document} />;
  }
  if (document.kind === "audio" || (document.kind === "meeting_notes" && document.transcription?.segments.length)) {
    return <AudioTranscript document={document} />;
  }
  if (document.kind === "file_moved" || document.moveStatus === "moved" || document.moveResult?.success) {
    return <FileMovedCard document={document} />;
  }
  return <GenericDocument document={document} searchResult={orphanResult} />;
}

function getProcessingMeta(status: UiDocument["status"]): { label: string; message: string } {
  switch (status) {
    case "uploading":
      return { label: "Uploading", message: "Laddar upp filen till orkestratorn." };
    case "processing":
      return { label: "Queued", message: "Väntar på modellkön för nästa bearbetningssteg." };
    case "classifying":
      return { label: "Classifying", message: "Identifierar dokumenttypen." };
    case "classified":
      return { label: "Classified", message: "Dokumenttypen är klar, nästa steg är fältextraktion." };
    case "extracting":
      return { label: "Extracting", message: "Plockar ut fält och nyckelinformation." };
    case "organizing":
      return { label: "Organizing", message: "Planerar sortering och målmapp." };
    case "indexing":
      return { label: "Indexing", message: "Skriver dokumentet till sökindexet i bakgrunden." };
    case "transcribing":
      return { label: "Transcribing", message: "Transkriberar ljudfilen innan klassificering." };
    default:
      return { label: "Processing", message: "Bearbetar dokumentet." };
  }
}

function FailureCard({ document }: { document: UiDocument }) {
  return (
    <article className="glass-panel flex h-full flex-col gap-4 p-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Failed</p>
        <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{document.title}</h3>
      </div>
      <p className="text-sm text-[var(--text-secondary)]">{document.errorCode === "audio_processing_unavailable" ? "Audio processing unavailable" : document.summary}</p>
      {document.retryable ? (
        <button
          type="button"
          className="w-fit rounded-2xl bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-white"
          onClick={() => {
            void retryDocument(document.requestId);
          }}
        >
          Retry
        </button>
      ) : null}
    </article>
  );
}

function PendingMoveCard({ document }: { document: UiDocument }) {
  const pendingMoveAction = useDocumentStore(
    (state) => state.pendingMoveStateByRecordId[document.id]?.action ?? "idle",
  );
  const pendingMoveError = useDocumentStore(
    (state) => state.pendingMoveStateByRecordId[document.id]?.error ?? null,
  );
  const isBusy = pendingMoveAction !== "idle";

  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-4 p-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Move confirmation</p>
        <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{document.title}</h3>
      </div>
      <p className="text-sm text-[var(--text-secondary)]">{document.summary}</p>
      <div className="rounded-2xl bg-white/45 p-3 font-mono text-xs text-[var(--text-secondary)]">
        <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Source</p>
        <p className="mt-1 break-all">{document.sourcePath ?? "—"}</p>
        <p className="mt-3 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Destination</p>
        <p className="mt-1 break-all">{document.movePlan?.destination ?? "—"}</p>
      </div>
      {pendingMoveError ? (
        <p className="rounded-2xl border border-red-200/70 bg-red-50/80 px-3 py-2 text-sm text-red-700">
          {pendingMoveError}
        </p>
      ) : null}
      <div className="flex gap-3">
        <button
          type="button"
          className="rounded-2xl bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy}
          onClick={() => {
            void confirmMove(document);
          }}
        >
          {pendingMoveAction === "confirming" ? "Confirming..." : "Confirm move"}
        </button>
        <button
          type="button"
          className="rounded-2xl border border-black/5 bg-white/50 px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy}
          onClick={() => {
            void dismissMove(document);
          }}
        >
          {pendingMoveAction === "dismissing" ? "Saving..." : "Not now"}
        </button>
      </div>
    </article>
  );
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
    state.setPendingMoveError(
      document.id,
      error instanceof Error ? error.message : "move_failed",
    );
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
    state.setPendingMoveError(
      document.id,
      error instanceof Error ? error.message : "move_dismiss_failed",
    );
    state.setPendingMoveAction(document.id, "idle");
  }
}

async function retryDocument(requestId: string): Promise<void> {
  const state = useDocumentStore.getState();
  const upload = state.uploadsByRequestId[requestId];
  if (!upload || !state.clientId) {
    return;
  }
  state.markJobStage(requestId, "uploading");
  const response = await processFile({
    file: upload.file,
    sourcePath: upload.sourcePath,
    clientId: state.clientId,
    requestId,
    executeMove: Boolean(upload.sourcePath),
    moveExecutor: "client",
  });
  const document = mapProcessResponseToUiDocument(response as ProcessResponse);
  state.upsertDocument(document);
  if (
    response.move_status === "auto_pending_client" &&
    response.move_plan.destination &&
    document.sourcePath &&
    response.record_id
  ) {
    const localMove = await moveLocalFile(document.sourcePath, response.move_plan.destination);
    const finalized = await finalizeClientMove({
      recordId: response.record_id,
      requestId,
      clientId: state.clientId,
      result: localMove,
    });
    if (finalized.success) {
      state.applyMoveFinalized(finalized);
    }
  }
  if (response.move_status !== "awaiting_confirmation") {
    state.clearRememberedUpload(requestId);
  }
}
