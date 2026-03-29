import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  streamWorkspaceChat: vi.fn(),
}));

import { streamWorkspaceChat } from "../lib/api";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkspaceChat } from "./useWorkspaceChat";

function streamEvents(events: Array<{ type: string; data: Record<string, unknown> }>) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

describe("useWorkspaceChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: "ws-1",
      loading: false,
      error: null,
      chatPanelOpen: true,
    });
    useDocumentStore.setState({
      activeWorkspace: null,
      activeDocumentChat: null,
      conversations: {},
      documents: {},
      documentOrder: [],
    });
    vi.mocked(streamWorkspaceChat).mockReturnValue(
      streamEvents([
        { type: "context", data: { source_count: 2 } },
        { type: "token", data: { text: "Svar" } },
        { type: "done", data: {} },
      ]) as ReturnType<typeof streamWorkspaceChat>,
    );
  });

  it("sends workspace-scoped chat requests with workspace_id", async () => {
    const { result } = renderHook(() => useWorkspaceChat());

    await act(async () => {
      await result.current.sendMessage("Vad finns här?");
    });

    expect(streamWorkspaceChat).toHaveBeenCalledWith(
      undefined,
      "Vad finns här?",
      [],
      expect.objectContaining({ workspace_id: "ws-1" }),
    );
  });
});
