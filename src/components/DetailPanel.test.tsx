import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { DetailPanel } from "./DetailPanel";
import { useDocumentStore } from "../store/documentStore";
import type { UiDocument } from "../types/documents";

const sampleDocument: UiDocument = {
  id: "doc-1",
  requestId: "req-1",
  title: "Office Supplies Receipt",
  summary: "Paper and pens from Staples.",
  mimeType: "application/pdf",
  sourceModality: "text",
  kind: "receipt",
  documentType: "receipt",
  template: "receipt",
  sourcePath: "/tmp/receipt.pdf",
  createdAt: "2026-03-04T10:00:00Z",
  updatedAt: "2026-03-04T10:00:00Z",
  classification: {
    document_type: "receipt",
    template: "receipt",
    title: "Office Supplies Receipt",
    summary: "Paper and pens from Staples.",
    tags: ["receipt", "office"],
    language: "en",
    confidence: 0.95,
    ocr_text: null,
    suggested_actions: [],
  },
  extraction: {
    fields: { vendor: "Staples", total: "$42.50" },
    field_confidence: { vendor: 0.9, total: 0.95 },
    missing_fields: [],
  },
  transcription: null,
  movePlan: null,
  moveResult: null,
  status: "completed",
  tags: ["receipt", "office"],
  undoToken: null,
  retryable: false,
  errorCode: null,
  warnings: [],
  moveStatus: "not_requested",
};

function seedStore(selectedId: string | null = null) {
  useDocumentStore.setState({
    documents: { [sampleDocument.id]: sampleDocument },
    documentOrder: [sampleDocument.id],
    selectedDocumentId: selectedId,
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
}

describe("DetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is hidden when no document is selected", () => {
    seedStore(null);
    render(<DetailPanel />);
    expect(screen.queryByRole("dialog", { name: "Dokumentdetaljer" })).not.toHaveClass(
      "detail-panel--open",
    );
  });

  it("opens when selectedDocumentId is set", () => {
    seedStore("doc-1");
    render(<DetailPanel />);
    expect(screen.getByRole("dialog", { name: "Dokumentdetaljer" })).toHaveClass(
      "detail-panel--open",
    );
  });

  it("shows title, summary, and extracted fields", () => {
    seedStore("doc-1");
    render(<DetailPanel />);
    expect(screen.getByText("Office Supplies Receipt")).toBeInTheDocument();
    expect(screen.getByText("Paper and pens from Staples.")).toBeInTheDocument();
    expect(screen.getByText("Staples")).toBeInTheDocument();
    expect(screen.getByText("$42.50")).toBeInTheDocument();
  });

  it("closes on Escape key", async () => {
    seedStore("doc-1");
    render(<DetailPanel />);
    expect(screen.getByRole("dialog", { name: "Dokumentdetaljer" })).toHaveClass(
      "detail-panel--open",
    );
    await userEvent.keyboard("{Escape}");
    expect(useDocumentStore.getState().selectedDocumentId).toBeNull();
  });

  it("closes on close button click", async () => {
    seedStore("doc-1");
    render(<DetailPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Stäng detaljpanel" }));
    expect(useDocumentStore.getState().selectedDocumentId).toBeNull();
  });

  it("renders extraction fields as InlineEdit components", async () => {
    seedStore("doc-1");
    render(<DetailPanel />);
    const vendorField = screen.getByText("Staples");
    expect(vendorField).toBeInTheDocument();
    // Clicking the value should switch it to an editable input
    await userEvent.click(vendorField);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("updates extraction field in store on save", async () => {
    seedStore("doc-1");
    render(<DetailPanel />);
    const vendorField = screen.getByText("Staples");
    await userEvent.click(vendorField);
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "Acme Corp");
    await userEvent.keyboard("{Enter}");
    expect(useDocumentStore.getState().documents["doc-1"].extraction?.fields["vendor"]).toBe("Acme Corp");
  });

  it("shows gold checkmark after save", async () => {
    seedStore("doc-1");
    render(<DetailPanel />);
    const vendorField = screen.getByText("Staples");
    await userEvent.click(vendorField);
    const input = screen.getByRole("textbox");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByLabelText("Sparad")).toBeInTheDocument();
  });
});
