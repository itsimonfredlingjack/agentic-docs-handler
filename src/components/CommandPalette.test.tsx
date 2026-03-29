import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";
import {
  fetchDocument,
  fetchWorkspaceFiles,
  moveFilesToWorkspace,
  searchDocuments,
} from "../lib/api";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useDocumentStore } from "../store/documentStore";
import type { WorkspaceResponse } from "../types/workspace";
import type { UiDocument } from "../types/documents";

vi.mock("../lib/api", () => ({
  fetchWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  searchDocuments: vi.fn(),
  fetchDocument: vi.fn(),
  fetchWorkspaceFiles: vi.fn(),
  moveFilesToWorkspace: vi.fn(),
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
  vi.useFakeTimers();
  vi.clearAllMocks();
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    loading: false,
    error: null,
    chatPanelOpen: false,
  });
  useDocumentStore.setState({
    documents: {},
    documentOrder: [],
    selectedDocumentId: null,
  });
  vi.mocked(searchDocuments).mockResolvedValue({
    query: "hyres",
    rewritten_query: "hyres",
    answer: "",
    results: [],
  });
  vi.mocked(fetchWorkspaceFiles).mockResolvedValue({
    documents: [],
    total: 0,
  });
});

afterEach(async () => {
  try {
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
  } catch {
    // The timer APIs may already be restored in tests that switch to real timers.
  }
  vi.useRealTimers();
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

  it("includes file results from the active workspace", async () => {
    const document: UiDocument = {
      id: "doc-1",
      requestId: "req-1",
      title: "Hyreskontrakt 2026",
      summary: "Kontrakt för lokalen",
      mimeType: "application/pdf",
      sourceModality: "text",
      kind: "contract",
      documentType: "contract",
      template: "contract",
      sourcePath: "/tmp/hyreskontrakt.pdf",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      classification: {
        document_type: "contract",
        template: "contract",
        title: "Hyreskontrakt 2026",
        summary: "Kontrakt för lokalen",
        tags: [],
        language: "sv",
        confidence: 0.9,
        ocr_text: null,
        suggested_actions: [],
      },
      extraction: { fields: {}, field_confidence: {}, missing_fields: [] },
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
    };

    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "ws-1", name: "Bostadsrätten", is_inbox: false })],
      activeWorkspaceId: "ws-1",
    });
    useDocumentStore.setState({
      documents: { "doc-1": document },
      documentOrder: ["doc-1"],
      selectedDocumentId: null,
    });

    render(<CommandPalette open={true} onOpenChange={vi.fn()} />);

    act(() => {
      fireEvent.change(screen.getByPlaceholderText("Sök workspace..."), {
        target: { value: "Hyres" },
      });
    });

    expect(screen.getByText("Hyreskontrakt 2026")).toBeInTheDocument();
  });

  it("queries the backend search index and renders result actions", async () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "ws-1", name: "Bostadsrätten", is_inbox: false })],
      activeWorkspaceId: "ws-1",
    });
    vi.mocked(searchDocuments).mockResolvedValue({
      query: "hyres",
      rewritten_query: "hyres",
      answer: "",
      results: [
        {
          doc_id: "doc-9",
          title: "Hyreskontrakt 2026",
          source_path: "/tmp/hyreskontrakt.pdf",
          snippet: "Kontrakt för lokalen i Vasastan.",
          score: 0.9,
          vector_score: 0.6,
          keyword_score: 0.3,
          metadata: {
            workspace_id: "ws-2",
            workspace_name: "Kontrakt",
          },
        },
      ],
    });

    render(<CommandPalette open={true} onOpenChange={vi.fn()} />);

    act(() => {
      fireEvent.change(screen.getByPlaceholderText("Sök workspace..."), {
        target: { value: "hyres" },
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(searchDocuments).toHaveBeenCalledWith("hyres", 8, "fast", undefined);
    expect(screen.getByText("Öppna fil: Hyreskontrakt 2026")).toBeInTheDocument();
    expect(screen.getByText("Kontrakt för lokalen i Vasastan.")).toBeInTheDocument();
    expect(screen.getByText("Gå till workspace: Kontrakt")).toBeInTheDocument();
  });

  it("opens a backend search result and selects the fetched file", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "ws-1", name: "Inbox" }),
        makeWorkspace({ id: "ws-2", name: "Kontrakt", is_inbox: false }),
      ],
      activeWorkspaceId: "ws-1",
    });
    vi.mocked(searchDocuments).mockResolvedValue({
      query: "hyres",
      rewritten_query: "hyres",
      answer: "",
      results: [
        {
          doc_id: "doc-9",
          title: "Hyreskontrakt 2026",
          source_path: "/tmp/hyreskontrakt.pdf",
          snippet: "Kontrakt för lokalen i Vasastan.",
          score: 0.9,
          vector_score: 0.6,
          keyword_score: 0.3,
          metadata: {
            workspace_id: "ws-2",
            workspace_name: "Kontrakt",
          },
        },
      ],
    });
    vi.mocked(fetchDocument).mockResolvedValue({
      id: "doc-9",
      requestId: "req-9",
      workspaceId: "ws-2",
      title: "Hyreskontrakt 2026",
      summary: "Kontrakt för lokalen",
      mimeType: "application/pdf",
      sourceModality: "text",
      kind: "contract",
      documentType: "contract",
      template: "contract",
      sourcePath: "/tmp/hyreskontrakt.pdf",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      classification: {
        document_type: "contract",
        template: "contract",
        title: "Hyreskontrakt 2026",
        summary: "Kontrakt för lokalen",
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
      tags: [],
      status: "completed",
      undoToken: null,
      retryable: false,
      errorCode: null,
      warnings: [],
      moveStatus: "not_requested",
      diagnostics: null,
      thumbnailData: null,
    });

    render(<CommandPalette open={true} onOpenChange={vi.fn()} />);

    act(() => {
      fireEvent.change(screen.getByPlaceholderText("Sök workspace..."), {
        target: { value: "hyres" },
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    vi.useRealTimers();
    await user.click(screen.getByText("Öppna fil: Hyreskontrakt 2026"));

    await waitFor(() => {
      expect(fetchDocument).toHaveBeenCalledWith("doc-9");
      expect(useDocumentStore.getState().selectedDocumentId).toBe("doc-9");
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
    });
  });

  it("moves a backend result to another workspace", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "ws-1", name: "Inbox" }),
        makeWorkspace({ id: "ws-2", name: "Kontrakt", is_inbox: false }),
      ],
      activeWorkspaceId: "ws-1",
    });
    vi.mocked(searchDocuments).mockResolvedValue({
      query: "hyres",
      rewritten_query: "hyres",
      answer: "",
      results: [
        {
          doc_id: "doc-9",
          title: "Hyreskontrakt 2026",
          source_path: "/tmp/hyreskontrakt.pdf",
          snippet: "Kontrakt för lokalen i Vasastan.",
          score: 0.9,
          vector_score: 0.6,
          keyword_score: 0.3,
          metadata: {
            workspace_id: "ws-2",
            workspace_name: "Kontrakt",
          },
        },
      ],
    });

    render(<CommandPalette open={true} onOpenChange={vi.fn()} />);

    act(() => {
      fireEvent.change(screen.getByPlaceholderText("Sök workspace..."), {
        target: { value: "hyres" },
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    vi.useRealTimers();
    await user.click(screen.getByText("Flytta: Hyreskontrakt 2026"));
    expect(screen.getByPlaceholderText("Flytta Hyreskontrakt 2026 till workspace...")).toBeInTheDocument();
    await user.click(screen.getAllByText("Inbox").at(-1)!);

    await waitFor(() => {
      expect(moveFilesToWorkspace).toHaveBeenCalledWith("ws-1", ["doc-9"]);
    });
  });
});
