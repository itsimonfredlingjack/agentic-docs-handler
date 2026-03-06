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

import { TopBar } from "./TopBar";

describe("TopBar search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("focuses the search input on cmd+k", async () => {
    const user = userEvent.setup();
    render(<TopBar onDropClick={vi.fn()} viewMode="tinder" onToggleView={vi.fn()} onShowShortcuts={vi.fn()} onToggleActivity={vi.fn()} activityOpen={false} />);

    await user.keyboard("{Meta>}k{/Meta}");

    expect(screen.getByPlaceholderText(/Search documents/)).toHaveFocus();
  });
});
