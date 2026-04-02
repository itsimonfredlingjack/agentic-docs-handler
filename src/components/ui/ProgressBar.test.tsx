import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders progressbar role", () => {
    render(<ProgressBar value={40} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders label when provided", () => {
    render(<ProgressBar value={40} label="Indexerar" />);
    expect(screen.getByText("Indexerar")).toBeInTheDocument();
  });
});
