import { describe, expect, it } from "vitest";

import { mapToUserStatus, userStatusLabel, userStatusColor, getKeyLine, isProcessingStatus, isInternalPipelineFlag } from "./status";
import type { UiDocument } from "../types/documents";

function makeDoc(overrides: Partial<UiDocument> = {}): UiDocument {
  return {
    id: "doc-1",
    requestId: "req-1",
    title: "test.pdf",
    summary: "Summary",
    mimeType: "application/pdf",
    sourceModality: "text",
    kind: "generic",
    documentType: "generic",
    template: "generic",
    sourcePath: null,
    createdAt: "2026-03-12T10:00:00Z",
    updatedAt: "2026-03-12T10:00:00Z",
    classification: {
      document_type: "generic",
      template: "generic",
      title: "test",
      summary: "Summary",
      tags: [],
      language: "sv",
      confidence: 0.9,
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
    diagnostics: null,
    ...overrides,
  };
}

describe("mapToUserStatus", () => {
  it.each([
    ["queued", "uppladdad"],
    ["uploading", "uppladdad"],
    ["processing", "bearbetas"],
    ["transcribing", "bearbetas"],
    ["classifying", "bearbetas"],
    ["classified", "bearbetas"],
    ["extracting", "bearbetas"],
    ["organizing", "bearbetas"],
    ["indexing", "bearbetas"],
    ["awaiting_confirmation", "behöver_granskas"],
    ["failed", "misslyckades"],
    ["pending_classification", "väntar"],
    ["completed", "klar"],
    ["moved", "klar"],
    ["ready", "klar"],
  ] as const)("maps %s → %s", (stage, expected) => {
    expect(mapToUserStatus(makeDoc({ status: stage }))).toBe(expected);
  });
});

describe("userStatusLabel", () => {
  it("returns Swedish label for each status", () => {
    expect(userStatusLabel("uppladdad")).toBe("Uppladdad");
    expect(userStatusLabel("bearbetas")).toBe("Bearbetas");
    expect(userStatusLabel("klar")).toBe("Klar");
    expect(userStatusLabel("behöver_granskas")).toBe("Granska");
    expect(userStatusLabel("misslyckades")).toBe("Misslyckades");
    expect(userStatusLabel("väntar")).toBe("Väntar på AI");
  });
});

describe("userStatusColor", () => {
  it("returns CSS variable for each status", () => {
    expect(userStatusColor("klar")).toBe("var(--receipt-color)");
    expect(userStatusColor("misslyckades")).toBe("var(--invoice-color)");
    expect(userStatusColor("väntar")).toBe("var(--meeting-color)");
  });
});

describe("getKeyLine", () => {
  it("returns vendor · amount · date for receipt", () => {
    const doc = makeDoc({
      kind: "receipt",
      extraction: { fields: { vendor: "ICA", amount: "450 kr", date: "2026-03-10" }, field_confidence: {}, missing_fields: [] },
    });
    expect(getKeyLine(doc)).toBe("ICA · 450 kr · 2026-03-10");
  });

  it("returns vendor · amount · date for invoice", () => {
    const doc = makeDoc({
      kind: "invoice",
      extraction: { fields: { sender: "Telia", total: "1 250 kr", due_date: "2026-04-01" }, field_confidence: {}, missing_fields: [] },
    });
    expect(getKeyLine(doc)).toBe("Telia · 1 250 kr · 2026-04-01");
  });

  it("returns parties · timeline for contract", () => {
    const doc = makeDoc({
      kind: "contract",
      extraction: { fields: { parties: ["AB Corp", "XY Ltd"], start_date: "2026-01-01", end_date: "2027-01-01" }, field_confidence: {}, missing_fields: [] },
    });
    expect(getKeyLine(doc)).toBe("AB Corp, XY Ltd · 2026-01-01 → 2027-01-01");
  });

  it("returns lang · duration · model for audio", () => {
    const doc = makeDoc({
      kind: "audio",
      transcription: { text: "hello", language: "sv", duration: 12.5, model: "large-v3-turbo", source: "whisper", segments: [] },
    });
    expect(getKeyLine(doc)).toBe("sv · 12.5s · large-v3-turbo");
  });

  it("returns → path for file_moved", () => {
    const doc = makeDoc({
      kind: "file_moved",
      moveResult: { attempted: true, success: true, from_path: "/a", to_path: "/b/c.pdf", error: null },
    });
    expect(getKeyLine(doc)).toBe("→ /b/c.pdf");
  });

  it("returns first 2 fields for generic with extraction", () => {
    const doc = makeDoc({
      kind: "generic",
      extraction: { fields: { name: "Test", org: "Corp", extra: "x" }, field_confidence: {}, missing_fields: [] },
    });
    expect(getKeyLine(doc)).toBe("Test · Corp");
  });

  it("returns empty string when no extraction data", () => {
    expect(getKeyLine(makeDoc())).toBe("");
  });
});

describe("isProcessingStatus", () => {
  it("returns true for uploading status", () => {
    expect(isProcessingStatus(makeDoc({ status: "uploading" }))).toBe(true);
  });

  it("returns true for all processing stages", () => {
    for (const status of ["processing", "transcribing", "classifying", "classified", "extracting", "organizing", "indexing"] as const) {
      expect(isProcessingStatus(makeDoc({ status }))).toBe(true);
    }
  });

  it("returns true for queued status", () => {
    expect(isProcessingStatus(makeDoc({ status: "queued" }))).toBe(true);
  });

  it("returns false for completed", () => {
    expect(isProcessingStatus(makeDoc({ status: "completed" }))).toBe(false);
  });

  it("returns false for failed", () => {
    expect(isProcessingStatus(makeDoc({ status: "failed" }))).toBe(false);
  });

  it("returns false for awaiting_confirmation", () => {
    expect(isProcessingStatus(makeDoc({ status: "awaiting_confirmation" }))).toBe(false);
  });

  it("returns false for ready", () => {
    expect(isProcessingStatus(makeDoc({ status: "ready" }))).toBe(false);
  });
});

describe("isInternalPipelineFlag", () => {
  it("flags classifier_ prefixed values", () => {
    expect(isInternalPipelineFlag("classifier_invalid_json_fallback")).toBe(true);
  });

  it("flags pdf_ prefixed values", () => {
    expect(isInternalPipelineFlag("pdf_no_text")).toBe(true);
  });

  it("flags _fallback suffixed values", () => {
    expect(isInternalPipelineFlag("some_fallback")).toBe(true);
  });

  it("does not flag user-facing warnings", () => {
    expect(isInternalPipelineFlag("User warning")).toBe(false);
  });
});
