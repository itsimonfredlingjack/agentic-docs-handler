import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorBanner } from "./ErrorBanner";

describe("ErrorBanner", () => {
  it("renders message", () => {
    render(<ErrorBanner message="Nätverksfel" />);
    expect(screen.getByText("Nätverksfel")).toBeInTheDocument();
  });

  it("calls retry when button is clicked", async () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="Fel" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Försök igen" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
