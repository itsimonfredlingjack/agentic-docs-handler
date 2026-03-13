import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseSearch = vi.fn();

vi.mock("../hooks/useSearch", () => ({
  useSearch: () => mockUseSearch(),
}));

import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("focuses the input on cmd+k", async () => {
    const user = userEvent.setup();
    render(<SearchBar activeFilterLabel="Alla" onOpenFilters={() => undefined} />);

    await user.keyboard("{Meta>}k{/Meta}");

    expect(screen.getByPlaceholderText("Fråga dina dokument...")).toHaveFocus();
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
});
