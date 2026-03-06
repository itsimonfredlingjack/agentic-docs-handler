import { useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useDocumentStore } from "../store/documentStore";
import { useFilteredDocuments } from "../hooks/useFilteredDocuments";

import { DocumentListRow } from "./DocumentListRow";
import { ListFilterBar } from "./ListFilterBar";

const ROW_HEIGHT = 52;

export function DocumentList() {
  const { filteredDocuments, filteredIds } = useFilteredDocuments();
  const selectedDocumentId = useDocumentStore((state) => state.selectedDocumentId);
  const selectedDocumentIds = useDocumentStore((state) => state.selectedDocumentIds);
  const setSelectedDocument = useDocumentStore((state) => state.setSelectedDocument);
  const toggleDocumentSelection = useDocumentStore((state) => state.toggleDocumentSelection);
  const rangeSelectDocuments = useDocumentStore((state) => state.rangeSelectDocuments);
  const clearMultiSelect = useDocumentStore((state) => state.clearMultiSelect);
  const scrollRef = useRef<HTMLDivElement>(null);

  const firstId = filteredIds[0] ?? null;
  const selectionInList = selectedDocumentId != null && filteredIds.includes(selectedDocumentId);

  // Auto-select first document, or re-select when current is filtered out
  useEffect(() => {
    if (!selectionInList && firstId) {
      setSelectedDocument(firstId);
    }
  }, [selectionInList, firstId, setSelectedDocument]);

  const virtualizer = useVirtualizer({
    count: filteredDocuments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const handleRowClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        rangeSelectDocuments(id, filteredIds);
      } else if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        toggleDocumentSelection(id);
      } else {
        setSelectedDocument(id);
      }
    },
    [filteredIds, setSelectedDocument, toggleDocumentSelection, rangeSelectDocuments],
  );

  // Keyboard navigation: arrow up/down
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && selectedDocumentIds.size > 0) {
        e.preventDefault();
        clearMultiSelect();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const currentIndex = selectedDocumentId ? filteredIds.indexOf(selectedDocumentId) : -1;
      let nextIndex: number;
      if (e.key === "ArrowDown") {
        nextIndex = currentIndex < filteredIds.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : filteredIds.length - 1;
      }
      setSelectedDocument(filteredIds[nextIndex]);
      virtualizer.scrollToIndex(nextIndex, { align: "auto" });
    },
    [selectedDocumentId, selectedDocumentIds.size, filteredIds, setSelectedDocument, clearMultiSelect, virtualizer],
  );

  const multiCount = selectedDocumentIds.size;

  return (
    <aside className="doc-list-pane" onKeyDown={onKeyDown}>
      <ListFilterBar />
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {filteredDocuments.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">No documents match this filter.</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const document = filteredDocuments[virtualRow.index];
              return (
                <div
                  key={document.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <DocumentListRow
                    document={document}
                    selected={document.id === selectedDocumentId}
                    multiSelected={selectedDocumentIds.has(document.id)}
                    onClick={(e) => handleRowClick(document.id, e)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating batch action bar */}
      {multiCount > 1 && (
        <div className="batch-action-bar">
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            {multiCount} selected
          </span>
          <button
            type="button"
            className="focus-ring rounded-lg bg-[var(--accent-primary)] px-2.5 py-1 text-[11px] font-semibold text-white transition hover:opacity-90"
            onClick={() => {
              // TODO: wire batch confirm when backend supports it
              clearMultiSelect();
            }}
          >
            Move all
          </button>
          <button
            type="button"
            className="focus-ring rounded-lg border border-[var(--border-subtle)] bg-[var(--btn-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--btn-bg-hover)]"
            onClick={clearMultiSelect}
          >
            Clear
          </button>
        </div>
      )}
    </aside>
  );
}
