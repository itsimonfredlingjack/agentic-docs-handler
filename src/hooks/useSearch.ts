import { startTransition, useDeferredValue, useEffect, useState } from "react";

import { searchDocuments } from "../lib/api";
import { useDocumentStore } from "../store/documentStore";

export function useSearch() {
  const searchState = useDocumentStore((state) => state.search);
  const setSearchLoading = useDocumentStore((state) => state.setSearchLoading);
  const applySearchResponse = useDocumentStore((state) => state.applySearchResponse);
  const clearSearch = useDocumentStore((state) => state.clearSearch);
  const [query, setQuery] = useState(searchState.query);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!deferredQuery.trim()) {
      clearSearch();
      return;
    }

    const handle = window.setTimeout(async () => {
      setSearchLoading(deferredQuery);
      try {
        const response = await searchDocuments(deferredQuery);
        startTransition(() => {
          applySearchResponse(response);
        });
      } catch {
        clearSearch();
      }
    }, 300);

    return () => {
      window.clearTimeout(handle);
    };
  }, [applySearchResponse, clearSearch, deferredQuery, setSearchLoading]);

  return {
    query,
    setQuery,
    searchState,
    clearSearch: () => {
      setQuery("");
      clearSearch();
    },
  };
}
