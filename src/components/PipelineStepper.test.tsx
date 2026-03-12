import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineStepper } from "./PipelineStepper";

describe("PipelineStepper", () => {
  const STAGES = ["uploading", "classifying", "extracting", "organizing", "indexing", "completed"];

  it("renders all stage labels", () => {
    render(<PipelineStepper currentStage="uploading" history={[]} />);
    expect(screen.getByText("Ladda upp")).toBeInTheDocument();
    expect(screen.getByText("Klassificera")).toBeInTheDocument();
    expect(screen.getByText("Extrahera")).toBeInTheDocument();
    expect(screen.getByText("Organisera")).toBeInTheDocument();
    expect(screen.getByText("Indexera")).toBeInTheDocument();
  });

  it("marks completed stages with checkmark", () => {
    render(
      <PipelineStepper
        currentStage="extracting"
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "classifying", at: 2000 },
          { stage: "extracting", at: 3000 },
        ]}
      />,
    );
    const steps = screen.getAllByTestId("pipeline-step");
    expect(steps[0]).toHaveAttribute("data-state", "completed");
    expect(steps[1]).toHaveAttribute("data-state", "completed");
    expect(steps[2]).toHaveAttribute("data-state", "active");
    expect(steps[3]).toHaveAttribute("data-state", "pending");
  });

  it("shows failed state on the active stage", () => {
    render(
      <PipelineStepper
        currentStage="classifying"
        failed={true}
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "classifying", at: 2000 },
        ]}
      />,
    );
    const steps = screen.getAllByTestId("pipeline-step");
    expect(steps[1]).toHaveAttribute("data-state", "failed");
  });

  it("shows total duration when completed", () => {
    render(
      <PipelineStepper
        currentStage="completed"
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "completed", at: 13500 },
        ]}
      />,
    );
    expect(screen.getByText("12.5s")).toBeInTheDocument();
  });

  it("shows nothing when document has no active pipeline", () => {
    const { container } = render(
      <PipelineStepper currentStage="ready" history={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
