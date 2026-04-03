import { useEffect, useState, startTransition } from "react";

import { CommandPalette } from "./components/CommandPalette";
import { InspectorPane } from "./components/InspectorPane";
import { FileMoveToast } from "./components/FileMoveToast";
import { WindowDropZone } from "./components/WindowDropZone";
import { ToastContainer } from "./components/ui/ToastContainer";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { WorkspaceView } from "./components/WorkspaceView";
import { WorkspaceNotebook } from "./components/WorkspaceNotebook";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { fetchWorkspaceFiles } from "./lib/api";
import { getClientId } from "./lib/tauri-events";
import { useDocumentStore } from "./store/documentStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { useWebSocket } from "./hooks/useWebSocket";

export default function App() {
  const bootstrap = useDocumentStore((s) => s.bootstrap);
  const setClientId = useDocumentStore((s) => s.setClientId);
  const setFilesLoading = useDocumentStore((s) => s.setFilesLoading);
  const selectedDocumentId = useDocumentStore((s) => s.selectedDocumentId);
  const chatPanelOpen = useWorkspaceStore((s) => s.chatPanelOpen);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const checkBackend = useWorkspaceStore((s) => s.checkBackend);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  useWebSocket();

  // Bootstrap: fetch client ID and workspaces
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const clientId = await getClientId();
        if (cancelled) return;
        setClientId(clientId);
        await checkBackend();
      } catch (error) {
        if (!cancelled) console.error("app.bootstrap.failed", error);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [setClientId, checkBackend]);

  // When active workspace changes, fetch its files
  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    setFilesLoading(true);
    async function loadFiles() {
      try {
        const payload = await fetchWorkspaceFiles(activeWorkspaceId!, 50);
        if (cancelled) return;
        startTransition(() => {
          bootstrap(
            payload.documents,
            { all: payload.total, processing: 0, receipt: 0, contract: 0, invoice: 0, meeting_notes: 0, audio: 0, generic: 0, moved: 0 },
            [],
          );
        });
      } catch (error) {
        if (!cancelled) console.error("workspace.files.failed", error);
      } finally {
        if (!cancelled) setFilesLoading(false);
      }
    }
    void loadFiles();
    return () => { cancelled = true; };
  }, [activeWorkspaceId, bootstrap, setFilesLoading]);

  // Global ⌘K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && e.metaKey) {
        e.preventDefault();
        setCmdkOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden text-[var(--text-primary)]" style={{ background: "#111118" }}>
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden">
        <div className="hidden shrink-0 lg:block">
          <WorkspaceSidebar />
        </div>

        <WorkspaceView />

        {chatPanelOpen && (
          <aside className="workspace-panel glass-panel hidden lg:flex">
            <WorkspaceNotebook />
          </aside>
        )}
        {selectedDocumentId && <InspectorPane />}
      </div>

      <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} />
      <FileMoveToast />
      <WindowDropZone />
      <ToastContainer />
    </div>
  );
}
