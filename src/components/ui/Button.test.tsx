import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Test</Button>);
    expect(screen.getByRole("button", { name: "Test" })).toBeInTheDocument();
  });

  it("calls onClick when enabled", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    screen.getByRole("button", { name: "Click" }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled when loading", () => {
    render(<Button loading>Loading</Button>);
    expect(screen.getByRole("button", { name: "Loading" })).toBeDisabled();
  });
});
