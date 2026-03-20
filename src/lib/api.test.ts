import { describe, expect, it, vi } from "vitest";

import { streamWorkspaceChat } from "./api";

vi.mock("./tauri-events", () => ({
  getBackendBaseUrl: vi.fn(async () => "http://localhost:9000"),
}));

describe("streamWorkspaceChat", () => {
  it("warns when SSE chunks are malformed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: token\n\n"));
          controller.close();
        },
      }),
    } as Response);

    const events = [] as Awaited<ReturnType<typeof streamWorkspaceChat>> extends AsyncGenerator<infer T> ? T[] : never;
    for await (const event of streamWorkspaceChat("receipt", "question", [])) {
      events.push(event as never);
    }

    expect(events).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    fetchMock.mockRestore();
    warn.mockRestore();
  });
});
