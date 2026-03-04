import { beforeEach, describe, expect, it } from "vitest";

import { useDocumentStore } from "./documentStore";
import type { SearchResponse, UiDocument } from "../types/documents";

const sampleDocument: UiDocument = {
  id: "doc-1",
  requestId: "req-1",
  title: "ICA",
  summary: "Receipt summary",
  mimeType: "text/plain",
  sourceModality: "text",
  kind: "receipt",
  documentType: "receipt",
  template: "receipt",
  sourcePath: "/tmp/receipt.txt",
  createdAt: "2026-03-04T10:00:00Z",
  updatedAt: "2026-03-04T10:00:00Z",
  classification: {
    document_type: "receipt",
    template: "receipt",
    title: "ICA",
    summary: "Receipt summary",
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
  undoToken: "mv-1",
  retryable: false,
  errorCode: null,
  warnings: [],
  moveStatus: "moved",
};

describe("documentStore", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      clientId: null,
      connectionState: "connecting",
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
        loading: false,
        active: false,
        resultIds: [],
        orphanResults: [],
      },
      sidebarFilter: "all",
      toasts: [],
      uploadsByRequestId: {},
    });
  });

  it("replaces queued placeholder when final document arrives", () => {
    const store = useDocumentStore.getState();
    store.queueUploads([{ ...sampleDocument, id: "local:req-1", status: "uploading" }]);
    store.upsertDocument(sampleDocument);

    const state = useDocumentStore.getState();
    expect(state.documentOrder).toEqual(["doc-1"]);
    expect(state.documents["doc-1"].status).toBe("ready");
  });

  it("maps search response into matched ids and orphan results", () => {
    const store = useDocumentStore.getState();
    store.bootstrap([sampleDocument], stateCounts(), []);
    const response: SearchResponse = {
      query: "kvitton mars",
      rewritten_query: "receipt march",
      answer: "Found receipts",
      results: [
        {
          doc_id: "doc-1",
          title: "ICA",
          source_path: "/tmp/receipt.txt",
          snippet: "Receipt summary",
          score: 1,
          vector_score: 0.6,
          keyword_score: 0.4,
          metadata: {},
        },
        {
          doc_id: "external-1",
          title: "External",
          source_path: "/tmp/ext.txt",
          snippet: "Other",
          score: 0.5,
          vector_score: 0.2,
          keyword_score: 0.3,
          metadata: {},
        },
      ],
    };

    store.applySearchResponse(response);

    const state = useDocumentStore.getState();
    expect(state.search.resultIds).toEqual(["doc-1"]);
    expect(state.search.orphanResults).toHaveLength(1);
  });

  it("applies undo response to moved document", () => {
    const store = useDocumentStore.getState();
    store.bootstrap(
      [
        {
          ...sampleDocument,
          moveResult: {
            attempted: true,
            success: true,
            from_path: "/tmp/incoming/receipt.txt",
            to_path: "/tmp/sorted/receipt.txt",
            error: null,
          },
        },
      ],
      stateCounts(),
      [],
    );

    store.applyUndoSuccess({
      success: true,
      from_path: "/tmp/sorted/receipt.txt",
      to_path: "/tmp/incoming/receipt.txt",
      request_id: "undo-1",
      record_id: "doc-1",
    });

    expect(useDocumentStore.getState().documents["doc-1"].sourcePath).toBe("/tmp/incoming/receipt.txt");
  });
});

function stateCounts() {
  return {
    all: 1,
    processing: 0,
    receipt: 1,
    contract: 0,
    invoice: 0,
    meeting_notes: 0,
    audio: 0,
    generic: 0,
    moved: 0,
  };
}
