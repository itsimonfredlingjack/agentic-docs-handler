import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useWorkspaceChat", () => ({
  useWorkspaceChat: () => ({
    conversation: undefined,
    isStreaming: false,
    sendMessage: vi.fn(),
    chatDocument: null,
  }),
}));

import { WorkspaceNotebook } from "./WorkspaceNotebook";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";

describe("WorkspaceNotebook", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      activeWorkspace: null,
      activeDocumentChat: null,
    });
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "ws-1",
          name: "Bostadsrätten",
          description: "",
          ai_brief: "",
          ai_entities: [],
          ai_topics: [],
          cover_color: "#aabbcc",
          is_inbox: false,
          file_count: 1,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      activeWorkspaceId: "ws-1",
      loading: false,
      error: null,
      chatPanelOpen: true,
    });
  });

  it("renders the notebook input and empty state", () => {
    render(<WorkspaceNotebook />);

    expect(screen.getByPlaceholderText("Fråga Bostadsrätten...")).toBeInTheDocument();
    expect(screen.getByText("Fråga Bostadsrätten vad som helst")).toBeInTheDocument();
    expect(screen.getByText("Workspace-läge")).toBeInTheDocument();
  });

  it("closes panel when close button is clicked", async () => {
    render(<WorkspaceNotebook />);

    await userEvent.click(screen.getByLabelText("Stäng chatt"));

    expect(useWorkspaceStore.getState().chatPanelOpen).toBe(false);
  });
});
