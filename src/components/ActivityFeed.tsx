import { useMemo } from "react";
import { useDocumentStore } from "../store/documentStore";
import { FeedCard } from "./FeedCard";
import { TimeGroupHeader } from "./TimeGroupHeader";
import { groupByTime } from "../lib/feed-utils";
import { mapSearchResultToGenericDocument } from "../lib/document-mappers";
import { processFile, finalizeClientMove, dismissPendingMove } from "../lib/api";
import { mapProcessResponseToUiDocument } from "../lib/document-mappers";
import { moveLocalFile } from "../lib/tauri-events";
import type { UiDocument, SearchResult } from "../types/documents";
import type { ProcessResponse } from "../types/documents";

function matchesFilter(doc: UiDocument, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "processing") {
    return doc.status !== "ready" && doc.status !== "completed" && doc.status !== "failed";
  }
  if (filter === "moved") {
    return doc.moveStatus === "moved";
  }
  return doc.kind === filter;
}

export function ActivityFeed() {
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);
  const stageHistory = useDocumentStore((s) => s.stageHistory);
  const sidebarFilter = useDocumentStore((s) => s.sidebarFilter);
  const search = useDocumentStore((s) => s.search);
  const setSelectedDocument = useDocumentStore((s) => s.setSelectedDocument);

  const orderedDocs = useMemo(() => {
    const useSearchResults = search.status === "ready" || search.status === "empty";
    if (useSearchResults) {
      if (search.status === "ready") {
        return [
          ...search.resultIds.map((id) => documents[id]).filter(Boolean),
          ...search.orphanResults.map((result) => mapSearchResultToGenericDocument(result)),
        ];
      }
      return [];
    }
    return documentOrder
      .map((id) => documents[id])
      .filter(Boolean)
      .filter((doc) => matchesFilter(doc, sidebarFilter));
  }, [documents, documentOrder, sidebarFilter, search]);

  const now = useMemo(() => Date.now(), [orderedDocs]);
  const groups = useMemo(
    () => groupByTime(orderedDocs, (doc) => doc.updatedAt ?? doc.createdAt, now),
    [orderedDocs, now],
  );

  const useSearchResults = search.status === "ready" || search.status === "empty";

  if (orderedDocs.length === 0) {
    return (
      <div
        id="document-canvas"
        className="glass-panel flex min-h-[400px] flex-col items-center justify-center p-10 text-center animate-fade-in-up"
      >
        <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--accent-surface)] text-3xl shadow-inner">
          <span className="animate-pulse">📄</span>
          <div className="absolute -right-1 -top-1 h-4 w-4 animate-ping rounded-full bg-[var(--accent-primary)] opacity-40" />
        </div>
        <h3 className="text-lg font-bold text-[var(--text-primary)]">
          {search.status === "empty" ? "Knäpptyst här..." : "Din digitala assistent vilar"}
        </h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--text-secondary)]">
          {search.status === "empty"
            ? "Inga dokument matchade din sökning. Testa att bredda dina sökord eller rensa filtret."
            : "Det finns inga dokument i den här vyn ännu. Dra in dina filer i panelen till vänster för att låta AI:n sortera och indexera dem åt dig."}
        </p>
      </div>
    );
  }

  return (
    <section id="document-canvas" className="space-y-1 pb-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="section-kicker">
          {useSearchResults ? "Sökresultat" : "Aktivitetsflöde"}
        </p>
        <p className="font-mono text-[11px] text-[var(--text-muted)]">{orderedDocs.length}</p>
      </div>
      <div className="activity-feed">
        {groups.map((group) => (
          <div key={group.label} className="activity-feed__group">
            <TimeGroupHeader label={group.label} />
            <div className="activity-feed__cards">
              {group.items.map((doc) => (
                <FeedCard
                  key={doc.id}
                  document={doc}
                  history={stageHistory[doc.requestId] ?? []}
                  onSelect={() => setSelectedDocument(doc.id)}
                  onRetry={
                    doc.retryable
                      ? () => void retryDocument(doc.requestId)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
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
