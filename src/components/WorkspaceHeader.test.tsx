import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText(/12 ITEMS/)).toBeInTheDocument();
  });

  it("shows AI brief text when it exists", () => {
    const wsWithBrief = { ...baseWorkspace, ai_brief: "Dokument om lägenhetsköpet." };
    render(<WorkspaceHeader workspace={wsWithBrief} />);
    expect(screen.getByText("Dokument om lägenhetsköpet.")).toBeInTheDocument();
  });

  it("renders Import button and notebook toggle", () => {
    render(<WorkspaceHeader workspace={baseWorkspace} />);
    expect(screen.getByText("Import")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle notebook")).toBeInTheDocument();
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
});
