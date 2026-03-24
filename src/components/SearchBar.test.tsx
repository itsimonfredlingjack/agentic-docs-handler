import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseSearch = vi.fn();
const mockUseSearchAiSummary = vi.fn();
const mockCreateSearchShareBrief = vi.fn();
const mockTrackEngagementEvent = vi.fn();
const clipboardWriteText = vi.fn();

vi.mock("../hooks/useSearch", () => ({
  useSearch: () => mockUseSearch(),
}));

vi.mock("../hooks/useSearchAiSummary", () => ({
  useSearchAiSummary: () => mockUseSearchAiSummary(),
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    createSearchShareBrief: (...args: Parameters<typeof mockCreateSearchShareBrief>) => mockCreateSearchShareBrief(...args),
    trackEngagementEvent: (...args: Parameters<typeof mockTrackEngagementEvent>) => mockTrackEngagementEvent(...args),
  };
});

import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
    mockUseSearch.mockReturnValue({
      query: "",
      setQuery: vi.fn(),
      searchState: {
        query: "",
        rewrittenQuery: "",
        answer: "",
        status: "idle",
        error: null,
        resultIds: [],
        orphanResults: [],
        snippetsByDocId: {},
      },
      clearSearch: vi.fn(),
    });
    mockUseSearchAiSummary.mockReturnValue({
      summary: {
        status: "idle",
        text: "",
        errorMessage: null,
      },
      askAi: vi.fn(),
      resetAiSummary: vi.fn(),
    });
    mockCreateSearchShareBrief.mockResolvedValue({
      brief_text: "AI-Docs brief\nQuestion: invoice amount",
      source_count: 1,
      event: {
        id: "evt-created",
        name: "share_brief_created",
        surface: "search",
        timestamp: "2026-03-24T10:00:00Z",
        metadata: { source_count: 1 },
      },
    });
    mockTrackEngagementEvent.mockResolvedValue({
      success: true,
      event: {
        id: "evt-copied",
        name: "share_brief_copied",
        surface: "search",
        timestamp: "2026-03-24T10:00:01Z",
        metadata: { source_count: 1 },
      },
    });
  });

  it("focuses the input on cmd+k", async () => {
    const user = userEvent.setup();
    render(<SearchBar activeFilterLabel="Alla" onOpenFilters={() => undefined} />);

    await user.keyboard("{Meta>}k{/Meta}");

    expect(screen.getByPlaceholderText("Sök i dokument...")).toHaveFocus();
  });

  it("shows an error state and clear action", () => {
    const clearSearch = vi.fn();
    mockUseSearch.mockReturnValue({
      query: "contracts",
      setQuery: vi.fn(),
      searchState: {
        query: "contracts",
        rewrittenQuery: "",
        answer: "",
        status: "error",
        error: "search_unavailable",
        resultIds: [],
        orphanResults: [],
        snippetsByDocId: {},
      },
      clearSearch,
    });

    render(<SearchBar activeFilterLabel="Alla" onOpenFilters={() => undefined} />);

    expect(screen.getByText(/Söktjänsten är tillfälligt otillgänglig/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rensa" })).toBeInTheDocument();
  });

  it("shows result count when ready with results", () => {
    mockUseSearch.mockReturnValue({
      query: "kvitto",
      setQuery: vi.fn(),
      searchState: {
        query: "kvitto",
        rewrittenQuery: "kvitto",
        answer: "",
        status: "ready",
        error: null,
        resultIds: ["doc-1", "doc-2", "doc-3"],
        orphanResults: [],
        snippetsByDocId: {},
      },
      clearSearch: vi.fn(),
    });

    render(<SearchBar activeFilterLabel="Alla" onOpenFilters={() => undefined} />);

    expect(screen.getByText("3 träffar")).toBeInTheDocument();
    expect(screen.getByText("Sökresultat")).toBeInTheDocument();
  });

  it("shows empty state when no matches", () => {
    mockUseSearch.mockReturnValue({
      query: "nonsense",
      setQuery: vi.fn(),
      searchState: {
        query: "nonsense",
        rewrittenQuery: "nonsense",
        answer: "",
        status: "empty",
        error: null,
        resultIds: [],
        orphanResults: [],
        snippetsByDocId: {},
      },
      clearSearch: vi.fn(),
    });

    render(<SearchBar activeFilterLabel="Alla" onOpenFilters={() => undefined} />);

    expect(screen.getByText("Inga träffar")).toBeInTheDocument();
  });

  it("clears search on Escape", async () => {
    const user = userEvent.setup();
    const clearSearch = vi.fn();
    mockUseSearch.mockReturnValue({
      query: "hyresavtal",
      setQuery: vi.fn(),
      searchState: {
        query: "hyresavtal",
        rewrittenQuery: "",
        answer: "",
        status: "ready",
        error: null,
        resultIds: [],
        orphanResults: [],
        snippetsByDocId: {},
      },
      clearSearch,
    });

    render(<SearchBar activeFilterLabel="Alla" onOpenFilters={() => undefined} />);

    await user.keyboard("{Escape}");

    expect(clearSearch).toHaveBeenCalledTimes(1);
  });

  it("copies a shareable AI brief and shows success state", async () => {
    const user = userEvent.setup();
    mockUseSearch.mockReturnValue({
      query: "invoice amount",
      setQuery: vi.fn(),
      searchState: {
        query: "invoice amount",
        rewrittenQuery: "invoice amount rewritten",
        answer: "",
        status: "ready",
        error: null,
        resultIds: ["doc-1"],
        orphanResults: [],
        snippetsByDocId: {},
      },
      clearSearch: vi.fn(),
    });
    mockUseSearchAiSummary.mockReturnValue({
      summary: {
        status: "done",
        text: "Marsfakturan är på 900 SEK.",
        errorMessage: null,
      },
      askAi: vi.fn(),
      resetAiSummary: vi.fn(),
    });

    render(<SearchBar activeFilterLabel="Alla" onOpenFilters={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "Kopiera brief" }));

    await waitFor(() => {
      expect(mockCreateSearchShareBrief).toHaveBeenCalledWith({
        query: "invoice amount",
        rewrittenQuery: "invoice amount rewritten",
        answer: "Marsfakturan är på 900 SEK.",
        sources: [],
      });
      expect(mockTrackEngagementEvent).toHaveBeenCalledWith({
        name: "share_brief_copied",
        surface: "search",
        metadata: { query: "invoice amount", source_count: 1 },
      });
    });
    expect(screen.getByText("Kopierad")).toBeInTheDocument();
  });
});
