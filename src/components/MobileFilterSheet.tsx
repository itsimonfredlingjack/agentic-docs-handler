import { useEffect } from "react";

import { useDocumentStore } from "../store/documentStore";
import { SIDEBAR_FILTER_ITEMS } from "./sidebarFilters";

type MobileFilterSheetProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileFilterSheet({ open, onClose }: MobileFilterSheetProps) {
  const sidebarFilter = useDocumentStore((state) => state.sidebarFilter);
  const setSidebarFilter = useDocumentStore((state) => state.setSidebarFilter);
  const counts = useDocumentStore((state) => state.counts);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  return (
    <>
      <div
        className={`mobile-sheet-backdrop lg:hidden ${open ? "is-open" : ""}`}
        aria-hidden={!open}
        onClick={onClose}
      />
      <section
        className={`mobile-sheet lg:hidden ${open ? "is-open" : ""}`}
        role="dialog"
        aria-label="Filtrera dokument"
        aria-hidden={!open}
      >
        <div className="mx-auto w-full max-w-lg px-4 pb-6 pt-3">
          <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-black/10" />
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="section-heading">Filtrera dokument</h2>
            <button
              type="button"
              className="focus-ring action-secondary px-3 py-1.5 text-xs"
              onClick={onClose}
            >
              Stäng
            </button>
          </div>
          <div className="space-y-2">
            {SIDEBAR_FILTER_ITEMS.map((item) => {
              const active = item.id === sidebarFilter;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-pill flex items-center justify-between text-left ${active ? "is-active" : ""}`}
                  aria-label={`Välj filter ${item.label}`}
                  onClick={() => {
                    setSidebarFilter(item.id);
                    onClose();
                  }}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">{counts[item.countKey]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
