import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { useWorkspaceStore } from "../store/workspaceStore";
import type { WorkspaceResponse } from "../types/workspace";

vi.mock("../lib/api", () => ({
  fetchWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

const makeWorkspace = (overrides: Partial<WorkspaceResponse> = {}): WorkspaceResponse => ({
  id: "ws-1",
  name: "Inbox",
  description: "",
  ai_brief: "",
  ai_entities: [],
  ai_topics: [],
  cover_color: "#aabbcc",
  is_inbox: true,
  file_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    loading: false,
    error: null,
    chatPanelOpen: false,
  });
});

describe("CommandPalette", () => {
  it("renders workspaces when open", () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "ws-1", name: "Bostadsrätten", file_count: 12 }),
        makeWorkspace({ id: "ws-2", name: "Kontrakt", is_inbox: false, file_count: 3 }),
      ],
    });

    render(<CommandPalette open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByText("Bostadsrätten")).toBeInTheDocument();
    expect(screen.getByText("Kontrakt")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "ws-1", name: "Bostadsrätten" })],
    });

    const { container } = render(<CommandPalette open={false} onOpenChange={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows create workspace action", () => {
    render(<CommandPalette open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByText("Skapa workspace")).toBeInTheDocument();
  });
});
