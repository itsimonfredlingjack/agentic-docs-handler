import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toast } from "./Toast";

describe("Toast", () => {
  const base = { id: "t1", message: "Saved", type: "success" as const, duration: 3000 };

  it("renders success toast with checkmark icon", () => {
    render(<Toast toast={base} onDismiss={vi.fn()} />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("renders error toast with cross icon", () => {
    render(<Toast toast={{ ...base, type: "error", message: "Failed" }} onDismiss={vi.fn()} />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("✕")).toBeInTheDocument();
  });

  it("renders info toast with info icon", () => {
    render(<Toast toast={{ ...base, type: "info", message: "Moved" }} onDismiss={vi.fn()} />);
    expect(screen.getByText("Moved")).toBeInTheDocument();
    expect(screen.getByText("ℹ")).toBeInTheDocument();
  });

  it("calls onDismiss when clicked", () => {
    const onDismiss = vi.fn();
    render(<Toast toast={base} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("status"));
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("renders action button when provided", () => {
    const onClick = vi.fn();
    const toast = { ...base, type: "error" as const, action: { label: "Retry", onClick } };
    render(<Toast toast={toast} onDismiss={vi.fn()} />);
    const btn = screen.getByText("Retry");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });
});
