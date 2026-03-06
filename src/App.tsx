import { useCallback, useEffect, useRef, useState, startTransition } from "react";

import { ActivityFeed } from "./components/ActivityFeed";
import { DropOverlay } from "./components/DropOverlay";
import { FileMoveToast } from "./components/FileMoveToast";
import { HeroDropZone } from "./components/HeroDropZone";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { SkeletonCard } from "./components/Skeleton";
import { SplitView } from "./components/SplitView";
import { TinderView } from "./components/TinderView";
import { TopBar } from "./components/TopBar";
import type { ViewMode } from "./components/TopBar";
import { useFileSubmit } from "./hooks/useFileSubmit";
import { useNotifications } from "./hooks/useNotifications";
import { useWebSocket } from "./hooks/useWebSocket";
import { fetchActivity, fetchCounts, fetchDocuments } from "./lib/api";
import { getClientId } from "./lib/tauri-events";
import { useDocumentStore } from "./store/documentStore";

export default function App() {
  const bootstrap = useDocumentStore((state) => state.bootstrap);
  const setClientId = useDocumentStore((state) => state.setClientId);
  const documentCount = useDocumentStore((state) => state.documentOrder.length);
  const { submitFiles, openFilePicker, handleInputChange, fileInputRef, tauriDragOver } = useFileSubmit();
  const [viewMode, setViewMode] = useState<ViewMode>("tinder");
  const [bootstrapped, setBootstrapped] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  // Counter-based drag tracking avoids flicker from child enter/leave bubbling
  const dragCounterRef = useRef(0);
  const [browserDragOver, setBrowserDragOver] = useState(false);
  const dragOver = browserDragOver || tauriDragOver;

  useWebSocket();
  useNotifications();

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
        if (cancelled) return;
        setClientId(clientId);
        startTransition(() => {
          bootstrap(documentsPayload.documents, counts, activity.events);
        });
        if (!cancelled) setBootstrapped(true);
      } catch (error) {
        if (!cancelled) {
          console.error("app.bootstrap.failed", error);
          setBootstrapped(true);
        }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [bootstrap, setClientId]);

  // Global keyboard shortcuts: Cmd+/ (help), Cmd+N (add files)
  const onGlobalKey = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShortcutHelpOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openFilePicker();
      }
    },
    [openFilePicker],
  );

  useEffect(() => {
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, [onGlobalKey]);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setBrowserDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setBrowserDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setBrowserDragOver(false);
    void submitFiles(Array.from(e.dataTransfer.files));
  };

  const handleHeroDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setBrowserDragOver(false);
    void submitFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      className="app-shell"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <TopBar
        onDropClick={openFilePicker}
        viewMode={viewMode}
        onToggleView={() => setViewMode((v) => (v === "tinder" ? "split" : "tinder"))}
        onShowShortcuts={() => setShortcutHelpOpen(true)}
        onToggleActivity={() => setActivityOpen((v) => !v)}
        activityOpen={activityOpen}
      />

      <div className="flex min-h-0 flex-1">
        {!bootstrapped && documentCount === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="w-full max-w-[640px]">
              <SkeletonCard />
            </div>
          </div>
        ) : documentCount === 0 ? (
          <HeroDropZone onDrop={handleHeroDrop} onBrowse={openFilePicker} />
        ) : viewMode === "tinder" ? (
          <TinderView />
        ) : (
          <SplitView />
        )}
        {activityOpen && <ActivityFeed onClose={() => setActivityOpen(false)} />}
      </div>

      <DropOverlay
        visible={dragOver}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounterRef.current = 0;
          setBrowserDragOver(false);
        }}
      />

      <FileMoveToast />
      <ShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={handleInputChange}
      />
    </div>
  );
}
