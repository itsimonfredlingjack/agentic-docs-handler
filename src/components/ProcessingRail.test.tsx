import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
    // classifying is post-classification, so title is ghost-typed (GhostTyper starts empty)
    expect(container.querySelector("[data-testid='ghost-typer']")).not.toBeNull();
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

  it("applies document-type CSS class after classification", () => {
    const doc = makeDoc({ status: "classified", kind: "receipt" });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    const card = container.querySelector("[data-testid='rail-card']");
    expect(card?.classList.contains("rail-card--receipt")).toBe(true);
  });

  it("applies unclassified class during early processing", () => {
    const doc = makeDoc({ status: "queued", kind: "invoice" });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    const card = container.querySelector("[data-testid='rail-card']");
    expect(card?.classList.contains("rail-card--unclassified")).toBe(true);
    expect(card?.classList.contains("rail-card--invoice")).toBe(false);
  });

  it("applies classify-pending during processing stage", () => {
    const doc = makeDoc({ status: "processing", kind: "invoice" });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    const card = container.querySelector("[data-testid='rail-card']");
    expect(card?.classList.contains("rail-card--classify-pending")).toBe(true);
    expect(card?.classList.contains("rail-card--unclassified")).toBe(false);
    expect(card?.classList.contains("rail-card--invoice")).toBe(false);
  });

  it("applies classify-pending during transcribing stage", () => {
    const doc = makeDoc({ status: "transcribing", kind: "audio", sourceModality: "audio" });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    const card = container.querySelector("[data-testid='rail-card']");
    expect(card?.classList.contains("rail-card--classify-pending")).toBe(true);
    expect(card?.classList.contains("rail-card--unclassified")).toBe(false);
  });

  it("keeps unclassified for queued/uploading stages", () => {
    for (const status of ["queued", "uploading"] as const) {
      const doc = makeDoc({ id: `doc-${status}`, status, kind: "invoice" });
      seedStore([doc]);
      const { container, unmount } = render(<ProcessingRail />);
      const card = container.querySelector("[data-testid='rail-card']");
      expect(card?.classList.contains("rail-card--unclassified")).toBe(true);
      expect(card?.classList.contains("rail-card--classify-pending")).toBe(false);
      unmount();
    }
  });

  it("applies classify-lock on classification transition", async () => {
    const processingDoc = makeDoc({ status: "processing", kind: "invoice" });
    seedStore([processingDoc]);
    const { container, rerender } = render(<ProcessingRail />);

    // Transition to classified
    const classifiedDoc = { ...processingDoc, status: "classified" as const };
    act(() => {
      seedStore([classifiedDoc]);
      rerender(<ProcessingRail />);
    });

    const card = container.querySelector("[data-testid='rail-card']");
    expect(card?.classList.contains("rail-card--classify-lock")).toBe(true);
    expect(card?.classList.contains("rail-card--invoice")).toBe(true);
  });

  it("ghost-types the document title after classification", () => {
    const doc = makeDoc({ status: "classified", kind: "receipt", title: "Faktura Telia" });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    expect(container.querySelector("[data-testid='ghost-typer']")).not.toBeNull();
  });

  it("shows extraction key line when extraction data is present", () => {
    const doc = makeDoc({
      status: "organizing",
      kind: "invoice",
      title: "Faktura Telia",
      extraction: {
        fields: { vendor: "Telia", amount: "4200 kr" },
        field_confidence: {},
        missing_fields: [],
      },
    });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    const ghostTypers = container.querySelectorAll("[data-testid='ghost-typer']");
    expect(ghostTypers.length).toBeGreaterThanOrEqual(2);
  });

  it("renders evaporation overlay when thumbnailData present and extracting", async () => {
    const doc = makeDoc({
      status: "extracting",
      thumbnailData: "base64thumbnaildata",
    });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    // The overlay renders only when progress > 0; progress starts at 0 and RAF drives it up.
    // We need to wait for at least one animation frame tick to increment progress.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.querySelector(".rail-card__evap")).not.toBeNull();
  });

  it("does not render evaporation when thumbnailData is null", () => {
    const doc = makeDoc({
      status: "extracting",
      thumbnailData: null,
    });
    seedStore([doc]);
    const { container } = render(<ProcessingRail />);
    expect(container.querySelector(".rail-card__evap")).toBeNull();
  });

  it("marks evaporation done when extraction completes", async () => {
    const doc = makeDoc({
      status: "extracting",
      thumbnailData: "base64thumbnaildata",
    });
    seedStore([doc]);
    const { container, rerender } = render(<ProcessingRail />);

    // Advance so overlay appears
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Transition to organizing (post-extraction)
    const organizedDoc = { ...doc, status: "organizing" as const };
    act(() => {
      seedStore([organizedDoc]);
      rerender(<ProcessingRail />);
    });

    // Progress should snap to 100 → --done classes applied
    const evapThumb = container.querySelector(".rail-card__evap-thumb");
    const evapLine = container.querySelector(".rail-card__evap-line");
    expect(evapThumb?.classList.contains("rail-card__evap-thumb--done")).toBe(true);
    expect(evapLine?.classList.contains("rail-card__evap-line--done")).toBe(true);
  });

  it("shows completion receipt for recently-completed document", () => {
    const processingDoc = makeDoc({ status: "classifying", title: "faktura.pdf" });
    useDocumentStore.setState({
      documents: { "doc-1": processingDoc },
      documentOrder: ["doc-1"],
      stageHistory: { "req-1": [{ stage: "uploading", at: 1000 }, { stage: "classifying", at: 2000 }] },
    });
    const { rerender, container } = render(<ProcessingRail />);
    // classifying uses GhostTyper which starts empty; verify the rail card is rendered
    expect(container.querySelector("[data-testid='rail-card']")).not.toBeNull();

    const completedVersion = {
      ...processingDoc,
      status: "completed" as const,
      kind: "invoice" as const,
      documentType: "invoice",
    };
    act(() => {
      useDocumentStore.setState({
        documents: { "doc-1": completedVersion },
        documentOrder: ["doc-1"],
        stageHistory: { "req-1": [{ stage: "uploading", at: 1000 }, { stage: "completed", at: 5000 }] },
      });
    });
    act(() => {
      rerender(<ProcessingRail />);
    });
    expect(screen.getByText(/Faktura/)).toBeInTheDocument();
  });
});
