import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useWorkspaceChat", () => ({
  useWorkspaceChat: () => ({
    conversation: undefined,
    isStreaming: false,
    sendMessage: vi.fn(),
    chatDocument: null,
  }),
}));

import { HomeChat } from "./HomeChat";
import { useDocumentStore } from "../store/documentStore";
import type { UiDocument } from "../types/documents";

function makeDoc(partial: Partial<UiDocument> = {}): UiDocument {
  return {
    id: "doc-1",
    requestId: "req-1",
    title: "ICA Kvittounderlag",
    summary: "Mjölk och bröd",
    mimeType: "text/plain",
    sourceModality: "text",
    kind: "receipt",
    documentType: "receipt",
    template: "receipt",
    sourcePath: "/tmp/receipt.txt",
    createdAt: "2026-03-25T08:00:00.000Z",
    updatedAt: "2026-03-25T08:00:00.000Z",
    classification: {
      document_type: "receipt",
      template: "receipt",
      title: "ICA Kvittounderlag",
      summary: "Mjölk och bröd",
      tags: ["receipt"],
      language: "sv",
      confidence: 0.95,
      ocr_text: null,
      suggested_actions: [],
    },
    extraction: { fields: {}, field_confidence: {}, missing_fields: [] },
    transcription: null,
    movePlan: null,
    moveResult: null,
    status: "ready",
    tags: ["receipt"],
    undoToken: null,
    retryable: false,
    errorCode: null,
    warnings: [],
    moveStatus: "not_requested",
    ...partial,
  };
}

describe("HomeChat", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      clientId: null,
      connectionState: "connected",
      documents: {},
      documentOrder: [],
      counts: {
        all: 0,
        processing: 0,
        receipt: 0,
        contract: 0,
        invoice: 0,
        meeting_notes: 0,
        audio: 0,
        generic: 0,
        moved: 0,
      },
      activity: [],
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
      sidebarFilter: "all",
      toasts: [],
      uploadsByRequestId: {},
      pendingMoveStateByRecordId: {},
      selectedDocumentId: null,
      stageHistory: {},
      activeWorkspace: "all",
      activeDocumentChat: null,
      conversations: {},
    });
  });

  it("renders the new AI presence in idle state", () => {
    const doc = makeDoc();
    useDocumentStore.setState({
      documents: { [doc.id]: doc },
      documentOrder: [doc.id],
      counts: { ...useDocumentStore.getState().counts, all: 1, receipt: 1 },
    });

    render(<HomeChat />);

    const presence = screen.getByTestId("ai-presence");
    expect(presence).toHaveAttribute("data-state", "idle");
    expect(presence).toHaveAttribute("data-accent-kind", "receipt");
  });

  it("switches to ready state when the notebook input is focused", async () => {
    render(<HomeChat />);

    await userEvent.click(screen.getByPlaceholderText("Ställ en fråga..."));

    expect(screen.getByTestId("ai-presence")).toHaveAttribute("data-state", "ready");
  });

  it("shows processing state when documents are actively ingesting", () => {
    const doc = makeDoc({
      status: "extracting",
      updatedAt: "2026-03-25T08:00:10.000Z",
    });
    useDocumentStore.setState({
      documents: { [doc.id]: doc },
      documentOrder: [doc.id],
      counts: { ...useDocumentStore.getState().counts, all: 1, processing: 1, receipt: 1 },
    });

    render(<HomeChat />);

    const presence = screen.getByTestId("ai-presence");
    expect(presence).toHaveAttribute("data-state", "processing");
    expect(presence).toHaveAttribute("data-processing-stage", "extracting");
  });

  it("shows warning state when documents need attention", () => {
    const doc = makeDoc({
      status: "failed",
      moveStatus: "awaiting_confirmation",
      updatedAt: "2026-03-25T08:00:10.000Z",
    });
    useDocumentStore.setState({
      documents: { [doc.id]: doc },
      documentOrder: [doc.id],
      counts: { ...useDocumentStore.getState().counts, all: 1, receipt: 1 },
    });

    render(<HomeChat />);

    expect(screen.getByTestId("ai-presence")).toHaveAttribute("data-state", "warning");
  });

  it("shows offline state when the backend connection is unavailable", () => {
    useDocumentStore.setState({ connectionState: "disconnected" });

    render(<HomeChat />);

    expect(screen.getByTestId("ai-presence")).toHaveAttribute("data-state", "offline");
  });
});
