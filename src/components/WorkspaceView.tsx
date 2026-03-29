import { useEffect, useCallback, useMemo } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { DocumentRow } from "./DocumentRow";
import { DiscoveryCards } from "./DiscoveryCards";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { moveLocalFile } from "../lib/tauri-events";
import { finalizeClientMove } from "../lib/api";
import { groupByTime } from "../lib/feed-utils";

export function WorkspaceView() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const clientId = useDocumentStore((s) => s.clientId);
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);
  const searchState = useDocumentStore((s) => s.search);
  const setSelectedDocument = useDocumentStore((s) => s.setSelectedDocument);
  const selectedDocumentId = useDocumentStore((s) => s.selectedDocumentId);
  const applyMoveFinalized = useDocumentStore((s) => s.applyMoveFinalized);
  const applyClientMoveFailure = useDocumentStore((s) => s.applyClientMoveFailure);

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const isInbox = activeWorkspaceId === "inbox" || workspace?.is_inbox;

  const hasActiveSearch = searchState.query.trim().length > 0 && searchState.status === "ready";
  const visibleIds = hasActiveSearch ? searchState.resultIds : documentOrder;
  const docs = visibleIds.map((id) => documents[id]).filter(Boolean);
  const groups = useMemo(
    () => groupByTime(docs, (d) => d.updatedAt ?? d.createdAt),
    [docs],
  );

  useEffect(() => {
    if (docs.length > 0 && !selectedDocumentId) {
      setSelectedDocument(docs[0].id);
    }
  }, [docs, selectedDocumentId, setSelectedDocument]);

  const handleKeyDown = useCallback(async (e: KeyboardEvent) => {
    if (docs.length === 0) return;
    const currentIndex = docs.findIndex(d => d.id === selectedDocumentId);
    let targetIndex = currentIndex === -1 ? 0 : currentIndex;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      targetIndex = Math.min(currentIndex + 1, docs.length - 1);
      setSelectedDocument(docs[targetIndex].id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      targetIndex = Math.max(currentIndex - 1, 0);
      setSelectedDocument(docs[targetIndex].id);
    } else if (e.key === "Enter" && isInbox && clientId) {
      e.preventDefault();
      const doc = docs[targetIndex];
      if (doc && doc.movePlan?.destination && doc.sourcePath) {
        try {
          const moveResult = await moveLocalFile(doc.sourcePath, doc.movePlan.destination);
          const finalized = await finalizeClientMove({
            recordId: doc.id,
            requestId: doc.requestId,
            clientId,
            result: moveResult,
          });
          applyMoveFinalized(finalized);
        } catch (err) {
          applyClientMoveFailure(doc.requestId, "move_failed", String(err));
        }
      }
    }
  }, [docs, selectedDocumentId, setSelectedDocument, isInbox, clientId, applyMoveFinalized, applyClientMoveFailure]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!workspace) {
    return null;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col items-stretch overflow-hidden bg-[rgba(0,0,0,0.1)] outline-none" tabIndex={-1}>
      <div className="border-b border-[rgba(255,255,255,0.04)] pb-4">
        <WorkspaceHeader workspace={workspace} />
      </div>
      <div className="flex-1 overflow-y-auto pt-2 pb-4">
        {docs.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[rgba(255,255,255,0.15)] mb-4">
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.3" />
              <path d="M3 9h18" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <h3 className="text-[13px] font-medium text-[rgba(255,255,255,0.45)] mb-1">
              {isInbox ? "Inbox is empty" : "No documents yet"}
            </h3>
            <p className="text-[12px] text-[rgba(255,255,255,0.22)] leading-relaxed">
              Drop files anywhere to process with AI
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Column headers */}
            <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[rgba(255,255,255,0.04)]">
              <span className="h-2 w-2 shrink-0" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[rgba(255,255,255,0.18)] flex-[2]">Name</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[rgba(255,255,255,0.18)] flex-[3]">Details</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[rgba(255,255,255,0.18)] w-16 text-right">Status</span>
            </div>

            {groups.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-1.5 bg-[rgba(10,10,16,0.92)] backdrop-blur-sm">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgba(255,255,255,0.28)]">
                    {group.label}
                  </span>
                  <span className="flex-1 h-px bg-[rgba(255,255,255,0.04)]" />
                </div>
                {group.items.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    document={doc}
                    focused={doc.id === selectedDocumentId}
                    isInbox={Boolean(isInbox)}
                    snippet={searchState.snippetsByDocId[doc.id]}
                    searchQuery={hasActiveSearch ? searchState.query : undefined}
                    onSelect={() => setSelectedDocument(doc.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="mt-8 px-6">
          <DiscoveryCards workspaceId={workspace.id} />
        </div>
      </div>
    </main>
  );
}

