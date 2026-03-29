import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { DocumentRow } from "./DocumentRow";
import { DiscoveryCards } from "./DiscoveryCards";
import { DropZone } from "./DropZone";
import { SearchBar } from "./SearchBar";
import { WorkspaceHeader } from "./WorkspaceHeader";

export function WorkspaceView() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const toggleChatPanel = useWorkspaceStore((s) => s.toggleChatPanel);

  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);
  const searchState = useDocumentStore((s) => s.search);

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);

  if (!workspace) {
    return null;
  }

  const hasActiveSearch = searchState.query.trim().length > 0 && searchState.status === "ready";
  const visibleIds = hasActiveSearch ? searchState.resultIds : documentOrder;
  const docs = visibleIds.map((id) => documents[id]).filter(Boolean);

  return (
    <main className="flex min-h-0 flex-1 flex-col items-stretch overflow-hidden bg-[rgba(0,0,0,0.1)]">
      <div className="bg-[rgba(255,255,255,0.02)] border-b border-[rgba(255,255,255,0.04)] pb-4">
        <WorkspaceHeader workspace={workspace} onToggleChat={toggleChatPanel} />
        <div className="px-6 mt-2 space-y-3">
          <SearchBar
            activeFilterLabel={workspace.name}
            onOpenFilters={() => undefined}
            showFilters={false}
            enableAiSummary={false}
          />
          <DropZone />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {docs.length === 0 ? (
          <div className="flex h-[80%] flex-col items-center justify-center text-center">
            <div className="border border-dashed border-[rgba(255,255,255,0.1)] rounded-lg py-12 px-10 max-w-sm w-full bg-[rgba(255,255,255,0.01)]">
              <span className="block text-2xl opacity-60 text-[var(--text-muted)] mb-3">↓</span>
              <h3 className="text-sm font-semibold text-[rgba(255,255,255,0.9)] mb-1">Ready for triage</h3>
              <p className="text-[13px] text-[rgba(255,255,255,0.4)] leading-relaxed">
                Drop documents to begin local processing.<br/>Press <kbd className="mac-kbd mx-1">⌘K</kbd> to search.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {docs.map((doc) => (
              <DocumentRow
                key={doc.id}
                document={doc}
                snippet={searchState.snippetsByDocId[doc.id]}
                searchQuery={hasActiveSearch ? searchState.query : undefined}
              />
            ))}
          </div>
        )}
        <div className="mt-8">
          <DiscoveryCards workspaceId={workspace.id} />
        </div>
      </div>
    </main>
  );
}
