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
      stageHistory: {},
      activeWorkspace: null,
      conversations: {},
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
    expect(state.search.status).toBe("ready");
    expect(state.search.error).toBeNull();
    expect(state.search.resultIds).toEqual(["doc-1"]);
    expect(state.search.orphanResults).toHaveLength(1);
  });

  it("marks empty search responses with empty status", () => {
    const store = useDocumentStore.getState();
    store.bootstrap([sampleDocument], stateCounts(), []);
    store.applySearchResponse({
      query: "nonexistent",
      rewritten_query: "nonexistent",
      answer: "",
      results: [],
    });

    expect(useDocumentStore.getState().search.status).toBe("empty");
  });

  it("tracks loading and error search transitions", () => {
    const store = useDocumentStore.getState();
    store.setSearchLoading("rent");
    expect(useDocumentStore.getState().search.status).toBe("loading");
    store.setSearchError("rent", "search_unavailable");

    const search = useDocumentStore.getState().search;
    expect(search.status).toBe("error");
    expect(search.error).toBe("search_unavailable");
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

  it("preserves rendered document summary when a late job failure arrives", () => {
    const store = useDocumentStore.getState();
    store.bootstrap([sampleDocument], stateCounts(), []);

    store.markJobFailed("req-1", "index_failed", "index_failed");

    const state = useDocumentStore.getState();
    expect(state.documents["doc-1"].summary).toBe("Receipt summary");
    expect(state.documents["doc-1"].errorCode).toBe("index_failed");
    expect(state.documents["doc-1"].status).toBe("failed");
  });

  it("updateExtractionField updates the field value in the document", () => {
    const store = useDocumentStore.getState();
    store.bootstrap(
      [
        {
          ...sampleDocument,
          extraction: { fields: { vendor: "Staples", total: "$42.50" }, field_confidence: {}, missing_fields: [] },
        },
      ],
      stateCounts(),
      [],
    );

    store.updateExtractionField("doc-1", "vendor", "Acme Corp");

    const state = useDocumentStore.getState();
    expect(state.documents["doc-1"].extraction?.fields["vendor"]).toBe("Acme Corp");
    expect(state.documents["doc-1"].extraction?.fields["total"]).toBe("$42.50");
  });

  it("updateExtractionField is a no-op when document has no extraction", () => {
    const store = useDocumentStore.getState();
    store.bootstrap(
      [{ ...sampleDocument, extraction: null as any }],
      stateCounts(),
      [],
    );

    store.updateExtractionField("doc-1", "vendor", "Acme Corp");

    const state = useDocumentStore.getState();
    expect(state.documents["doc-1"].extraction).toBeNull();
  });

  it("setDocumentThumbnail applies thumbnail data by requestId", () => {
    const store = useDocumentStore.getState();
    store.bootstrap([sampleDocument], stateCounts(), []);
    store.setDocumentThumbnail("req-1", "base64data");
    expect(useDocumentStore.getState().documents["doc-1"].thumbnailData).toBe("base64data");
  });

  it("setDocumentThumbnail is a no-op for unknown requestId", () => {
    const store = useDocumentStore.getState();
    store.bootstrap([sampleDocument], stateCounts(), []);
    store.setDocumentThumbnail("unknown-req", "base64data");
    expect(useDocumentStore.getState().documents["doc-1"].thumbnailData).toBeUndefined();
  });

  it("applies move dismissed to pending confirmation document", () => {
    const store = useDocumentStore.getState();
    store.bootstrap(
      [
        {
          ...sampleDocument,
          kind: "contract",
          documentType: "contract",
          movePlan: {
            rule_name: "contracts",
            destination: "/tmp/contracts",
            auto_move_allowed: false,
            reason: "rule_matched",
          },
          status: "awaiting_confirmation",
          moveStatus: "awaiting_confirmation",
        },
      ],
      stateCounts(),
      [],
    );

    store.applyMoveDismissed({
      success: true,
      record_id: "doc-1",
      request_id: "req-1",
      move_status: "not_requested",
    });

    const state = useDocumentStore.getState();
    expect(state.documents["doc-1"].moveStatus).toBe("not_requested");
    expect(state.documents["doc-1"].status).toBe("completed");
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

describe("stageHistory", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      documents: {},
      documentOrder: [],
      stageHistory: {},
    });
  });

  it("records timestamp when a job stage is marked", () => {
    const store = useDocumentStore.getState();
    store.upsertDocument({
      id: "doc-1",
      requestId: "req-1",
      title: "test.pdf",
      status: "uploading",
    } as any);

    store.markJobStage("req-1", "classifying");

    const history = useDocumentStore.getState().stageHistory["req-1"];
    expect(history).toBeDefined();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].stage).toBe("classifying");
    expect(typeof history[0].at).toBe("number");
  });

  it("appends stages in order", () => {
    const store = useDocumentStore.getState();
    store.upsertDocument({
      id: "doc-1",
      requestId: "req-1",
      title: "test.pdf",
      status: "uploading",
    } as any);

    store.markJobStage("req-1", "classifying");
    store.markJobStage("req-1", "extracting");
    store.markJobStage("req-1", "organizing");

    const history = useDocumentStore.getState().stageHistory["req-1"];
    expect(history.map((h: any) => h.stage)).toEqual([
      "classifying",
      "extracting",
      "organizing",
    ]);
  });

  it("records initial stage on queueUploads", () => {
    const store = useDocumentStore.getState();
    store.queueUploads([
      {
        id: "doc-1",
        requestId: "req-1",
        title: "test.pdf",
        status: "uploading",
      } as any,
    ]);

    const history = useDocumentStore.getState().stageHistory["req-1"];
    expect(history).toBeDefined();
    expect(history[0].stage).toBe("uploading");
  });

  it("computes totalDuration from first to last stage", () => {
    const store = useDocumentStore.getState();
    store.upsertDocument({
      id: "doc-1",
      requestId: "req-1",
      title: "test.pdf",
      status: "uploading",
    } as any);

    useDocumentStore.setState({
      stageHistory: {
        "req-1": [
          { stage: "uploading", at: 1000 },
          { stage: "classifying", at: 3000 },
          { stage: "completed", at: 8000 },
        ],
      },
    });

    const history = useDocumentStore.getState().stageHistory["req-1"];
    const totalMs = history[history.length - 1].at - history[0].at;
    expect(totalMs).toBe(7000);
  });
});

describe("workspace state", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      activeWorkspace: null,
      conversations: {},
    });
  });

  it("sets active workspace", () => {
    const store = useDocumentStore.getState();
    store.setActiveWorkspace("receipt");
    expect(useDocumentStore.getState().activeWorkspace).toBe("receipt");
  });

  it("starts workspace query and creates entry", () => {
    const store = useDocumentStore.getState();
    store.startWorkspaceQuery("receipt", "Vad är momsen?");
    const conv = useDocumentStore.getState().conversations.receipt;
    expect(conv.entries).toHaveLength(1);
    expect(conv.entries[0].query).toBe("Vad är momsen?");
    expect(conv.entries[0].errorMessage).toBeNull();
    expect(conv.isStreaming).toBe(true);
    expect(conv.streamingText).toBe("");
  });

  it("appends streaming tokens to conversation", () => {
    const store = useDocumentStore.getState();
    store.startWorkspaceQuery("receipt", "Vad är momsen?");
    store.appendStreamingToken("receipt", "Totalt");
    store.appendStreamingToken("receipt", " 500 kr");
    const conv = useDocumentStore.getState().conversations.receipt;
    expect(conv.streamingText).toBe("Totalt 500 kr");
  });

  it("finalizes streaming entry with response and source count", () => {
    const store = useDocumentStore.getState();
    store.startWorkspaceQuery("receipt", "Vad är momsen?");
    store.appendStreamingToken("receipt", "Svaret är 500 kr");
    store.finalizeStreamingEntry("receipt", 5);
    const conv = useDocumentStore.getState().conversations.receipt;
    expect(conv.isStreaming).toBe(false);
    expect(conv.streamingText).toBe("");
    expect(conv.entries[0].response).toBe("Svaret är 500 kr");
    expect(conv.entries[0].sourceCount).toBe(5);
    expect(conv.entries[0].errorMessage).toBeNull();
  });

  it("finalizes streaming entry with partial response and error state", () => {
    const store = useDocumentStore.getState();
    store.startWorkspaceQuery("receipt", "Vad är momsen?");
    store.appendStreamingToken("receipt", "Delvis svar");
    store.finalizeStreamingEntry("receipt", 3, "workspace/chat: 503");
    const conv = useDocumentStore.getState().conversations.receipt;
    expect(conv.isStreaming).toBe(false);
    expect(conv.entries[0].response).toBe("Delvis svar");
    expect(conv.entries[0].sourceCount).toBe(3);
    expect(conv.entries[0].errorMessage).toBe("workspace/chat: 503");
  });
});
