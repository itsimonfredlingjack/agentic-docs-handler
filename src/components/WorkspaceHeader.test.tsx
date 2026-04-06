import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceHeader } from "./WorkspaceHeader";
import type { WorkspaceResponse } from "../types/workspace";

const baseWorkspace: WorkspaceResponse = {
  id: "ws-1",
  name: "Bostadsrätten",
  description: "",
  ai_brief: "",
  ai_entities: [],
  ai_topics: [],
  cover_color: "#5856d6",
  is_inbox: false,
  file_count: 12,
  created_at: "",
  updated_at: "",
};

function makeWorkspace(overrides: Partial<WorkspaceResponse> = {}): WorkspaceResponse {
  return { ...baseWorkspace, ...overrides };
}

describe("WorkspaceHeader", () => {
  it("renders workspace name and file count", () => {
    render(<WorkspaceHeader workspace={baseWorkspace} />);
    expect(screen.getByText("Bostadsrätten")).toBeInTheDocument();
    expect(screen.getByText(/12 OBJEKT/)).toBeInTheDocument();
  });

  it("shows AI brief text when it exists", () => {
    const wsWithBrief = { ...baseWorkspace, ai_brief: "Dokument om lägenhetsköpet." };
    render(<WorkspaceHeader workspace={wsWithBrief} />);
    expect(screen.getByText("Dokument om lägenhetsköpet.")).toBeInTheDocument();
  });

  it("renders Import button", () => {
    render(<WorkspaceHeader workspace={baseWorkspace} />);
    expect(screen.getByText("Importera")).toBeInTheDocument();
  });

  it("renders entity badges when workspace has ai_entities", () => {
    const ws = makeWorkspace({
      ai_entities: [
        { name: "Telia", entity_type: "company" },
        { name: "2026-03-15", entity_type: "date" },
      ],
    });
    render(<WorkspaceHeader workspace={ws} />);
    expect(screen.getByText("Telia")).toBeInTheDocument();
    expect(screen.getByText("2026-03-15")).toBeInTheDocument();
  });

  it("renders topic tags when workspace has ai_topics", () => {
    const ws = makeWorkspace({ ai_topics: ["accounting", "tax"] });
    render(<WorkspaceHeader workspace={ws} />);
    expect(screen.getByText("#accounting")).toBeInTheDocument();
    expect(screen.getByText("#tax")).toBeInTheDocument();
  });

  it("renders no badges when entities and topics are empty", () => {
    const ws = makeWorkspace({ ai_entities: [], ai_topics: [] });
    const { container } = render(<WorkspaceHeader workspace={ws} />);
    expect(container.querySelector(".glass-badge")).not.toBeInTheDocument();
  });

  describe("inbox header", () => {
    it("shows inbox name and triage progress instead of file count badge", () => {
      const inbox = makeWorkspace({ is_inbox: true, name: "Inkorg", file_count: 5 });
      render(<WorkspaceHeader workspace={inbox} />);
      expect(screen.getByText("Inkorg")).toBeInTheDocument();
      // Should show triage progress text, not the count badge
      expect(screen.queryByText(/5 OBJEKT/)).not.toBeInTheDocument();
      expect(screen.getByText(/av.*dirigerade|of.*routed/)).toBeInTheDocument();
    });

    it("does not render brief, entities, or topics for inbox", () => {
      const inbox = makeWorkspace({
        is_inbox: true,
        name: "Inkorg",
        ai_brief: "Some brief text",
        ai_entities: [{ name: "Telia", entity_type: "company" }],
        ai_topics: ["tax"],
      });
      render(<WorkspaceHeader workspace={inbox} />);
      expect(screen.queryByText("Some brief text")).not.toBeInTheDocument();
      expect(screen.queryByText("Telia")).not.toBeInTheDocument();
      expect(screen.queryByText("#tax")).not.toBeInTheDocument();
    });

    it("still renders Import button for inbox", () => {
      const inbox = makeWorkspace({ is_inbox: true, name: "Inkorg" });
      render(<WorkspaceHeader workspace={inbox} />);
      expect(screen.getByText("Importera")).toBeInTheDocument();
    });
  });

  describe("brief expand toggle", () => {
    it("shows expand toggle for long briefs", () => {
      const longBrief = "A".repeat(200);
      const ws = makeWorkspace({ ai_brief: longBrief });
      render(<WorkspaceHeader workspace={ws} />);
      expect(screen.getByText("Visa mer")).toBeInTheDocument();
    });

    it("does not show toggle for short briefs", () => {
      const ws = makeWorkspace({ ai_brief: "Short brief." });
      render(<WorkspaceHeader workspace={ws} />);
      expect(screen.queryByText("Visa mer")).not.toBeInTheDocument();
    });

    it("toggles between Visa mer and Visa mindre", () => {
      const longBrief = "A".repeat(200);
      const ws = makeWorkspace({ ai_brief: longBrief });
      render(<WorkspaceHeader workspace={ws} />);

      const toggle = screen.getByText("Visa mer");
      fireEvent.click(toggle);
      expect(screen.getByText("Visa mindre")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Visa mindre"));
      expect(screen.getByText("Visa mer")).toBeInTheDocument();
    });
  });
});
