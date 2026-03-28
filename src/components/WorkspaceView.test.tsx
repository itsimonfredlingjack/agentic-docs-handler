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
});
