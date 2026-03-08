import { useEffect, startTransition } from "react";

import { DetailPanel } from "./components/DetailPanel";
import { DropZone } from "./components/DropZone";
import { FileGrid } from "./components/FileGrid";
import { FileMoveToast } from "./components/FileMoveToast";
import { SearchBar } from "./components/SearchBar";
import { Sidebar } from "./components/Sidebar";
import { fetchActivity, fetchCounts, fetchDocuments } from "./lib/api";
import { getClientId } from "./lib/tauri-events";
import { useDocumentStore } from "./store/documentStore";
import { useWebSocket } from "./hooks/useWebSocket";

export default function App() {
  const bootstrap = useDocumentStore((state) => state.bootstrap);
  const setClientId = useDocumentStore((state) => state.setClientId);

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
    <div className="min-h-screen bg-frost px-4 py-4 text-[var(--text-primary)]">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1600px] gap-4">
        <div className="hidden lg:block">
          <Sidebar />
        </div>
        <main className="flex min-h-0 flex-1 flex-col gap-4">
          <SearchBar />
          <section className="space-y-4">
            <DropZone />
          </section>
          <FileGrid />
        </main>
      </div>
      <FileMoveToast />
      <DetailPanel />
    </div>
  );
}
