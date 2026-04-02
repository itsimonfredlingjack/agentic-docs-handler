import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("renders content", () => {
    render(<Card>Content</Card>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("applies clickable variant class", () => {
    render(<Card variant="clickable">Click me</Card>);
    expect(screen.getByText("Click me").className).toContain("cursor-pointer");
  });
});
