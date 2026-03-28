import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { DocumentRow } from "./DocumentRow";
import { DropZone } from "./DropZone";
import { WorkspaceHeader } from "./WorkspaceHeader";

export function WorkspaceView() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const toggleChatPanel = useWorkspaceStore((s) => s.toggleChatPanel);

  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);

  if (!workspace) {
    return null;
  }

  const docs = documentOrder.map((id) => documents[id]).filter(Boolean);

  return (
    <main className="glass-panel flex min-h-0 flex-1 flex-col items-stretch overflow-hidden">
      <WorkspaceHeader workspace={workspace} onToggleChat={toggleChatPanel} />
      <div className="px-6 pt-3">
        <DropZone />
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-3">
        {docs.length === 0 ? (
          <p className="flex h-full items-center justify-center text-center text-sm text-[var(--text-muted)]">
            Inga filer ännu — dra hit eller använd <kbd>⌘K</kbd>
          </p>
        ) : (
          docs.map((doc) => <DocumentRow key={doc.id} document={doc} />)
        )}
      </div>
    </main>
  );
}
