import { useDocumentStore } from "../store/documentStore";
import { useEffect, useMemo, useState } from "react";
import { kindColor } from "../lib/document-colors";
import type { SidebarFilter, UiDocumentKind } from "../types/documents";

const CHAT_CATEGORY_ITEMS: Array<{ id: string; label: string }> = [
  { id: "receipt", label: "Kvitton" },
  { id: "contract", label: "Avtal" },
  { id: "invoice", label: "Fakturor" },
  { id: "meeting_notes", label: "Möten" },
  { id: "audio", label: "Ljud" },
];

const MODALITY_ITEMS: Array<{ id: string; label: string; modality: string }> = [
  { id: "modality_text", label: "Dokument", modality: "text" },
  { id: "modality_image", label: "Bilder", modality: "image" },
  { id: "modality_audio", label: "Ljud", modality: "audio" },
];

function KineticNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (value !== displayValue) {
      setAnimating(true);
      const timer = setTimeout(() => {
        setDisplayValue(value);
        setAnimating(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [value, displayValue]);

  return (
    <span
      className={`inline-block tabular-nums transition-all duration-300 ${animating ? "scale-110 -translate-y-0.5 text-[var(--accent-primary)]" : "opacity-70"}`}
    >
      {displayValue}
    </span>
  );
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path
        d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5.5L3 13.5V11H3a1 1 0 0 1-1-1V3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M5.5 5.5h5M5.5 7.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function Sidebar() {
  const counts = useDocumentStore((state) => state.counts);
  const documents = useDocumentStore((state) => state.documents);
  const sidebarFilter = useDocumentStore((state) => state.sidebarFilter);
  const setSidebarFilter = useDocumentStore((state) => state.setSidebarFilter);
  const setActiveWorkspace = useDocumentStore((state) => state.setActiveWorkspace);
  const activeWorkspace = useDocumentStore((state) => state.activeWorkspace);
  const connectionState = useDocumentStore((state) => state.connectionState);
  const statusLabel = connectionState === "connected" ? "Ansluten" : "Ansluter";
  const isHome = sidebarFilter === "all";

  // Count documents by modality
  const modalityCounts = useMemo(() => {
    const mc: Record<string, number> = { text: 0, image: 0, audio: 0 };
    for (const doc of Object.values(documents)) {
      if (doc.sourceModality && mc[doc.sourceModality] !== undefined) {
        mc[doc.sourceModality]++;
      }
    }
    return mc;
  }, [documents]);

  const needsAttentionCount = useMemo(
    () => Object.values(documents).filter(
      (d) => d.status === "failed" || d.moveStatus === "awaiting_confirmation",
    ).length,
    [documents],
  );

  // Only show chat categories that have documents
  const visibleChatItems = useMemo(
    () => CHAT_CATEGORY_ITEMS.filter(
      (item) => {
        const key = item.id as keyof typeof counts;
        return (counts[key] || 0) > 0;
      },
    ),
    [counts],
  );

  // Only show modality filters that have documents
  const visibleModalityItems = useMemo(
    () => MODALITY_ITEMS.filter((item) => (modalityCounts[item.modality] || 0) > 0),
    [modalityCounts],
  );

  const handleHomeClick = () => {
    setSidebarFilter("all");
    setActiveWorkspace("all");
  };

  const handleCategoryChat = (id: string) => {
    if (activeWorkspace === id) {
      setActiveWorkspace(null);
    } else {
      setSidebarFilter(id as SidebarFilter);
      setActiveWorkspace(id);
    }
  };

  const handleFilterClick = (id: SidebarFilter) => {
    setSidebarFilter(id);
    setActiveWorkspace(null);
  };

  return (
    <aside className="glass-panel flex h-full min-h-0 w-[var(--sidebar-width)] flex-col gap-5 p-4">
      <div data-tauri-drag-region>
        <p className="section-kicker" data-tauri-drag-region>Agentic</p>
        <h1 className="mt-1.5 text-[24px] font-bold tracking-[-0.03em] text-[var(--text-primary)]" data-tauri-drag-region>Docs Handler</h1>
        <div className="mt-4 control-card flex items-center justify-between px-3 py-2">
          <p className="text-xs font-medium text-[var(--text-secondary)]">AI-motor</p>
          <span className="glass-badge border-[rgba(47,111,237,0.2)] bg-[rgba(47,111,237,0.09)] text-[var(--accent-primary)]">
            <span className="status-dot bg-[var(--accent-primary)]" />
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Home + category chat */}
      <nav className="flex flex-col gap-1.5">
        <button
          type="button"
          className={`sidebar-chat-btn hover-lift ${isHome ? "is-active" : ""}`}
          aria-label="Hem — chatta med alla filer"
          onClick={handleHomeClick}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <path d="M2.5 7L8 2.5L13.5 7V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V7Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M6 14V9h4v5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          <span className="flex-1 truncate font-medium">Hem</span>
        </button>
        {visibleChatItems.map((item) => {
          const chatActive = activeWorkspace === item.id;
          const color = kindColor(item.id as UiDocumentKind);
          return (
            <button
              key={item.id}
              type="button"
              className={`sidebar-chat-btn hover-lift ${chatActive ? "is-active" : ""}`}
              aria-label={`Chatta med ${item.label}`}
              onClick={() => handleCategoryChat(item.id)}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: color }}
              />
              <ChatIcon />
              <span className="flex-1 truncate font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Document browsing — by file type */}
      <nav className="flex flex-col gap-1.5">
        <p className="section-kicker mb-1">Dokument</p>
        <button
          type="button"
          className={`sidebar-pill hover-lift flex items-center justify-between text-left ${sidebarFilter === "recent" ? "is-active" : ""}`}
          onClick={() => handleFilterClick("recent")}
        >
          <span className="font-medium">Senaste</span>
          <KineticNumber value={counts.all || 0} />
        </button>
        {visibleModalityItems.map((item) => {
          const active = sidebarFilter === item.id && !isHome;
          return (
            <button
              key={item.id}
              type="button"
              className={`sidebar-pill hover-lift flex items-center justify-between text-left ${active ? "is-active" : ""}`}
              onClick={() => handleFilterClick(item.id as SidebarFilter)}
            >
              <span className="font-medium">{item.label}</span>
              <KineticNumber value={modalityCounts[item.modality] || 0} />
            </button>
          );
        })}
        {needsAttentionCount > 0 && (
          <button
            type="button"
            className={`sidebar-pill hover-lift flex items-center justify-between text-left ${sidebarFilter === "needs_attention" ? "is-active" : ""}`}
            onClick={() => handleFilterClick("needs_attention")}
          >
            <span className="flex items-center gap-2 font-medium">
              <span className="status-dot bg-[var(--invoice-color)]" style={{ animation: "stepper-pulse 2s ease-in-out infinite" }} />
              Behöver åtgärd
            </span>
            <KineticNumber value={needsAttentionCount} />
          </button>
        )}
      </nav>
    </aside>
  );
}
