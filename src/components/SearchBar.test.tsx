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
      },
      clearSearch: vi.fn(),
    });
  });

  it("focuses the input on cmd+k", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    await user.keyboard("{Meta>}k{/Meta}");

    expect(screen.getByPlaceholderText("Ask your docs anything...")).toHaveFocus();
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
      },
      clearSearch,
    });

    render(<SearchBar />);

    expect(screen.getByText(/Search is temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear query" })).toBeInTheDocument();
  });
});
