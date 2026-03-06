import { useCallback, useEffect, useMemo } from "react";

import { mapSearchResultToGenericDocument } from "../lib/document-mappers";
import { useDocumentStore } from "../store/documentStore";
import type { SidebarFilter, UiDocument } from "../types/documents";

import { DocumentListRow } from "./DocumentListRow";
import { ListFilterBar } from "./ListFilterBar";

function matchesFilter(document: UiDocument, filter: SidebarFilter): boolean {
  if (filter === "all") return true;
  if (filter === "processing") {
    return document.status !== "ready" && document.status !== "completed";
  }
  if (filter === "moved") return document.moveStatus === "moved";
  return document.kind === filter;
}

export function DocumentList() {
  const documents = useDocumentStore((state) => state.documents);
  const documentOrder = useDocumentStore((state) => state.documentOrder);
  const sidebarFilter = useDocumentStore((state) => state.sidebarFilter);
  const search = useDocumentStore((state) => state.search);
  const selectedDocumentId = useDocumentStore((state) => state.selectedDocumentId);
  const setSelectedDocument = useDocumentStore((state) => state.setSelectedDocument);

  const filteredDocuments = useMemo(() => {
    const documentList = documentOrder.map((id) => documents[id]).filter(Boolean);
    return search.active
      ? [
          ...search.resultIds.map((id) => documents[id]).filter(Boolean),
          ...search.orphanResults.map((result) => mapSearchResultToGenericDocument(result)),
        ]
      : documentList.filter((document) => matchesFilter(document, sidebarFilter));
  }, [documents, documentOrder, sidebarFilter, search]);

  const filteredIds = useMemo(
    () => filteredDocuments.map((d) => d.id),
    [filteredDocuments],
  );

  const firstId = filteredIds[0] ?? null;
  const selectionInList = selectedDocumentId != null && filteredIds.includes(selectedDocumentId);

  // Auto-select first document, or re-select when current is filtered out
  useEffect(() => {
    if (!selectionInList && firstId) {
      setSelectedDocument(firstId);
    }
  }, [selectionInList, firstId, setSelectedDocument]);

  // Keyboard navigation: arrow up/down
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    },
    [selectedDocumentId, filteredIds, setSelectedDocument],
  );

  return (
    <aside className="doc-list-pane" onKeyDown={onKeyDown}>
      <ListFilterBar />
      <div className="flex-1 overflow-y-auto">
        {filteredDocuments.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">No documents match this filter.</p>
        ) : (
          filteredDocuments.map((document) => (
            <DocumentListRow
              key={document.id}
              document={document}
              selected={document.id === selectedDocumentId}
              onClick={() => setSelectedDocument(document.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
