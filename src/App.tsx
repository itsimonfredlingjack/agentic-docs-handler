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
import { fetchActivity, fetchCounts, fetchDocuments } from "./lib/api";
import { getClientId } from "./lib/tauri-events";
import { useDocumentStore } from "./store/documentStore";
import { useWebSocket } from "./hooks/useWebSocket";

export default function App() {
  const bootstrap = useDocumentStore((state) => state.bootstrap);
  const setClientId = useDocumentStore((state) => state.setClientId);
  const sidebarFilter = useDocumentStore((state) => state.sidebarFilter);
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
    <div className="min-h-screen bg-frost text-[var(--text-primary)]">
      <div className="mx-auto flex min-h-screen max-w-[1720px] gap-6 px-[var(--canvas-padding)] py-[var(--canvas-padding)]">
        <div className="hidden shrink-0 lg:block">
          <Sidebar />
        </div>
        <main className="flex min-h-0 flex-1 flex-col gap-4">
          <SearchBar
            activeFilterLabel={getSidebarFilterLabel(sidebarFilter)}
            onOpenFilters={() => setFilterSheetOpen(true)}
          />
          <DropZone />
          <ProcessingRail />
          <ActivityFeed />
        </main>
      </div>
      <MobileFilterSheet open={isFilterSheetOpen} onClose={() => setFilterSheetOpen(false)} />
      <FileMoveToast />
      <DetailPanel />
    </div>
  );
}
