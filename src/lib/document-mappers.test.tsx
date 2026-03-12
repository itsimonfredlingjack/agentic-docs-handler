import { describe, expect, it } from "vitest";

import { mapProcessResponseToUiDocument } from "./document-mappers";
import { getKeyLine, isInternalPipelineFlag } from "./status";
import type { ProcessResponse, UiDocument } from "../types/documents";

describe("document mappers", () => {
  it("filters internal pipeline flags from warnings and keeps diagnostics", () => {
    const payload: ProcessResponse = {
      request_id: "req-1",
      status: "move_planned",
      mime_type: "text/plain",
      classification: {
        document_type: "generic",
        template: "generic",
        title: "Doc",
        summary: "Summary",
        tags: [],
        language: "sv",
        confidence: 0,
        ocr_text: null,
        suggested_actions: [],
      },
      extraction: {
        fields: {},
        field_confidence: {},
        missing_fields: [],
      },
      move_plan: {
        rule_name: null,
        destination: null,
        auto_move_allowed: false,
        reason: "no_matching_rule",
      },
      move_result: {
        attempted: false,
        success: false,
        from_path: null,
        to_path: null,
        error: null,
      },
      timings: {},
      errors: [],
      record_id: "doc-1",
      source_modality: "text",
      created_at: "2026-03-04T10:00:00Z",
      transcription: null,
      ui_kind: "generic",
      undo_token: null,
      move_status: "not_requested",
      retryable: false,
      error_code: null,
      warnings: ["classifier_invalid_json_fallback", "User warning"],
      diagnostics: {
        pipeline_flags: ["classifier_invalid_json_fallback"],
        classifier_raw_response_path: "/tmp/raw-response.json",
        fallback_reason: "classifier_invalid_json",
      },
    };

    const document = mapProcessResponseToUiDocument(payload);

    expect(document.warnings).toEqual(["User warning"]);
    expect(document.diagnostics?.pipeline_flags).toEqual(["classifier_invalid_json_fallback"]);
  });
});

describe("getKeyLine", () => {
  it("returns key info for a generic document with extraction fields", () => {
    const document: UiDocument = {
      id: "doc-1",
      requestId: "req-1",
      title: "Intyg",
      summary: "Sammanfattning",
      mimeType: "text/plain",
      sourceModality: "text",
      kind: "generic",
      documentType: "generic",
      template: "generic",
      sourcePath: "/tmp/intyg.pdf",
      createdAt: "2026-03-04T10:00:00Z",
      updatedAt: "2026-03-04T10:00:00Z",
      classification: {
        document_type: "generic",
        template: "generic",
        title: "Intyg",
        summary: "Sammanfattning",
        tags: [],
        language: "sv",
        confidence: 0,
        ocr_text: null,
        suggested_actions: [],
      },
      extraction: { fields: { name: "Test", org: "Corp" }, field_confidence: {}, missing_fields: [] },
      transcription: null,
      movePlan: null,
      moveResult: null,
      status: "ready",
      tags: [],
      undoToken: null,
      retryable: false,
      errorCode: null,
      warnings: [],
      moveStatus: "not_requested",
      diagnostics: null,
    };

    expect(getKeyLine(document)).toBe("Test · Corp");
  });
});

describe("isInternalPipelineFlag", () => {
  it("identifies classifier_ prefixed flags", () => {
    expect(isInternalPipelineFlag("classifier_invalid_json_fallback")).toBe(true);
  });

  it("passes through user-facing warnings", () => {
    expect(isInternalPipelineFlag("User warning")).toBe(false);
  });
});
