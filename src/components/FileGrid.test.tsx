import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  finalizeClientMove,
  dismissPendingMove,
  moveLocalFile,
} = vi.hoisted(() => ({
  finalizeClientMove: vi.fn(),
  dismissPendingMove: vi.fn(),
  moveLocalFile: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  finalizeClientMove,
  dismissPendingMove,
  processFile: vi.fn(),
}));

vi.mock("../lib/tauri-events", () => ({
  moveLocalFile,
}));

import { FileGrid } from "./FileGrid";
import { useDocumentStore } from "../store/documentStore";
import type { UiDocument } from "../types/documents";

const pendingDocument: UiDocument = {
  id: "doc-pending",
  requestId: "req-pending",
  title: "Contract draft",
  summary: "Needs confirmation before moving.",
  mimeType: "application/pdf",
  sourceModality: "text",
  kind: "contract",
  documentType: "contract",
  template: "contract",
  sourcePath: "/tmp/contract.pdf",
  createdAt: "2026-03-04T10:00:00Z",
  updatedAt: "2026-03-04T10:00:00Z",
  classification: {
    document_type: "contract",
    template: "contract",
    title: "Contract draft",
    summary: "Needs confirmation before moving.",
    tags: ["contract"],
    language: "sv",
    confidence: 0.9,
    ocr_text: null,
    suggested_actions: [],
  },
  extraction: { fields: {}, field_confidence: {}, missing_fields: [] },
  transcription: null,
  movePlan: {
    rule_name: "contracts",
    destination: "/tmp/contracts",
    auto_move_allowed: false,
    reason: "rule_matched",
  },
  moveResult: {
    attempted: false,
    success: false,
    from_path: "/tmp/contract.pdf",
    to_path: null,
    error: null,
  },
  status: "awaiting_confirmation",
  tags: ["contract"],
  undoToken: null,
  retryable: false,
  errorCode: null,
  warnings: [],
  moveStatus: "awaiting_confirmation",
};

describe("FileGrid pending move actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({
      clientId: "client-1",
      connectionState: "connected",
      documents: { [pendingDocument.id]: pendingDocument },
      documentOrder: [pendingDocument.id],
      counts: {
        all: 1,
        processing: 1,
        receipt: 0,
        contract: 1,
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
      pendingMoveStateByRecordId: {},
    });
  });

  it("shows loading state and calls dismiss endpoint for Not now", async () => {
    const user = userEvent.setup();
    let resolveDismiss: ((value: unknown) => void) | undefined;
    dismissPendingMove.mockReturnValue(
      new Promise((resolve) => {
        resolveDismiss = resolve;
      }),
    );

    render(<FileGrid />);

    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(dismissPendingMove).toHaveBeenCalledWith("doc-pending", "req-pending", "client-1");
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();

    await act(async () => {
      resolveDismiss?.({
        success: true,
        record_id: "doc-pending",
        request_id: "req-pending",
        move_status: "not_requested",
      });
      await Promise.resolve();
    });
  });

  it("shows loading state and calls finalize flow for Confirm move", async () => {
    const user = userEvent.setup();
    let resolveFinalize: ((value: unknown) => void) | undefined;
    moveLocalFile.mockResolvedValue({
      success: true,
      from_path: "/tmp/contract.pdf",
      to_path: "/tmp/contracts/contract.pdf",
      error: null,
    });
    finalizeClientMove.mockReturnValue(
      new Promise((resolve) => {
        resolveFinalize = resolve;
      }),
    );

    render(<FileGrid />);

    await user.click(screen.getByRole("button", { name: "Confirm move" }));

    expect(moveLocalFile).toHaveBeenCalledWith("/tmp/contract.pdf", "/tmp/contracts");
    expect(finalizeClientMove).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirming..." })).toBeDisabled();

    await act(async () => {
      resolveFinalize?.({
        success: true,
        record_id: "doc-pending",
        request_id: "req-pending",
        from_path: "/tmp/contract.pdf",
        to_path: "/tmp/contracts/contract.pdf",
        undo_token: "mv-1",
        move_status: "moved",
      });
      await Promise.resolve();
    });
  });
});
