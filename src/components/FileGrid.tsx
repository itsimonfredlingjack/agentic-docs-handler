import { dismissPendingMove, finalizeClientMove, processFile } from "../lib/api";
import { mapProcessResponseToUiDocument, mapSearchResultToGenericDocument } from "../lib/document-mappers";
import { moveLocalFile } from "../lib/tauri-events";
import { AudioTranscript } from "../templates/AudioTranscript";
import { ContractCard } from "../templates/ContractCard";
import { FileMovedCard } from "../templates/FileMovedCard";
import { GenericDocument } from "../templates/GenericDocument";
import { ReceiptCard } from "../templates/ReceiptCard";
import { useDocumentStore } from "../store/documentStore";
import type { ProcessResponse, UiDocument } from "../types/documents";

export function FileGrid() {
  const documents = useDocumentStore((state) => state.documents);
  const documentOrder = useDocumentStore((state) => state.documentOrder);
  const sidebarFilter = useDocumentStore((state) => state.sidebarFilter);
  const search = useDocumentStore((state) => state.search);
  const setSelectedDocument = useDocumentStore((state) => state.setSelectedDocument);

  const documentList = documentOrder.map((id) => documents[id]).filter(Boolean);
  const useSearchResults = search.status === "ready" || search.status === "empty";

  const filteredDocuments = useSearchResults
    ? search.status === "ready"
      ? [
          ...search.resultIds.map((id) => documents[id]).filter(Boolean),
          ...search.orphanResults.map((result) => mapSearchResultToGenericDocument(result)),
        ]
      : []
    : documentList.filter((document) => matchesFilter(document, sidebarFilter));

  if (filteredDocuments.length === 0) {
    return (
      <div
        id="document-canvas"
        className="glass-panel flex min-h-[260px] items-center justify-center p-10 text-center text-sm text-[var(--text-secondary)]"
      >
        {search.status === "empty"
          ? "No documents matched this query yet."
          : "Drop a document or ask the copilot to start filling this workspace."}
      </div>
    );
  }

  return (
    <section id="document-canvas" className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          {useSearchResults ? "Matched documents" : "Document canvas"}
        </p>
        <p className="font-mono text-[11px] text-[var(--text-muted)]">{filteredDocuments.length}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredDocuments.map((document) => (
          <div
            key={document.id}
            className={`cursor-pointer ${document.kind === "audio" ? "xl:col-span-2" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedDocument(document.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelectedDocument(document.id);
              }
            }}
          >
            {renderDocument(
              document,
              search.status === "ready"
                ? search.orphanResults.find((result) => `search:${result.doc_id}` === document.id)
                : undefined,
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function matchesFilter(
  document: UiDocument,
  filter: ReturnType<typeof useDocumentStore.getState>["sidebarFilter"],
): boolean {
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

function renderDocument(
  document: UiDocument,
  orphanResult?: ReturnType<typeof useDocumentStore.getState>["search"]["orphanResults"][number],
) {
  if (
    document.status === "uploading" ||
    document.status === "processing" ||
    document.status === "classifying" ||
    document.status === "classified" ||
    document.status === "extracting" ||
    document.status === "indexing" ||
    document.status === "organizing" ||
    document.status === "transcribing"
  ) {
    const processingMeta = getProcessingMeta(document.status);
    return (
      <article className="glass-panel flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {processingMeta.label}
            </p>
            <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)] line-clamp-2">{document.title}</h3>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-[rgba(47,111,237,0.24)] bg-[rgba(47,111,237,0.10)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-primary)]">
            <span
              className="status-dot bg-[var(--accent-primary)]"
              style={{ animation: "pulse-dot 1.5s ease-in-out infinite" }}
            />
            Running
          </span>
        </div>
        <p className="text-sm text-[var(--text-secondary)] line-clamp-2">{processingMeta.message}</p>
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
  return <GenericDocument document={document} searchResult={orphanResult} indexedOnly={Boolean(orphanResult)} />;
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
    <article className="glass-panel flex h-full flex-col gap-3 border border-[rgba(255,55,95,0.24)] bg-[rgba(255,255,255,0.72)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--invoice-color)]">Failure</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)] line-clamp-2">{document.title}</h3>
        </div>
        <span className="glass-badge shrink-0 border-[rgba(255,55,95,0.22)] bg-[rgba(255,55,95,0.10)] text-[var(--invoice-color)]">
          <span className="status-dot bg-[var(--invoice-color)]" />
          failed
        </span>
      </div>
      <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
        {document.errorCode === "audio_processing_unavailable" ? "Audio processing unavailable" : document.summary}
      </p>
      {document.retryable ? (
        <button
          type="button"
          className="focus-ring w-fit rounded-xl bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-white transition-all duration-150 hover:opacity-90"
          onClick={(e) => {
            e.stopPropagation();
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
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-3 border border-[rgba(255,159,10,0.26)] bg-[rgba(255,255,255,0.76)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--meeting-color)]">
            Move confirmation
          </p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)] line-clamp-2">{document.title}</h3>
        </div>
        <span className="glass-badge shrink-0 border-[rgba(255,159,10,0.22)] bg-[rgba(255,159,10,0.10)] text-[var(--meeting-color)]">
          <span className="status-dot bg-[var(--meeting-color)]" />
          confirm
        </span>
      </div>
      <p className="font-mono text-xs text-[var(--text-muted)] line-clamp-2">
        → {document.movePlan?.destination ?? "—"}
      </p>
      {pendingMoveError ? <p className="text-xs text-[#ff375f]">{pendingMoveError}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          className="focus-ring rounded-xl bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-white transition-all duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy}
          onClick={(e) => {
            e.stopPropagation();
            void confirmMove(document);
          }}
        >
          {pendingMoveAction === "confirming" ? "Confirming..." : "Confirm move"}
        </button>
        <button
          type="button"
          className="focus-ring rounded-xl border border-black/5 bg-white/50 px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition-all duration-150 hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy}
          onClick={(e) => {
            e.stopPropagation();
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
