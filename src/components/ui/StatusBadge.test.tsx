import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders label", () => {
    render(<StatusBadge status="success">Klar</StatusBadge>);
    expect(screen.getByText("Klar")).toBeInTheDocument();
  });

  it("renders icon when requested", () => {
    render(
      <StatusBadge status="error" showIcon>
        Fel
      </StatusBadge>,
    );
    expect(screen.getByText("✕")).toBeInTheDocument();
  });
});
