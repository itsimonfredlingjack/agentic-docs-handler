import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
      },
      uploadsByRequestId: {},
    });
  });

  it("shows empty state when no documents", () => {
    render(<ActivityFeed />);
    expect(screen.getByText("Din digitala assistent vilar")).toBeInTheDocument();
  });

  it("renders documents in feed", () => {
    useDocumentStore.setState({
      documents: { "doc-1": mockDoc },
      documentOrder: ["doc-1"],
      stageHistory: { "req-1": [{ stage: "completed", at: Date.now() }] },
    });
    render(<ActivityFeed />);
    expect(screen.getAllByText("test-doc.pdf").length).toBeGreaterThan(0);
  });

  it("filters documents by sidebar filter", () => {
    useDocumentStore.setState({
      documents: { "doc-1": mockDoc },
      documentOrder: ["doc-1"],
      stageHistory: {},
      sidebarFilter: "receipt",
    });
    render(<ActivityFeed />);
    // mockDoc is "generic" kind, should not match "receipt" filter
    expect(screen.getByText("Din digitala assistent vilar")).toBeInTheDocument();
  });
});
