import { useEffect, useCallback, useMemo } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { DocumentRow } from "./DocumentRow";
import { BulkActionBar } from "./BulkActionBar";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceTimeline } from "./WorkspaceTimeline";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { InsightsFeed } from "./InsightsFeed";
import { SearchFilterBar } from "./SearchFilterBar";
import { AiPresence } from "./AiPresence";
import { ChatDrawer } from "./ChatDrawer";
import { EmptyState } from "./ui/EmptyState";
import { ErrorBanner } from "./ui/ErrorBanner";
import { DocumentRowSkeleton } from "./ui/DocumentRowSkeleton";
import { moveLocalFile } from "../lib/tauri-events";
import { finalizeClientMove } from "../lib/api";
import { groupByTime } from "../lib/feed-utils";
import { t } from "../lib/locale";

export function WorkspaceView() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeTab = useWorkspaceStore((s) => s.activeWorkspaceTab);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveWorkspaceTab);
  const fetchDiscovery = useDocumentStore((s) => s.fetchDiscovery);

  const clientId = useDocumentStore((s) => s.clientId);
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);
  const searchState = useDocumentStore((s) => s.search);
  const setSelectedDocument = useDocumentStore((s) => s.setSelectedDocument);
  const selectedDocumentId = useDocumentStore((s) => s.selectedDocumentId);
  const selectedDocumentIds = useDocumentStore((s) => s.selectedDocumentIds);
  const toggleDocumentSelection = useDocumentStore((s) => s.toggleDocumentSelection);
  const selectAllVisible = useDocumentStore((s) => s.selectAllVisible);
  const clearSelection = useDocumentStore((s) => s.clearSelection);
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

  // Fetch discovery cards when workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      fetchDiscovery(activeWorkspaceId);
    }
  }, [activeWorkspaceId, fetchDiscovery]);

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
      if (activeTab === "insights") {
        setActiveTab("documents");
        return;
      }
      if (selectedDocumentIds.size > 0) {
        clearSelection();
      } else {
        setSelectedDocument(null);
      }
      return;
    }

    // Cmd/Ctrl+A: select all visible documents
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault();
      selectAllVisible(docs.map((d) => d.id));
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
  }, [docs, selectedDocumentId, selectedDocumentIds, setSelectedDocument, clearSelection, selectAllVisible, isInbox, clientId, applyMoveFinalized, applyClientMoveFailure, activeTab, setActiveTab]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!workspace) {
    return null;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col items-stretch overflow-hidden bg-[rgba(0,0,0,0.1)] outline-none" tabIndex={-1}>
      <div className="border-b border-[var(--surface-4)]">
        <div className="pb-4">
          <WorkspaceHeader workspace={workspace} />
          {!isInbox && activeWorkspaceId && (
            <WorkspaceTimeline workspaceId={activeWorkspaceId} />
          )}
        </div>
        <WorkspaceTabBar />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto pt-2 pb-4">
          {activeTab === "insights" && activeWorkspaceId ? (
            <InsightsFeed workspaceId={activeWorkspaceId} />
          ) : (
          <>
          {searchState.status === "error" ? (
            <div className="px-6 pt-2">
              <ErrorBanner
                title={t("search.failed_title")}
                message={searchState.error ?? t("search.failed_message")}
              />
            </div>
          ) : null}

          {hasActiveSearch && <SearchFilterBar />}

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
              title={t("search.no_results")}
              description={t("search.no_results_hint").replace("{query}", searchState.query)}
              icon={<AiPresence mode="idle" accentKind={null} processingStage={null} connectionState="connected" />}
            />
          ) : docs.length === 0 ? (
            <EmptyState
              title={isInbox ? t("empty.inbox") : t("empty.workspace")}
              description={t("empty.drop_hint")}
              icon={<AiPresence mode="idle" accentKind={null} processingStage={null} connectionState="connected" />}
            />
          ) : (
            <div className="flex flex-col">
              {/* Column headers or bulk action bar */}
              {selectedDocumentIds.size > 0 ? (
                <BulkActionBar />
              ) : (
                <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[var(--surface-4)]">
                  <span className="h-2 w-2 shrink-0" />
                  <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)] flex-[2]">Name</span>
                  <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)] flex-[3]">Details</span>
                  <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)] w-16 text-right">Status</span>
                </div>
              )}

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
                      selected={selectedDocumentIds.has(doc.id)}
                      isInbox={Boolean(isInbox)}
                      onSelectId={setSelectedDocument}
                      onToggleSelect={toggleDocumentSelection}
                      onMoveToWorkspace={isInbox ? handleMoveToWorkspace : undefined}
                      snippet={searchState.snippetsByDocId[doc.id]}
                      searchQuery={hasActiveSearch ? searchState.query : undefined}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          </>
          )}
        </div>
        {activeWorkspaceId && <ChatDrawer workspaceId={activeWorkspaceId} />}
      </div>
    </main>
  );
}
