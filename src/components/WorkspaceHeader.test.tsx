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

describe("WorkspaceHeader", () => {
  it("renders workspace name and file count", () => {
    render(<WorkspaceHeader workspace={baseWorkspace} onToggleChat={() => {}} />);
    expect(screen.getByText("Bostadsrätten")).toBeInTheDocument();
    expect(screen.getByText(/12 filer/)).toBeInTheDocument();
  });

  it("shows AI brief placeholder when no brief exists", () => {
    render(<WorkspaceHeader workspace={baseWorkspace} onToggleChat={() => {}} />);
    expect(screen.getByText(/AI brief/i)).toBeInTheDocument();
  });

  it("shows AI brief text when it exists", () => {
    const wsWithBrief = { ...baseWorkspace, ai_brief: "Dokument om lägenhetsköpet." };
    render(<WorkspaceHeader workspace={wsWithBrief} onToggleChat={() => {}} />);
    expect(screen.getByText("Dokument om lägenhetsköpet.")).toBeInTheDocument();
  });

  it("calls onToggleChat when chat button is clicked", () => {
    const onToggle = vi.fn();
    render(<WorkspaceHeader workspace={baseWorkspace} onToggleChat={onToggle} />);
    screen.getByRole("button", { name: /chat/i }).click();
    expect(onToggle).toHaveBeenCalled();
  });
});
