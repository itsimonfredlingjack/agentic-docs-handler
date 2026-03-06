import { useDocumentStore } from "../store/documentStore";
import type { SidebarFilter } from "../types/documents";

const filters: Array<{ id: SidebarFilter; label: string; countKey: keyof ReturnType<typeof useDocumentStore.getState>["counts"] }> = [
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

export function ListFilterBar() {
  const counts = useDocumentStore((state) => state.counts);
  const sidebarFilter = useDocumentStore((state) => state.sidebarFilter);
  const setSidebarFilter = useDocumentStore((state) => state.setSidebarFilter);

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2">
      {filters.map((filter) => {
        const active = sidebarFilter === filter.id;
        const count = counts[filter.countKey];
        if (filter.id !== "all" && count === 0) return null;
        return (
          <button
            key={filter.id}
            type="button"
            className={`filter-pill focus-ring ${active ? "is-active" : ""}`}
            aria-pressed={active}
            onClick={() => setSidebarFilter(filter.id)}
          >
            {filter.label}
            {count > 0 && (
              <span className="filter-pill-count">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
