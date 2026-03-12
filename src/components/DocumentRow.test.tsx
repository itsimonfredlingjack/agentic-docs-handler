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
  it("renders completed document with key line and status pill", () => {
    render(<DocumentRow document={baseDoc} />);
    expect(screen.getByText("faktura-mars.pdf")).toBeInTheDocument();
    expect(screen.getByText("Klar")).toBeInTheDocument();
    expect(screen.getByText("Telia · 1 250 kr · 2026-04-01")).toBeInTheDocument();
  });

  it("shows failed state with retry button", () => {
    const onRetry = vi.fn();
    const { container } = render(
      <DocumentRow
        document={{ ...baseDoc, status: "failed", retryable: true, summary: "LLM timeout" }}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Misslyckades")).toBeInTheDocument();
    expect(screen.getByText("LLM timeout")).toBeInTheDocument();
    expect(container.querySelector(".document-row--failed")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Försök igen"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows review border for awaiting_confirmation", () => {
    const { container } = render(
      <DocumentRow document={{ ...baseDoc, status: "awaiting_confirmation" }} />,
    );
    expect(screen.getByText("Granska")).toBeInTheDocument();
    expect(container.querySelector(".document-row--review")).toBeInTheDocument();
  });

  it("renders destination path for moved documents", () => {
    render(
      <DocumentRow
        document={{
          ...baseDoc,
          moveResult: { attempted: true, success: true, from_path: "/a", to_path: "/dst/fakturor/faktura.pdf", error: null },
          moveStatus: "moved",
        }}
      />,
    );
    expect(screen.getByText(/fakturor\/faktura\.pdf/)).toBeInTheDocument();
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
    const onSelect = vi.fn();
    render(<DocumentRow document={baseDoc} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("document-row"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

});
