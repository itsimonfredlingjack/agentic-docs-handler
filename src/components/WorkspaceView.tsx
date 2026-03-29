import { useEffect, useCallback } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { DocumentRow } from "./DocumentRow";
import { DiscoveryCards } from "./DiscoveryCards";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { moveLocalFile } from "../lib/tauri-events";
import { finalizeClientMove } from "../lib/api";

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
          <div className="flex flex-col h-full bg-[rgba(255,255,255,0.01)]">
            {/* Ghost skeleton rows - hint at populated structure */}
            <div className="flex flex-col opacity-[0.4]">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-[10px] border-b border-[rgba(255,255,255,0.03)]">
                  <div className="h-2 w-2 rounded-full bg-[rgba(255,255,255,0.12)] shrink-0" />
                  <div className="h-[8px] rounded-full bg-[rgba(255,255,255,0.08)]" style={{ width: `${80 + (i * 37) % 120}px` }} />
                  <div className="flex flex-1 items-center gap-2 justify-end">
                    <div className="h-[14px] w-12 rounded bg-[rgba(255,255,255,0.04)]" />
                    <div className="h-[14px] w-16 rounded bg-[rgba(255,255,255,0.06)]" />
                  </div>
                  <div className="h-[8px] w-8 rounded-full bg-[rgba(255,255,255,0.05)] ml-4" />
                </div>
              ))}
            </div>

            {/* Centered message over ghost rows */}
            <div className="flex flex-1 flex-col items-center justify-center text-center -mt-32 relative z-10 pointer-events-none">
              <div className="bg-[#111118]/80 backdrop-blur-sm p-8 rounded-2xl border border-[rgba(255,255,255,0.04)]">
                <h3 className="text-[14px] font-semibold text-[rgba(255,255,255,0.9)] mb-2">Inbox is clean</h3>
                <p className="text-[12px] text-[rgba(255,255,255,0.4)] leading-relaxed max-w-[280px]">
                  Drag documents anywhere to process with AI. <br/>
                  <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-[rgba(255,255,255,0.2)]">
                    <kbd className="mac-kbd">⌘K</kbd> <span>to search existing files</span>
                  </div>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            {docs.map((doc) => (
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
        )}
        <div className="mt-8 px-6">
          <DiscoveryCards workspaceId={workspace.id} />
        </div>
      </div>
    </main>
  );
}

