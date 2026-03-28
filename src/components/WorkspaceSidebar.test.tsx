import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api", () => ({
  fetchWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { useWorkspaceStore } from "../store/workspaceStore";
import type { WorkspaceResponse } from "../types/workspace";

const makeWorkspace = (overrides: Partial<WorkspaceResponse> = {}): WorkspaceResponse => ({
  id: "ws-1",
  name: "Inbox",
  description: "",
  ai_brief: "",
  ai_entities: [],
  ai_topics: [],
  cover_color: "#5856d6",
  is_inbox: false,
  file_count: 0,
  created_at: "",
  updated_at: "",
  ...overrides,
});

const inboxWs = makeWorkspace({ id: "inbox-1", name: "Inbox", is_inbox: true, file_count: 5, cover_color: "" });
const regularWs = makeWorkspace({ id: "ws-2", name: "Contracts", is_inbox: false, file_count: 3, cover_color: "#5856d6" });

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [inboxWs, regularWs],
    activeWorkspaceId: "inbox-1",
    loading: false,
    error: null,
    chatPanelOpen: false,
  });
});

describe("WorkspaceSidebar", () => {
  it("renders inbox first and workspaces after", () => {
    render(<WorkspaceSidebar />);

    const buttons = screen.getAllByRole("button", { name: /Inbox|Contracts/ });
    expect(buttons[0]).toHaveTextContent("Inbox");
    expect(buttons[1]).toHaveTextContent("Contracts");
  });

  it("highlights the active workspace with data-active attribute", () => {
    render(<WorkspaceSidebar />);

    const inboxBtn = screen.getByRole("button", { name: /Inbox/ });
    const contractsBtn = screen.getByRole("button", { name: /Contracts/ });

    expect(inboxBtn).toHaveAttribute("data-active", "true");
    expect(contractsBtn).not.toHaveAttribute("data-active");
  });

  it("calls setActiveWorkspace with the workspace id when clicked", async () => {
    const setActiveWorkspace = vi.fn();
    useWorkspaceStore.setState({ setActiveWorkspace } as never);

    render(<WorkspaceSidebar />);

    await userEvent.click(screen.getByRole("button", { name: /Contracts/ }));

    expect(setActiveWorkspace).toHaveBeenCalledWith("ws-2");
  });

  it("shows the create workspace button", () => {
    render(<WorkspaceSidebar />);

    expect(screen.getByRole("button", { name: /Ny workspace/ })).toBeInTheDocument();
  });
});
