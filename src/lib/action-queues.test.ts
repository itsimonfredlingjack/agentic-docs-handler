import { describe, it, expect } from "vitest";
import { computeActionQueues, totalActionCount } from "./action-queues";
import type { DiscoveryCard, UiDocument } from "../types/documents";

function makeDoc(overrides: Partial<UiDocument> & { id: string }): UiDocument {
  return {
    requestId: `req-${overrides.id}`,
    title: overrides.id,
    summary: "",
    mimeType: "text/plain",
    sourceModality: "text",
    kind: "receipt",
    documentType: "receipt",
    template: "receipt",
    sourcePath: null,
    createdAt: "2026-04-01T10:00:00Z",
    updatedAt: "2026-04-01T10:00:00Z",
    classification: {
      document_type: "receipt",
      template: "receipt",
      title: overrides.id,
      summary: "",
      tags: [],
      language: "sv",
      confidence: 0.95,
      ocr_text: null,
      suggested_actions: [],
    },
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
    ...overrides,
  };
}

function makeCard(overrides: Partial<DiscoveryCard> & { id: string }): DiscoveryCard {
  return {
    relation_type: "duplicate",
    confidence: 1.0,
    explanation: "test",
    files: [],
    created_at: "2026-04-01T10:00:00Z",
    ...overrides,
  };
}

describe("computeActionQueues", () => {
  it("returns empty array when no cards or generic documents", () => {
    const queues = computeActionQueues([], {});
    expect(queues).toEqual([]);
    expect(totalActionCount(queues)).toBe(0);
  });

  it("groups duplicate pairs into a single merge action", () => {
    // A-B duplicate, B-C duplicate => one group {A, B, C}
    const cards: DiscoveryCard[] = [
      makeCard({
        id: "card-1",
        relation_type: "duplicate",
        files: [
          { id: "A", title: "FileA" },
          { id: "B", title: "FileB" },
        ],
      }),
      makeCard({
        id: "card-2",
        relation_type: "duplicate",
        files: [
          { id: "B", title: "FileB" },
          { id: "C", title: "FileC" },
        ],
      }),
    ];
    const docs: Record<string, UiDocument> = {
      A: makeDoc({ id: "A", title: "FileA" }),
      B: makeDoc({ id: "B", title: "FileB" }),
      C: makeDoc({ id: "C", title: "FileC" }),
    };

    const queues = computeActionQueues(cards, docs);
    const mergeQueue = queues.find((q) => q.type === "merge_duplicates");
    expect(mergeQueue).toBeDefined();
    expect(mergeQueue!.count).toBe(1); // one group, not two pairs
    expect(mergeQueue!.items[0].documents).toHaveLength(3);
    expect(mergeQueue!.items[0].cardIds).toContain("card-1");
    expect(mergeQueue!.items[0].cardIds).toContain("card-2");
  });

  it("creates separate groups for unconnected duplicate pairs", () => {
    const cards: DiscoveryCard[] = [
      makeCard({
        id: "card-1",
        relation_type: "duplicate",
        files: [
          { id: "A", title: "FileA" },
          { id: "B", title: "FileB" },
        ],
      }),
      makeCard({
        id: "card-2",
        relation_type: "duplicate",
        files: [
          { id: "X", title: "FileX" },
          { id: "Y", title: "FileY" },
        ],
      }),
    ];
    const docs: Record<string, UiDocument> = {
      A: makeDoc({ id: "A" }),
      B: makeDoc({ id: "B" }),
      X: makeDoc({ id: "X" }),
      Y: makeDoc({ id: "Y" }),
    };

    const queues = computeActionQueues(cards, docs);
    const mergeQueue = queues.find((q) => q.type === "merge_duplicates");
    expect(mergeQueue).toBeDefined();
    expect(mergeQueue!.count).toBe(2);
  });

  it("creates review queue for generic documents", () => {
    const docs: Record<string, UiDocument> = {
      G1: makeDoc({ id: "G1", kind: "generic" }),
      G2: makeDoc({ id: "G2", kind: "generic" }),
      R1: makeDoc({ id: "R1", kind: "receipt" }),
    };

    const queues = computeActionQueues([], docs);
    const reviewQueue = queues.find((q) => q.type === "review_classification");
    expect(reviewQueue).toBeDefined();
    expect(reviewQueue!.count).toBe(2);
    expect(reviewQueue!.items.map((i) => i.id).sort()).toEqual(["G1", "G2"]);
  });

  it("creates review queue for low-confidence documents", () => {
    const lowDoc = makeDoc({ id: "LOW" });
    lowDoc.classification.confidence = 0.3;
    const docs: Record<string, UiDocument> = { LOW: lowDoc };

    const queues = computeActionQueues([], docs);
    const reviewQueue = queues.find((q) => q.type === "review_classification");
    expect(reviewQueue).toBeDefined();
    expect(reviewQueue!.count).toBe(1);
  });

  it("skips processing/uploading/failed documents for review", () => {
    const docs: Record<string, UiDocument> = {
      P1: makeDoc({ id: "P1", kind: "generic", status: "processing" }),
      P2: makeDoc({ id: "P2", kind: "generic", status: "uploading" }),
      P3: makeDoc({ id: "P3", kind: "generic", status: "failed" }),
    };

    const queues = computeActionQueues([], docs);
    const reviewQueue = queues.find((q) => q.type === "review_classification");
    expect(reviewQueue).toBeUndefined();
  });

  it("creates cluster queue for related cards with 3+ files", () => {
    // Two related cards that share files, totaling 3+ unique files
    const cards: DiscoveryCard[] = [
      makeCard({
        id: "rel-1",
        relation_type: "related",
        files: [
          { id: "A", title: "A" },
          { id: "B", title: "B" },
        ],
      }),
      makeCard({
        id: "rel-2",
        relation_type: "related",
        files: [
          { id: "B", title: "B" },
          { id: "C", title: "C" },
        ],
      }),
    ];
    const docs: Record<string, UiDocument> = {
      A: makeDoc({ id: "A" }),
      B: makeDoc({ id: "B" }),
      C: makeDoc({ id: "C" }),
    };

    const queues = computeActionQueues(cards, docs);
    const clusterQueue = queues.find((q) => q.type === "cluster_to_workspace");
    expect(clusterQueue).toBeDefined();
    expect(clusterQueue!.count).toBe(1);
    expect(clusterQueue!.items[0].documents).toHaveLength(3);
  });

  it("does not create cluster queue for related cards with fewer than 3 files", () => {
    const cards: DiscoveryCard[] = [
      makeCard({
        id: "rel-1",
        relation_type: "related",
        files: [
          { id: "A", title: "A" },
          { id: "B", title: "B" },
        ],
      }),
    ];
    const docs: Record<string, UiDocument> = {
      A: makeDoc({ id: "A" }),
      B: makeDoc({ id: "B" }),
    };

    const queues = computeActionQueues(cards, docs);
    const clusterQueue = queues.find((q) => q.type === "cluster_to_workspace");
    expect(clusterQueue).toBeUndefined();
  });

  it("totalActionCount sums across all queues", () => {
    const cards: DiscoveryCard[] = [
      makeCard({
        id: "card-1",
        relation_type: "duplicate",
        files: [
          { id: "A", title: "A" },
          { id: "B", title: "B" },
        ],
      }),
    ];
    const docs: Record<string, UiDocument> = {
      A: makeDoc({ id: "A" }),
      B: makeDoc({ id: "B" }),
      G: makeDoc({ id: "G", kind: "generic" }),
    };

    const queues = computeActionQueues(cards, docs);
    // 1 duplicate group + 1 generic to review = 2
    expect(totalActionCount(queues)).toBe(2);
  });
});
