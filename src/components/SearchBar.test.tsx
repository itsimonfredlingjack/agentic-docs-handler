import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useSearch", () => ({
  useSearch: () => ({
    query: "",
    setQuery: vi.fn(),
    searchState: {
      query: "",
      rewrittenQuery: "",
      answer: "",
      loading: false,
      active: false,
      resultIds: [],
      orphanResults: [],
    },
    clearSearch: vi.fn(),
  }),
}));

import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("focuses the input on cmd+k", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    await user.keyboard("{Meta>}k{/Meta}");

    expect(screen.getByPlaceholderText("Vad letar du efter?")).toHaveFocus();
  });
});
