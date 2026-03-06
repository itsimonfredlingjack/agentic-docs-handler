import { useMemo } from "react";

import { mapSearchResultToGenericDocument } from "../lib/document-mappers";
import { useDocumentStore } from "../store/documentStore";
import type { SidebarFilter, UiDocument } from "../types/documents";

function matchesFilter(document: UiDocument, filter: SidebarFilter): boolean {
  if (filter === "all") return true;
  if (filter === "processing") {
    return document.status !== "ready" && document.status !== "completed";
  }
  if (filter === "moved") return document.moveStatus === "moved";
  return document.kind === filter;
}

export function useFilteredDocuments() {
  const documents = useDocumentStore((state) => state.documents);
  const documentOrder = useDocumentStore((state) => state.documentOrder);
  const sidebarFilter = useDocumentStore((state) => state.sidebarFilter);
  const search = useDocumentStore((state) => state.search);

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

  return { filteredDocuments, filteredIds };
}
