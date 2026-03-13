import { useDocumentStore } from "../store/documentStore";
import { SIDEBAR_FILTER_ITEMS } from "./sidebarFilters";
import { ModeToggle } from "./ModeToggle";
import { useEffect, useMemo, useState } from "react";

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

export function Sidebar() {
  const counts = useDocumentStore((state) => state.counts);
  const documents = useDocumentStore((state) => state.documents);
  const sidebarFilter = useDocumentStore((state) => state.sidebarFilter);
  const setSidebarFilter = useDocumentStore((state) => state.setSidebarFilter);
  const connectionState = useDocumentStore((state) => state.connectionState);
  const viewMode = useDocumentStore((state) => state.viewMode);
  const statusLabel = connectionState === "connected" ? "Ansluten" : "Ansluter";
  const failedCount = useMemo(
    () => Object.values(documents).filter((d) => d.status === "failed").length,
    [documents],
  );

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
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
          Dokument sorteras, indexeras och blir sökbara utan manuell administration.
        </p>
        <ModeToggle />
      </div>

      {viewMode === "activity" && (
        <nav className="flex flex-1 flex-col gap-2">
          {SIDEBAR_FILTER_ITEMS.map((item) => {
            const active = sidebarFilter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`sidebar-pill hover-lift flex items-center justify-between text-left ${active ? "is-active" : ""}`}
                aria-label={`Filtrera: ${item.label}`}
                onClick={() => setSidebarFilter(item.id)}
              >
                <span className="font-medium">{item.label}</span>
                <KineticNumber value={counts[item.countKey] || 0} />
              </button>
            );
          })}
          {failedCount > 0 && (
            <div
              className="mt-1 flex items-center gap-2 rounded-xl border border-[rgba(255,69,58,0.18)] bg-[rgba(255,69,58,0.07)] px-3 py-2.5 text-[var(--invoice-color)] transition-opacity"
              role="status"
              aria-label={`${failedCount} misslyckade dokument`}
            >
              <span className="status-dot bg-[var(--invoice-color)]" style={{ animation: "stepper-pulse 2s ease-in-out infinite" }} />
              <span className="text-xs font-medium">{failedCount} misslyckade</span>
            </div>
          )}
        </nav>
      )}
    </aside>
  );
}
