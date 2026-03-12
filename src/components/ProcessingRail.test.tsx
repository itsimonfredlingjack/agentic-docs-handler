import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ProcessingRail } from "./ProcessingRail";
import { useDocumentStore } from "../store/documentStore";
import type { UiDocument } from "../types/documents";

function makeDoc(overrides: Partial<UiDocument> = {}): UiDocument {
  return {
    id: "doc-1",
    requestId: "req-1",
    title: "faktura.pdf",
    summary: "",
    mimeType: "application/pdf",
    sourceModality: "text",
    kind: "invoice",
    documentType: "invoice",
    template: "processing",
    sourcePath: null,
    createdAt: "2026-03-12T10:00:00Z",
    updatedAt: "2026-03-12T10:00:00Z",
    classification: {
      document_type: "invoice",
      template: "processing",
      title: "faktura.pdf",
      summary: "",
      tags: [],
      language: "sv",
      confidence: 0,
      ocr_text: null,
      suggested_actions: [],
    },
    extraction: null,
    transcription: null,
    movePlan: null,
    moveResult: null,
    status: "classifying",
    tags: [],
    undoToken: null,
    retryable: false,
    errorCode: null,
    warnings: [],
    moveStatus: "not_requested",
    ...overrides,
  } as UiDocument;
}

function seedStore(docs: UiDocument[]) {
  useDocumentStore.setState({
    documents: Object.fromEntries(docs.map((d) => [d.id, d])),
    documentOrder: docs.map((d) => d.id),
  });
}

describe("ProcessingRail", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      documents: {},
      documentOrder: [],
    });
  });

  it("renders nothing when no processing documents", () => {
    const { container } = render(<ProcessingRail />);
    expect(container.innerHTML).toBe("");
  });

  it("renders rail card for processing document", () => {
    const doc = makeDoc({ status: "classifying", title: "faktura.pdf" });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    expect(container.querySelector(".rail-card__title")?.textContent).toBe("faktura.pdf");
    expect(container.querySelector(".rail-card__stage")?.textContent).toBe("Klassificera");
  });

  it("does not render completed documents", () => {
    const doc = makeDoc({ status: "completed" });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    expect(container.innerHTML).toBe("");
  });

  it("renders multiple rail cards", () => {
    const doc1 = makeDoc({ id: "doc-1", requestId: "req-1", status: "classifying", title: "a.pdf" });
    const doc2 = makeDoc({ id: "doc-2", requestId: "req-2", status: "extracting", title: "b.pdf" });
    seedStore([doc1, doc2]);
    const { container } = render(<ProcessingRail />);
    const cards = container.querySelectorAll("[data-testid='rail-card']");
    expect(cards).toHaveLength(2);
  });

  it("renders audio waveform for audio modality", () => {
    const doc = makeDoc({ sourceModality: "audio", status: "transcribing" });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    expect(container.querySelector(".rail-card__modality-audio")).not.toBeNull();
  });

  it("renders scan line for image modality", () => {
    const doc = makeDoc({ sourceModality: "image", status: "classifying" });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    expect(container.querySelector(".rail-card__modality-scan")).not.toBeNull();
  });

  it("renders standard processing-bar for text modality", () => {
    const doc = makeDoc({ sourceModality: "text", status: "classifying" });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    expect(container.querySelector(".processing-bar")).not.toBeNull();
  });
});
