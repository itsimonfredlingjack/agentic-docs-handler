import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MobileFilterSheet } from "./MobileFilterSheet";
import { useDocumentStore } from "../store/documentStore";

describe("MobileFilterSheet", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      sidebarFilter: "all",
      counts: {
        all: 8,
        processing: 1,
        receipt: 2,
        contract: 1,
        invoice: 2,
        meeting_notes: 1,
        audio: 0,
        generic: 1,
        moved: 0,
      },
    });
  });

  it("updates filter and closes on selection", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MobileFilterSheet open onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Välj filter Kvitton" }));

    expect(useDocumentStore.getState().sidebarFilter).toBe("receipt");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MobileFilterSheet open onClose={onClose} />);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
