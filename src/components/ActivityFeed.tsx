import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDocumentStore } from "../store/documentStore";
import { DocumentRow } from "./DocumentRow";
import { TimeGroupHeader } from "./TimeGroupHeader";
import { groupByTime } from "../lib/feed-utils";
import { mapSearchResultToGenericDocument } from "../lib/document-mappers";
import { processFile, finalizeClientMove, completeClientUndo } from "../lib/api";
import { mapProcessResponseToUiDocument } from "../lib/document-mappers";
import { moveLocalFile, undoLocalFileMove } from "../lib/tauri-events";
import type { UiDocument } from "../types/documents";
import type { ProcessResponse } from "../types/documents";
import { isProcessingStatus } from "../lib/status";

function matchesFilter(doc: UiDocument, filter: string): boolean {
  if (isProcessingStatus(doc)) return false;
  if (filter === "all" || filter === "recent") return true;
  if (filter === "processing") {
    return doc.status !== "ready" && doc.status !== "completed" && doc.status !== "failed";
  }
  if (filter === "needs_attention") {
    return doc.status === "failed" || doc.moveStatus === "awaiting_confirmation";
  }
  if (filter === "moved") {
    return doc.moveStatus === "moved";
  }
  if (filter === "modality_text") return doc.sourceModality === "text";
  if (filter === "modality_image") return doc.sourceModality === "image";
  if (filter === "modality_audio") return doc.sourceModality === "audio";
  return doc.kind === filter;
}

export function ActivityFeed() {
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);
  const sidebarFilter = useDocumentStore((s) => s.sidebarFilter);
  const search = useDocumentStore((s) => s.search);
  const setSelectedDocument = useDocumentStore((s) => s.setSelectedDocument);

  const orderedDocs = useMemo(() => {
    const useSearch = search.status === "ready" || search.status === "empty";
    if (useSearch) {
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

  const processingDocs = useMemo(() => orderedDocs.filter((doc) => isProcessingStatus(doc) && doc.status !== 'ready'), [orderedDocs]);
  const pendingMoves = useMemo(() => orderedDocs.filter((doc) => doc.moveStatus === "awaiting_confirmation"), [orderedDocs]);
  const feedDocs = useMemo(() => orderedDocs.filter((doc) => !processingDocs.includes(doc) && !pendingMoves.includes(doc)), [orderedDocs, processingDocs, pendingMoves]);

  const now = useMemo(() => Date.now(), [feedDocs]);
  const groups = useMemo(
    () => groupByTime(feedDocs, (doc) => doc.updatedAt ?? doc.createdAt, now),
    [feedDocs, now],
  );

  const [focusedIndex, setFocusedIndex] = useState(-1);
  const feedRef = useRef<HTMLDivElement>(null);

  // Reset focus when list changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [orderedDocs.length, sidebarFilter]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        // But allow "/" to blur and focus search
        if (e.key === "/") return;
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        (document.querySelector<HTMLInputElement>('input[aria-label="Sök i dokument"]'))?.focus();
        return;
      }

      if (orderedDocs.length === 0) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.min(prev + 1, orderedDocs.length - 1);
          scrollRowIntoView(next);
          return next;
        });
        return;
      }

      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          scrollRowIntoView(next);
          return next;
        });
        return;
      }

      if (e.key === "Enter" && focusedIndex >= 0 && focusedIndex < orderedDocs.length) {
        e.preventDefault();
        setSelectedDocument(orderedDocs[focusedIndex].id);
        return;
      }
    },
    [orderedDocs, focusedIndex, setSelectedDocument],
  );

  function scrollRowIntoView(index: number) {
    const row = feedRef.current?.querySelectorAll('[data-testid="document-row"]')?.[index];
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const useSearch = search.status === "ready" || search.status === "empty";

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
    <section id="document-canvas" className="space-y-4 pb-3">
      {/* Engine Room */}
      {processingDocs.length > 0 && (
        <div className="border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.4)] rounded-md p-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] tracking-[0.08em] uppercase text-[var(--text-muted)] font-bold">Local Compute</span>
            <span className="text-[10px] tracking-widest text-[var(--accent-primary)] font-[var(--font-mono)]">{processingDocs.length} Active</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[var(--accent-primary)] text-xs animate-pulse">█</span>
              <span className="truncate flex-1 text-xs font-medium text-white">{processingDocs[0].title}</span>
              <span className="text-[10px] text-[var(--text-disabled)] uppercase font-[var(--font-mono)]">[{processingDocs[0].status}]</span>
            </div>
            {processingDocs.length > 1 && (
              <div className="pl-4 text-[10px] text-[var(--text-disabled)] font-[var(--font-mono)] opacity-70">
                + {processingDocs.length - 1} queued
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pending Routing */}
      {pendingMoves.length > 0 && (
        <div className="border border-[var(--meeting-color)] bg-[rgba(255,159,10,0.06)] rounded-md p-3">
           <div className="text-[10px] uppercase text-[var(--meeting-color)] mb-2.5 tracking-[0.08em] font-bold flex justify-between">
             <span>Awaiting Routing</span>
             <span>({pendingMoves.length})</span>
           </div>
           <div className="flex flex-col gap-0.5">
             {pendingMoves.map(move => (
                <div key={move.id} className="flex flex-col sm:flex-row sm:items-center justify-between py-1.5 border-b border-[rgba(255,255,255,0.04)] last:border-0 gap-2">
                  <div className="flex flex-col min-w-0 pr-2">
                     <span className="truncate text-xs font-medium text-white">{move.title}</span>
                     <span className="truncate text-[10px] text-[var(--text-muted)] font-[var(--font-mono)] mt-0.5">
                       {move.sourcePath?.split("/").pop()} → {move.movePlan?.destination?.split("/").slice(-3).join("/") || "Unknown"}
                     </span>
                  </div>
                  {/* TODO: Implement bulk/single approve dispatch properly instead of using retry tricks */}
                  <button className="shrink-0 bg-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.15)] text-white text-[11px] px-3 py-1 rounded transition-colors self-start sm:self-auto border border-[rgba(255,255,255,0.04)]" onClick={() => {
                        console.log("Approve missing action handler", move.id);
                  }}>Approve</button>
                </div>
             ))}
           </div>
        </div>
      )}

      {/* Normal Feed */}
      <div className="flex items-center justify-between gap-3 px-1 border-b border-[rgba(255,255,255,0.06)] pb-1.5">
        <p className="text-[10px] tracking-[0.08em] uppercase font-bold text-[var(--text-muted)]">
          {useSearch ? "Search Results" : "Indexed Documents"}
          {useSearch && processingDocs.length > 0 && (
            <span className="ml-2 text-[var(--text-disabled)] normal-case font-normal">(Vector indexing in progress for recent files...)</span>
          )}
        </p>
        <p className="font-[var(--font-mono)] text-[10px] text-[var(--text-muted)]">{feedDocs.length}</p>
      </div>
      <div className="activity-feed" ref={feedRef}>
        {groups.map((group) => (
          <div key={group.label} className="activity-feed__group">
            <TimeGroupHeader label={group.label} />
            <div className="activity-feed__cards">
              {group.items.map((doc) => {
                const flatIndex = orderedDocs.indexOf(doc);
                const snippet = useSearch ? search.snippetsByDocId[doc.id] ?? (doc.summary || undefined) : undefined;
                return (
                  <DocumentRow
                    key={doc.id}
                    document={doc}
                    focused={flatIndex === focusedIndex}
                    snippet={snippet}
                    searchQuery={useSearch ? search.query : undefined}
                    onSelect={() => setSelectedDocument(doc.id)}
                    onRetry={
                      doc.retryable
                        ? () => void retryDocument(doc.requestId)
                        : undefined
                    }
                    onUndo={
                      doc.moveStatus === "moved" && doc.undoToken
                        ? () => void undoDocument(doc)
                        : undefined
                    }
                  />
                );
              })}
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

async function undoDocument(doc: UiDocument): Promise<void> {
  const state = useDocumentStore.getState();
  if (!doc.undoToken || !state.clientId || !doc.moveResult?.to_path || !doc.moveResult?.from_path) return;
  const moveResult = await undoLocalFileMove(doc.moveResult.to_path, doc.moveResult.from_path);
  const payload = await completeClientUndo({
    undoToken: doc.undoToken,
    clientId: state.clientId,
    result: moveResult,
  });
  state.applyUndoSuccess(payload);
}
