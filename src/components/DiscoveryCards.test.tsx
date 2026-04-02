import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  fetchWorkspaceDiscovery: vi.fn(),
  dismissWorkspaceDiscovery: vi.fn(),
}));

import { dismissWorkspaceDiscovery, fetchWorkspaceDiscovery } from "../lib/api";
import { useDocumentStore } from "../store/documentStore";
import { DiscoveryCards } from "./DiscoveryCards";

describe("DiscoveryCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({
      documents: {
        "doc-1": {
          id: "doc-1",
          requestId: "req-1",
          title: "Kontrakt.pdf",
          summary: "",
          mimeType: "application/pdf",
          sourceModality: "text",
          kind: "contract",
          documentType: "contract",
          template: "contract",
          sourcePath: "/tmp/kontrakt.pdf",
          createdAt: "2026-03-28T10:00:00Z",
          updatedAt: "2026-03-28T10:00:00Z",
          classification: {
            document_type: "contract",
            template: "contract",
            title: "Kontrakt.pdf",
            summary: "",
            tags: [],
            language: "sv",
            confidence: 0.9,
            ocr_text: null,
            suggested_actions: [],
          },
          extraction: null,
          transcription: null,
          movePlan: null,
          moveResult: null,
          status: "completed",
          tags: [],
          undoToken: null,
          retryable: false,
          errorCode: null,
          warnings: [],
          moveStatus: "not_requested",
          diagnostics: null,
          workspaceId: "ws-1",
        },
      },
      selectedDocumentId: null,
    });
    vi.mocked(fetchWorkspaceDiscovery).mockResolvedValue({
      workspace_id: "ws-1",
      cards: [
        {
          id: "rel-1",
          relation_type: "related",
          confidence: 0.88,
          explanation: "Delar entiteter: Acme AB, Stockholm.",
          created_at: "2026-03-28T10:00:00Z",
          files: [
            { id: "doc-1", title: "Kontrakt.pdf", source_path: "/tmp/kontrakt.pdf" },
            { id: "doc-2", title: "Mötesanteckningar.pdf", source_path: "/tmp/mote.pdf" },
          ],
        },
      ],
    });
    vi.mocked(dismissWorkspaceDiscovery).mockResolvedValue({ success: true });
  });

  it("loads and renders discovery cards for the workspace", async () => {
    render(<DiscoveryCards workspaceId="ws-1" />);

    expect(screen.getByLabelText("Laddar innehåll")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Insikter")).toBeInTheDocument();
    });

    expect(fetchWorkspaceDiscovery).toHaveBeenCalledWith("ws-1");
    expect(screen.getByText("Delar entiteter: Acme AB, Stockholm.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kontrakt.pdf" })).toBeInTheDocument();
    expect(screen.getByText("Relaterad")).toBeInTheDocument();
  });

  it("dismisses a card and removes it from view", async () => {
    render(<DiscoveryCards workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("Insikter")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Dölj insikt" }));

    await waitFor(() => {
      expect(dismissWorkspaceDiscovery).toHaveBeenCalledWith("ws-1", "rel-1");
    });
    expect(screen.queryByText("Delar entiteter: Acme AB, Stockholm.")).not.toBeInTheDocument();
  });

  it("opens a file in the detail panel when clicked", async () => {
    render(<DiscoveryCards workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Kontrakt.pdf" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Kontrakt.pdf" }));

    expect(useDocumentStore.getState().selectedDocumentId).toBe("doc-1");
  });
});
