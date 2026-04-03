import { startTransition, useDeferredValue, useEffect, useState } from "react";

import { searchDocuments } from "../lib/api";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";

export function useSearch() {
  const searchState = useDocumentStore((state) => state.search);
  const setSearchLoading = useDocumentStore((state) => state.setSearchLoading);
  const setSearchError = useDocumentStore((state) => state.setSearchError);
  const applySearchResponse = useDocumentStore((state) => state.applySearchResponse);
  const clearSearch = useDocumentStore((state) => state.clearSearch);
  const searchFilters = useDocumentStore((state) => state.searchFilters);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
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
        const response = await searchDocuments(deferredQuery, 8, "fast", activeWorkspaceId, searchFilters);
        startTransition(() => {
          applySearchResponse(response);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "search_unavailable";
        setSearchError(deferredQuery, message);
      }
    }, 100);

    return () => {
      window.clearTimeout(handle);
    };
  }, [activeWorkspaceId, applySearchResponse, clearSearch, deferredQuery, searchFilters, setSearchError, setSearchLoading]);

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
