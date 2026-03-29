import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  streamWorkspaceChat: vi.fn(),
}));

import { streamWorkspaceChat } from "../lib/api";
import { useSearchAiSummary } from "./useSearchAiSummary";
import { useWorkspaceStore } from "../store/workspaceStore";

function streamEvents(events: Array<{ type: string; data: Record<string, unknown> }>) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

describe("useSearchAiSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: "ws-1",
      loading: false,
      error: null,
      chatPanelOpen: false,
    });
    vi.mocked(streamWorkspaceChat).mockReturnValue(
      streamEvents([
        { type: "token", data: { text: "Kort" } },
        { type: "done", data: {} },
      ]) as ReturnType<typeof streamWorkspaceChat>,
    );
  });

  it("uses the active workspace id when requesting an AI summary", async () => {
    const { result } = renderHook(() => useSearchAiSummary());

    await act(async () => {
      await result.current.askAi("Vad handlar detta om?");
    });

    expect(streamWorkspaceChat).toHaveBeenCalledWith(
      undefined,
      "Vad handlar detta om?",
      [],
      expect.objectContaining({ workspace_id: "ws-1" }),
    );
  });
});
