import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  searchDocuments: vi.fn(),
}));

import { searchDocuments } from "../lib/api";
import { useSearch } from "./useSearch";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useDocumentStore } from "../store/documentStore";

describe("useSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: "ws-1",
      loading: false,
      error: null,
      chatPanelOpen: false,
    });
    useDocumentStore.setState({
      search: {
        query: "",
        rewrittenQuery: "",
        answer: "",
        status: "idle",
        error: null,
        resultIds: [],
        orphanResults: [],
        snippetsByDocId: {},
      },
    });
    vi.mocked(searchDocuments).mockResolvedValue({
      query: "invoice",
      rewritten_query: "invoice",
      answer: "",
      results: [],
    });
  });

  it("passes the active workspace id to the search API", async () => {
    const { result } = renderHook(() => useSearch());

    act(() => {
      result.current.setQuery("invoice");
    });

    await waitFor(() => {
      expect(searchDocuments).toHaveBeenCalledWith("invoice", 8, "fast", "ws-1");
    });
  });
});
