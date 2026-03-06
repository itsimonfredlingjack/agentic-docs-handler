import { useEffect, useRef, useState, startTransition } from "react";

import { DropOverlay } from "./components/DropOverlay";
import { FileMoveToast } from "./components/FileMoveToast";
import { HeroDropZone } from "./components/HeroDropZone";
import { SplitView } from "./components/SplitView";
import { TopBar } from "./components/TopBar";
import { useFileSubmit } from "./hooks/useFileSubmit";
import { useWebSocket } from "./hooks/useWebSocket";
import { fetchActivity, fetchCounts, fetchDocuments } from "./lib/api";
import { getClientId } from "./lib/tauri-events";
import { useDocumentStore } from "./store/documentStore";

export default function App() {
  const bootstrap = useDocumentStore((state) => state.bootstrap);
  const setClientId = useDocumentStore((state) => state.setClientId);
  const documentCount = useDocumentStore((state) => state.documentOrder.length);
  const { submitFiles, openFilePicker, handleInputChange, fileInputRef, tauriDragOver } = useFileSubmit();

  // Counter-based drag tracking avoids flicker from child enter/leave bubbling
  const dragCounterRef = useRef(0);
  const [browserDragOver, setBrowserDragOver] = useState(false);
  const dragOver = browserDragOver || tauriDragOver;

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
        if (cancelled) return;
        setClientId(clientId);
        startTransition(() => {
          bootstrap(documentsPayload.documents, counts, activity.events);
        });
      } catch (error) {
        if (!cancelled) console.error("app.bootstrap.failed", error);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [bootstrap, setClientId]);

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
      <TopBar onDropClick={openFilePicker} />

      {documentCount === 0 ? (
        <HeroDropZone onDrop={handleHeroDrop} onBrowse={openFilePicker} />
      ) : (
        <SplitView />
      )}

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
