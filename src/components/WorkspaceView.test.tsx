import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// DropZone depends on Tauri APIs — mock the whole component
vi.mock("./DropZone", () => ({
  DropZone: () => <div data-testid="drop-zone" />,
}));

import { WorkspaceView } from "./WorkspaceView";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useDocumentStore } from "../store/documentStore";
import type { WorkspaceResponse } from "../types/workspace";
import type { UiDocument } from "../types/documents";

const baseWorkspace: WorkspaceResponse = {
  id: "ws-1",
  name: "Bostadsrätten",
  description: "",
  ai_brief: "",
  ai_entities: [],
  ai_topics: [],
  cover_color: "#5856d6",
  is_inbox: false,
  file_count: 3,
  created_at: "",
  updated_at: "",
};

const baseDoc: UiDocument = {
  id: "doc-1",
  requestId: "req-1",
  title: "kontrakt.pdf",
  summary: "Köpekontrakt",
  mimeType: "application/pdf",
  sourceModality: "text",
  kind: "contract",
  documentType: "contract",
  template: "contract",
  sourcePath: "/tmp/kontrakt.pdf",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  classification: {
    document_type: "contract",
    template: "contract",
    title: "kontrakt.pdf",
    summary: "Köpekontrakt",
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

describe("WorkspaceView", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [baseWorkspace],
      activeWorkspaceId: "ws-1",
    });
    useDocumentStore.setState({
      documents: {},
      documentOrder: [],
      search: {
        query: "",
        rewrittenQuery: "",
        answer: "",
        status: "idle",
        error: null,
        resultIds: [],
        orphanResults: [],
        snippetsByDocId: {},
      },
    });
  });

  it("renders workspace header with name", () => {
    render(<WorkspaceView />);
    expect(screen.getByText("Bostadsrätten")).toBeInTheDocument();
  });

  it("shows empty state when no files", () => {
    render(<WorkspaceView />);
    expect(screen.getByText(/Inga filer ännu/)).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("renders the workspace search bar", () => {
    render(<WorkspaceView />);
    expect(screen.getByPlaceholderText("Sök i dokument...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Öppna filter" })).not.toBeInTheDocument();
  });

  it("returns null when no active workspace", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    const { container } = render(<WorkspaceView />);
    expect(container.firstChild).toBeNull();
  });

  it("renders document rows when documents exist", () => {
    useDocumentStore.setState({
      documents: { "doc-1": baseDoc },
      documentOrder: ["doc-1"],
    });
    render(<WorkspaceView />);
    expect(screen.getByText("kontrakt.pdf")).toBeInTheDocument();
  });

  it("shows only matched rows with snippets when search results are active", () => {
    const secondDoc: UiDocument = {
      ...baseDoc,
      id: "doc-2",
      requestId: "req-2",
      title: "annat.pdf",
      summary: "Annan fil",
      sourcePath: "/tmp/annat.pdf",
    };
    useDocumentStore.setState({
      documents: { "doc-1": baseDoc, "doc-2": secondDoc },
      documentOrder: ["doc-1", "doc-2"],
      search: {
        query: "köpekontrakt",
        rewrittenQuery: "köpekontrakt",
        answer: "",
        status: "ready",
        error: null,
        resultIds: ["doc-1"],
        orphanResults: [],
        snippetsByDocId: { "doc-1": "Detta köpekontrakt gäller bostaden." },
      },
    });

    render(<WorkspaceView />);

    expect(screen.getByText("kontrakt.pdf")).toBeInTheDocument();
    expect(screen.queryByText("annat.pdf")).not.toBeInTheDocument();
    expect(screen.getByTestId("document-row")).toHaveTextContent("Detta köpekontrakt gäller bostaden.");
  });
});
