import { useEffect, useCallback, useMemo } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { DocumentRow } from "./DocumentRow";
import { DiscoveryCards } from "./DiscoveryCards";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { AiPresence } from "./AiPresence";
import { EmptyState } from "./ui/EmptyState";
import { ErrorBanner } from "./ui/ErrorBanner";
import { DocumentRowSkeleton } from "./ui/DocumentRowSkeleton";
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
  const filesLoading = useDocumentStore((s) => s.filesLoading);

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const isInbox = activeWorkspaceId === "inbox" || workspace?.is_inbox;

  const hasActiveSearch =
    searchState.query.trim().length > 0 &&
    (searchState.status === "ready" || searchState.status === "empty");
  const showSearchEmptyState =
    hasActiveSearch && searchState.resultIds.length === 0 && searchState.orphanResults.length === 0;
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

  const handleMoveToWorkspace = useCallback((documentId: string) => {
    setSelectedDocument(documentId);
  }, [setSelectedDocument]);

  const handleKeyDown = useCallback(async (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const isTypingTarget =
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.isContentEditable;
    if (isTypingTarget) return;

    if (e.key === "Escape") {
      setSelectedDocument(null);
      return;
    }

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
      <div className="border-b border-[var(--surface-4)] pb-4">
        <WorkspaceHeader workspace={workspace} />
      </div>
      <div className="flex-1 overflow-y-auto pt-2 pb-4">
        {searchState.status === "error" ? (
          <div className="px-6 pt-2">
            <ErrorBanner
              title="Sökning misslyckades"
              message={searchState.error ?? "Kunde inte slutföra sökningen."}
            />
          </div>
        ) : null}

        {filesLoading ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[var(--surface-4)]">
              <span className="h-2 w-2 shrink-0" />
              <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)] flex-[2]">Name</span>
              <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)] flex-[3]">Details</span>
              <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)] w-16 text-right">Status</span>
            </div>
            <DocumentRowSkeleton />
          </div>
        ) : showSearchEmptyState ? (
          <EmptyState
            title="Inga träffar"
            description={`Ingen match för \"${searchState.query}\". Prova ett bredare sökord.`}
            icon={<AiPresence mode="idle" accentKind={null} processingStage={null} connectionState="connected" />}
          />
        ) : docs.length === 0 ? (
          <EmptyState
            title={isInbox ? "Inbox is empty" : "No documents yet"}
            description="Drop files anywhere to process with AI"
            icon={<AiPresence mode="idle" accentKind={null} processingStage={null} connectionState="connected" />}
          />
        ) : (
          <div className="flex flex-col">
            {/* Column headers */}
            <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[var(--surface-4)]">
              <span className="h-2 w-2 shrink-0" />
              <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)] flex-[2]">Name</span>
              <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)] flex-[3]">Details</span>
              <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)] w-16 text-right">Status</span>
            </div>

            {groups.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-1.5 bg-[rgba(10,10,16,0.92)] backdrop-blur-sm">
                  <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    {group.label}
                  </span>
                  <span className="flex-1 h-px bg-[var(--surface-4)]" />
                </div>
                {group.items.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    document={doc}
                    focused={doc.id === selectedDocumentId}
                    isInbox={Boolean(isInbox)}
                    onSelectId={setSelectedDocument}
                    onMoveToWorkspace={isInbox ? handleMoveToWorkspace : undefined}
                    snippet={searchState.snippetsByDocId[doc.id]}
                    searchQuery={hasActiveSearch ? searchState.query : undefined}
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
