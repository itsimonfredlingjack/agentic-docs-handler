import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentRow } from "./DocumentRow";
import type { UiDocument } from "../types/documents";

const baseDoc: UiDocument = {
  id: "doc-1",
  requestId: "req-1",
  title: "faktura-mars.pdf",
  summary: "Faktura från Telia",
  mimeType: "application/pdf",
  sourceModality: "text",
  kind: "invoice",
  documentType: "invoice",
  template: "invoice",
  sourcePath: "/tmp/faktura-mars.pdf",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  classification: {
    document_type: "invoice",
    template: "invoice",
    title: "Faktura mars",
    summary: "Faktura från Telia",
    tags: [],
    language: "sv",
    confidence: 0.92,
    ocr_text: null,
    suggested_actions: [],
  },
  extraction: { fields: { vendor: "Telia", amount: "1 250 kr", due_date: "2026-04-01" }, field_confidence: {}, missing_fields: [] },
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

describe("DocumentRow", () => {
  it("renders AI title and inline extractions", () => {
    render(<DocumentRow document={baseDoc} />);
    // AI title is displayed (classification.title)
    expect(screen.getByText("Faktura mars")).toBeInTheDocument();
    // Inline extractions are rendered as separate spans
    expect(screen.getByText("Telia")).toBeInTheDocument();
    expect(screen.getByText("1 250 kr")).toBeInTheDocument();
  });

  it("shows failed state with retry button", () => {
    const onRetry = vi.fn();
    const { container } = render(
      <DocumentRow
        document={{ ...baseDoc, status: "failed", retryable: true, summary: "LLM timeout" }}
        onRetry={onRetry}
      />,
    );
    // Failed row shows error in both inline extraction area and detail section
    expect(screen.getAllByText("LLM timeout").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".document-row--failed")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Försök igen"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows review border for awaiting_confirmation", () => {
    const { container } = render(
      <DocumentRow document={{ ...baseDoc, status: "awaiting_confirmation" }} />,
    );
    expect(container.querySelector(".document-row--review")).toBeInTheDocument();
  });

  it("shows undo button for moved document with undoToken", () => {
    const onUndo = vi.fn();
    render(
      <DocumentRow
        document={{
          ...baseDoc,
          moveResult: { attempted: true, success: true, from_path: "/tmp/faktura.pdf", to_path: "/dst/faktura.pdf", error: null },
          moveStatus: "moved",
          undoToken: "undo-abc",
        }}
        onUndo={onUndo}
      />,
    );
    expect(screen.getByText("Ångra flytt")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ångra flytt"));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("does not show undo button when no undoToken", () => {
    render(
      <DocumentRow
        document={{
          ...baseDoc,
          moveResult: { attempted: true, success: true, from_path: "/tmp/faktura.pdf", to_path: "/dst/faktura.pdf", error: null },
          moveStatus: "moved",
          undoToken: null,
        }}
        onUndo={() => {}}
      />,
    );
    expect(screen.queryByText("Ångra flytt")).toBeNull();
  });

  it("is clickable when completed", () => {
    const onSelectId = vi.fn();
    render(<DocumentRow document={baseDoc} onSelectId={onSelectId} />);
    fireEvent.click(screen.getByTestId("document-row"));
    expect(onSelectId).toHaveBeenCalledOnce();
    expect(onSelectId).toHaveBeenCalledWith(baseDoc.id);
  });

  it("shows inbox suggestion badge when isInbox and movePlan exists", () => {
    render(
      <DocumentRow
        document={{
          ...baseDoc,
          movePlan: { rule_name: "invoices", destination: "/docs/invoices", auto_move_allowed: true, reason: "matched" },
        }}
        isInbox
      />,
    );
    expect(screen.getByText("invoices")).toBeInTheDocument();
  });

  it("shows move button in inbox when movePlan exists", () => {
    const onMove = vi.fn();
    const inboxDoc = {
      ...baseDoc,
      movePlan: { destination: "/docs/Receipts/2026/file.pdf", rule_name: "receipt", auto_move_allowed: true, reason: "matched" },
    };
    render(<DocumentRow document={inboxDoc} isInbox onMoveToWorkspace={onMove} />);
    const moveBtn = screen.getByText("Flytta", { selector: "button" });
    expect(moveBtn).toBeInTheDocument();
    fireEvent.click(moveBtn);
    expect(onMove).toHaveBeenCalledWith(inboxDoc.id);
  });

  it("falls back to raw filename when no AI classification", () => {
    render(
      <DocumentRow
        document={{
          ...baseDoc,
          classification: null as any,
          extraction: null,
        }}
      />,
    );
    // Raw filename used as title (also appears as extraction fallback)
    expect(screen.getAllByText("faktura-mars.pdf").length).toBeGreaterThanOrEqual(1);
  });
});
