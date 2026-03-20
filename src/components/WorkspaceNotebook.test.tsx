import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useWorkspaceChat", () => ({
  useWorkspaceChat: () => ({
    conversation: undefined,
    isStreaming: false,
    sendMessage: vi.fn(),
  }),
}));

import { WorkspaceNotebook } from "./WorkspaceNotebook";
import { useDocumentStore } from "../store/documentStore";

describe("WorkspaceNotebook", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      activeWorkspace: "receipt",
      counts: {
        all: 1,
        processing: 0,
        receipt: 1,
        contract: 0,
        invoice: 0,
        meeting_notes: 0,
        audio: 0,
        generic: 0,
        moved: 0,
      },
    });
  });

  it("renders the notebook input and empty state", () => {
    render(<WorkspaceNotebook />);

    expect(screen.getByPlaceholderText("Fråga dina kvitton...")).toBeInTheDocument();
    expect(screen.getByText("Fråga dina kvitton vad som helst")).toBeInTheDocument();
  });
});
