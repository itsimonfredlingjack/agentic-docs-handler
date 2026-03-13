import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivityFeed } from "./ActivityFeed";
import { useDocumentStore } from "../store/documentStore";

const mockDoc = {
  id: "doc-1",
  requestId: "req-1",
  title: "test-doc.pdf",
  summary: "Test document",
  mimeType: "application/pdf",
  sourceModality: "text",
  kind: "generic",
  documentType: "generic",
  template: "generic",
  sourcePath: "/tmp/test.pdf",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  classification: null,
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
} as any;

describe("ActivityFeed", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      documents: {},
      documentOrder: [],
      stageHistory: {},
      sidebarFilter: "all",
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
      uploadsByRequestId: {},
    });
  });

  it("shows empty state when no documents", () => {
    render(<ActivityFeed />);
    expect(screen.getByText("Din digitala assistent vilar")).toBeInTheDocument();
  });

  it("renders documents as DocumentRow in feed", () => {
    useDocumentStore.setState({
      documents: { "doc-1": mockDoc },
      documentOrder: ["doc-1"],
      stageHistory: { "req-1": [{ stage: "completed", at: Date.now() }] },
    });
    render(<ActivityFeed />);
    expect(screen.getByText("test-doc.pdf")).toBeInTheDocument();
    expect(screen.getByText("Dokument")).toBeInTheDocument();
    expect(screen.getByTestId("document-row")).toBeInTheDocument();
  });

  it("filters documents by sidebar filter", () => {
    useDocumentStore.setState({
      documents: { "doc-1": mockDoc },
      documentOrder: ["doc-1"],
      stageHistory: {},
      sidebarFilter: "receipt",
    });
    render(<ActivityFeed />);
    expect(screen.getByText("Din digitala assistent vilar")).toBeInTheDocument();
  });

  it("focuses document row on ArrowDown keypress", () => {
    useDocumentStore.setState({
      documents: { "doc-1": mockDoc },
      documentOrder: ["doc-1"],
      stageHistory: {},
    });
    render(<ActivityFeed />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    const row = screen.getByTestId("document-row");
    expect(row.className).toContain("document-row--focused");
  });

  it("excludes processing documents from feed", () => {
    const processingDoc = {
      ...mockDoc,
      id: "doc-proc",
      requestId: "req-proc",
      status: "classifying",
      template: "processing",
    };
    useDocumentStore.setState({
      documents: { "doc-1": mockDoc, "doc-proc": processingDoc },
      documentOrder: ["doc-proc", "doc-1"],
      stageHistory: {},
    });
    render(<ActivityFeed />);
    expect(screen.getByText("test-doc.pdf")).toBeInTheDocument();
    const rows = screen.getAllByTestId("document-row");
    expect(rows).toHaveLength(1);
  });
});
