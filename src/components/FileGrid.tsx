import { finalizeClientMove, processFile } from "../lib/api";
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
    return (
      <article className="glass-panel flex h-full flex-col gap-4 p-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Processing</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{document.title}</h3>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">{document.summary}</p>
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
  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-4 p-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Move confirmation</p>
        <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{document.title}</h3>
      </div>
      <p className="text-sm text-[var(--text-secondary)]">{document.summary}</p>
      <div className="rounded-2xl bg-white/45 p-3 font-mono text-xs text-[var(--text-secondary)]">
        {document.movePlan?.destination}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          className="rounded-2xl bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-white"
          onClick={() => {
            void confirmMove(document);
          }}
        >
          Confirm move
        </button>
        <button
          type="button"
          className="rounded-2xl border border-black/5 bg-white/50 px-4 py-2 text-sm font-semibold text-[var(--text-secondary)]"
          onClick={() => undefined}
        >
          Not now
        </button>
      </div>
    </article>
  );
}

async function confirmMove(document: UiDocument): Promise<void> {
  const state = useDocumentStore.getState();
  if (!state.clientId || !document.sourcePath || !document.movePlan?.destination) {
    return;
  }
  const localMove = await moveLocalFile(document.sourcePath, document.movePlan.destination);
  const finalized = await finalizeClientMove({
    recordId: document.id,
    requestId: document.requestId,
    clientId: state.clientId,
    result: localMove,
  });
  if (finalized.success) {
    useDocumentStore.getState().applyMoveFinalized(finalized);
  } else {
    useDocumentStore.getState().applyClientMoveFailure(document.requestId, "move_failed", "File move failed");
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
