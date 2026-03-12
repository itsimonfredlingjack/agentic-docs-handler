import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeedCard } from "./FeedCard";
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
  extraction: { fields: { vendor: "Telia", amount: "1 250 kr" }, field_confidence: {}, missing_fields: [] },
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

describe("FeedCard", () => {
  it("shows pipeline stepper when document is processing", () => {
    render(
      <FeedCard
        document={{ ...baseDoc, status: "classifying" }}
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "classifying", at: 2000 },
        ]}
      />,
    );
    expect(screen.getByRole("group", { name: /pipeline/i })).toBeInTheDocument();
  });

  it("renders template card for completed document", () => {
    render(
      <FeedCard
        document={baseDoc}
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "completed", at: 5000 },
        ]}
      />,
    );
    expect(screen.getAllByText(/Telia/).length).toBeGreaterThan(0);
  });

  it("shows compact summary line for completed documents", () => {
    render(
      <FeedCard
        document={{
          ...baseDoc,
          moveResult: { attempted: true, success: true, from_path: "/a", to_path: "/dst/faktura.pdf", error: null },
          moveStatus: "moved",
        }}
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "completed", at: 13500 },
        ]}
      />,
    );
    expect(screen.getByText(/\/dst\/faktura\.pdf/)).toBeInTheDocument();
    expect(screen.getByText("12.5s")).toBeInTheDocument();
  });

  it("shows failure state with retry button", () => {
    render(
      <FeedCard
        document={{ ...baseDoc, status: "failed", retryable: true, errorCode: "llm_timeout" }}
        history={[{ stage: "uploading", at: 1000 }, { stage: "classifying", at: 2000 }]}
      />,
    );
    expect(screen.getByText(/Försök igen/i)).toBeInTheDocument();
  });
});
