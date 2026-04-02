import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(<EmptyState title="Tomt" description="Ingen data" />);
    expect(screen.getByText("Tomt")).toBeInTheDocument();
    expect(screen.getByText("Ingen data")).toBeInTheDocument();
  });
});
