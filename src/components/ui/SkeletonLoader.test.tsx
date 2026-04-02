import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkeletonLoader } from "./SkeletonLoader";

describe("SkeletonLoader", () => {
  it("renders one loader by default", () => {
    render(<SkeletonLoader />);
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  });

  it("renders requested count", () => {
    render(<SkeletonLoader count={3} />);
    expect(screen.getAllByRole("progressbar")).toHaveLength(3);
  });
});
