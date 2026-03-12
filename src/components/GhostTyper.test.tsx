import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GhostTyper } from "./GhostTyper";

describe("GhostTyper", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("reveals text character by character", () => {
    render(<GhostTyper text="Telia" speed={30} />);
    expect(screen.getByTestId("ghost-typer").textContent).toBe("");

    act(() => { vi.advanceTimersByTime(30); });
    expect(screen.getByTestId("ghost-typer").textContent).toBe("T");

    act(() => { vi.advanceTimersByTime(30 * 4); });
    expect(screen.getByTestId("ghost-typer").textContent).toBe("Telia");
  });

  it("shows cursor while typing and hides after done", () => {
    render(<GhostTyper text="Hi" speed={30} />);
    expect(screen.getByTestId("ghost-cursor")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(30 * 3); });
    expect(screen.queryByTestId("ghost-cursor")).not.toBeInTheDocument();
  });

  it("handles empty text without errors", () => {
    render(<GhostTyper text="" speed={30} />);
    expect(screen.getByTestId("ghost-typer").textContent).toBe("");
  });

  it("calls onDone when typing completes", () => {
    const onDone = vi.fn();
    render(<GhostTyper text="AB" speed={20} onDone={onDone} />);

    act(() => { vi.advanceTimersByTime(20 * 2); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
