import { useDocumentStore } from "../store/documentStore";
import type { SidebarFilter } from "../types/documents";

const items: Array<{ id: SidebarFilter; label: string; countKey: keyof ReturnType<typeof useDocumentStore.getState>["counts"] }> = [
  { id: "all", label: "All", countKey: "all" },
  { id: "processing", label: "Processing", countKey: "processing" },
  { id: "receipt", label: "Receipts", countKey: "receipt" },
  { id: "contract", label: "Contracts", countKey: "contract" },
  { id: "invoice", label: "Invoices", countKey: "invoice" },
  { id: "meeting_notes", label: "Meetings", countKey: "meeting_notes" },
  { id: "audio", label: "Audio", countKey: "audio" },
  { id: "generic", label: "Generic", countKey: "generic" },
  { id: "moved", label: "Moved", countKey: "moved" },
];

export function Sidebar() {
  const counts = useDocumentStore((state) => state.counts);
  const sidebarFilter = useDocumentStore((state) => state.sidebarFilter);
  const setSidebarFilter = useDocumentStore((state) => state.setSidebarFilter);

  return (
    <aside className="glass-panel flex h-full min-h-0 w-[230px] flex-col gap-6 p-4 md:w-[230px]">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Agentic</p>
        <h1 className="mt-2 text-[22px] font-bold tracking-[-0.03em] text-[var(--text-primary)]">Docs Handler</h1>
      </div>

      <nav className="flex flex-1 flex-col gap-2">
        {items.map((item) => {
          const active = sidebarFilter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`sidebar-pill flex items-center justify-between text-left ${active ? "is-active" : ""}`}
              onClick={() => setSidebarFilter(item.id)}
            >
              <span>{item.label}</span>
              <span className="font-mono text-[11px] text-[var(--text-secondary)]">{counts[item.countKey]}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
