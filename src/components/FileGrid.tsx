import { GenericDocument } from "../templates/GenericDocument";
import { AudioTranscript } from "../templates/AudioTranscript";
import { ContractCard } from "../templates/ContractCard";
import { FileMovedCard } from "../templates/FileMovedCard";
import { ReceiptCard } from "../templates/ReceiptCard";
import { mapSearchResultToGenericDocument } from "../lib/document-mappers";
import { useDocumentStore } from "../store/documentStore";
import type { UiDocument } from "../types/documents";

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
    return Boolean(document.moveResult?.success);
  }
  return document.kind === filter;
}

function renderDocument(document: UiDocument, orphanResult?: ReturnType<typeof useDocumentStore.getState>["search"]["orphanResults"][number]) {
  if (document.status === "uploading" || document.status === "classifying" || document.status === "extracting" || document.status === "indexing" || document.status === "organizing" || document.status === "transcribing") {
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
  if (document.kind === "file_moved") {
    return <FileMovedCard document={document} />;
  }
  if (document.moveResult?.success) {
    return <FileMovedCard document={document} />;
  }
  return <GenericDocument document={document} searchResult={orphanResult} />;
}
