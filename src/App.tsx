import { useEffect, startTransition, useState } from "react";

import { DetailPanel } from "./components/DetailPanel";
import { DropZone } from "./components/DropZone";
import { ProcessingRail } from "./components/ProcessingRail";
import { ActivityFeed } from "./components/ActivityFeed";
import { FileMoveToast } from "./components/FileMoveToast";
import { MobileFilterSheet } from "./components/MobileFilterSheet";
import { SearchBar } from "./components/SearchBar";
import { Sidebar } from "./components/Sidebar";
import { getSidebarFilterLabel } from "./components/sidebarFilters";
import { WorkspaceGrid } from "./components/WorkspaceGrid";
import { WorkspaceNotebook } from "./components/WorkspaceNotebook";
import { fetchActivity, fetchCounts, fetchDocuments } from "./lib/api";
import { getClientId } from "./lib/tauri-events";
import { useDocumentStore } from "./store/documentStore";
import { useWebSocket } from "./hooks/useWebSocket";

export default function App() {
  const bootstrap = useDocumentStore((state) => state.bootstrap);
  const setClientId = useDocumentStore((state) => state.setClientId);
  const sidebarFilter = useDocumentStore((state) => state.sidebarFilter);
  const viewMode = useDocumentStore((s) => s.viewMode);
  const activeWorkspace = useDocumentStore((s) => s.activeWorkspace);
  const [isFilterSheetOpen, setFilterSheetOpen] = useState(false);

  useWebSocket();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [clientId, documentsPayload, counts, activity] = await Promise.all([
          getClientId(),
          fetchDocuments(50),
          fetchCounts(),
          fetchActivity(10),
        ]);
        if (cancelled) {
          return;
        }
        setClientId(clientId);
        startTransition(() => {
          bootstrap(documentsPayload.documents, counts, activity.events);
        });
      } catch (error) {
        if (!cancelled) {
          console.error("app.bootstrap.failed", error);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [bootstrap, setClientId]);

  return (
    <div className="min-h-screen text-[var(--text-primary)]" style={{ background: '#111118' }}>
      <div className="mx-auto flex min-h-screen max-w-[1720px] gap-3 p-3">
        <div className="hidden shrink-0 lg:block">
          <Sidebar />
        </div>
        <main className="glass-panel flex min-h-0 flex-1 flex-col gap-4 p-4">
          {viewMode === "activity" ? (
            <>
              <SearchBar
                activeFilterLabel={getSidebarFilterLabel(sidebarFilter)}
                onOpenFilters={() => setFilterSheetOpen(true)}
              />
              <DropZone />
              <ProcessingRail />
              <ActivityFeed />
            </>
          ) : activeWorkspace ? (
            <WorkspaceNotebook />
          ) : (
            <>
              <ProcessingRail />
              <WorkspaceGrid />
            </>
          )}
        </main>
      </div>
      <MobileFilterSheet open={isFilterSheetOpen} onClose={() => setFilterSheetOpen(false)} />
      <FileMoveToast />
      <DetailPanel />
    </div>
  );
}
