import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "./workspaceStore";
import type { WorkspaceResponse } from "../types/workspace";

// Mock the API module — functions will be added in the parallel task.
vi.mock("../lib/api", () => ({
  fetchWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

import * as api from "../lib/api";

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

const inboxWorkspace = makeWorkspace({ id: "inbox-1", name: "Inbox", is_inbox: true });
const regularWorkspace = makeWorkspace({ id: "ws-2", name: "Contracts", is_inbox: false });

beforeEach(() => {
  vi.resetAllMocks();
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    loading: false,
    error: null,
    chatPanelOpen: false,
  });
});

describe("fetchWorkspaces", () => {
  it("populates the workspace list and defaults to inbox as active", async () => {
    vi.mocked(api.fetchWorkspaces).mockResolvedValue({
      workspaces: [inboxWorkspace, regularWorkspace],
    });

    await useWorkspaceStore.getState().fetchWorkspaces();

    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(2);
    expect(state.workspaces[0].id).toBe("inbox-1");
    expect(state.activeWorkspaceId).toBe("inbox-1");
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("preserves existing activeWorkspaceId when already set", async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-2" });
    vi.mocked(api.fetchWorkspaces).mockResolvedValue({
      workspaces: [inboxWorkspace, regularWorkspace],
    });

    await useWorkspaceStore.getState().fetchWorkspaces();

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
  });

  it("sets error state on API failure", async () => {
    vi.mocked(api.fetchWorkspaces).mockRejectedValue(new Error("network error"));

    await useWorkspaceStore.getState().fetchWorkspaces();

    const state = useWorkspaceStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBe("network error");
  });
});

describe("setActiveWorkspace", () => {
  it("updates activeWorkspaceId", () => {
    useWorkspaceStore.getState().setActiveWorkspace("ws-2");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
  });

  it("closes the chat panel when switching workspace", () => {
    useWorkspaceStore.setState({ chatPanelOpen: true });
    useWorkspaceStore.getState().setActiveWorkspace("ws-2");
    expect(useWorkspaceStore.getState().chatPanelOpen).toBe(false);
  });
});

describe("toggleChatPanel", () => {
  it("flips chatPanelOpen from false to true", () => {
    useWorkspaceStore.getState().toggleChatPanel();
    expect(useWorkspaceStore.getState().chatPanelOpen).toBe(true);
  });

  it("flips chatPanelOpen from true to false", () => {
    useWorkspaceStore.setState({ chatPanelOpen: true });
    useWorkspaceStore.getState().toggleChatPanel();
    expect(useWorkspaceStore.getState().chatPanelOpen).toBe(false);
  });
});

describe("setChatPanelOpen", () => {
  it("sets chatPanelOpen directly", () => {
    useWorkspaceStore.getState().setChatPanelOpen(true);
    expect(useWorkspaceStore.getState().chatPanelOpen).toBe(true);

    useWorkspaceStore.getState().setChatPanelOpen(false);
    expect(useWorkspaceStore.getState().chatPanelOpen).toBe(false);
  });
});

describe("createWorkspace", () => {
  it("adds to list and sets new workspace as active", async () => {
    const newWorkspace = makeWorkspace({ id: "ws-new", name: "Legal", is_inbox: false });
    vi.mocked(api.createWorkspace).mockResolvedValue(newWorkspace);
    vi.mocked(api.fetchWorkspaces).mockResolvedValue({
      workspaces: [inboxWorkspace, regularWorkspace, newWorkspace],
    });
    // Seed an existing active workspace so fetch doesn't override it with inbox
    useWorkspaceStore.setState({ activeWorkspaceId: "inbox-1" });

    const created = await useWorkspaceStore.getState().createWorkspace("Legal");

    const state = useWorkspaceStore.getState();
    expect(created.id).toBe("ws-new");
    // fetchWorkspaces is called internally; activeWorkspaceId then overridden to created id
    expect(state.activeWorkspaceId).toBe("ws-new");
    expect(state.workspaces).toHaveLength(3);
  });
});
