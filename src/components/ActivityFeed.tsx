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

  const now = useMemo(() => Date.now(), [orderedDocs]);
  const groups = useMemo(
    () => groupByTime(orderedDocs, (doc) => doc.updatedAt ?? doc.createdAt, now),
    [orderedDocs, now],
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
    <section id="document-canvas" className="space-y-1 pb-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="section-kicker">
          {useSearch ? "Sökresultat" : "Dokument"}
        </p>
        <p className="font-mono text-[11px] text-[var(--text-muted)]">{orderedDocs.length}</p>
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
