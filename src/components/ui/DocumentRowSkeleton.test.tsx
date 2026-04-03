import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentRowSkeleton } from "./DocumentRowSkeleton";

describe("DocumentRowSkeleton", () => {
  it("renders the specified number of skeleton rows", () => {
    render(<DocumentRowSkeleton count={5} />);
    const rows = screen.getAllByRole("progressbar");
    expect(rows).toHaveLength(5);
  });

  it("defaults to 5 rows", () => {
    render(<DocumentRowSkeleton />);
    const rows = screen.getAllByRole("progressbar");
    expect(rows).toHaveLength(5);
  });

  it("has accessible label", () => {
    render(<DocumentRowSkeleton />);
    expect(screen.getByLabelText("Laddar dokument")).toBeInTheDocument();
  });
});
