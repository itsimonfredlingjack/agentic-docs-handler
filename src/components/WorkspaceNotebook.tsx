import { useEffect, useRef } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceChat } from "../hooks/useWorkspaceChat";
import { NotebookEntry } from "./NotebookEntry";
import { NotebookInput } from "./NotebookInput";
import { kindColor } from "../lib/document-colors";
import type { UiDocumentKind } from "../types/documents";

const CATEGORY_LABELS: Record<string, string> = {
  all: "Alla filer",
  receipt: "Kvitton",
  contract: "Avtal",
  invoice: "Fakturor",
  meeting_notes: "Möten",
  audio: "Ljud",
  generic: "Övrigt",
};

export function WorkspaceNotebook() {
  const activeWorkspace = useDocumentStore((s) => s.activeWorkspace);
  const activeDocumentChat = useDocumentStore((s) => s.activeDocumentChat);
  const setActiveWorkspace = useDocumentStore((s) => s.setActiveWorkspace);
  const setActiveDocumentChat = useDocumentStore((s) => s.setActiveDocumentChat);
  const counts = useDocumentStore((s) => s.counts);
  const { conversation, isStreaming, sendMessage, chatDocument } = useWorkspaceChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.streamingText, conversation?.entries.length]);

  // Determine mode: category or document
  const isDocumentMode = activeDocumentChat !== null;
  const isActive = activeWorkspace !== null || isDocumentMode;

  if (!isActive) return null;

  // Derive display values based on mode
  let label: string;
  let count: number | null;
  let color: string;
  let placeholder: string;
  let emptyPrompt: string;

  if (isDocumentMode && chatDocument) {
    label = chatDocument.title || "Dokument";
    count = null;
    color = kindColor(chatDocument.kind);
    placeholder = "Fråga om detta dokument...";
    emptyPrompt = "Fråga om detta dokument";
  } else {
    const ws = activeWorkspace!;
    label = CATEGORY_LABELS[ws] ?? ws;
    count = counts[ws as keyof typeof counts] ?? 0;
    color = ws === "all" ? "var(--accent-primary)" : kindColor(ws as UiDocumentKind);
    placeholder = ws === "all" ? "Fråga alla dina dokument..." : `Fråga dina ${label.toLowerCase()}...`;
    emptyPrompt = ws === "all" ? "Fråga alla dina dokument vad som helst" : `Fråga dina ${label.toLowerCase()} vad som helst`;
  }

  const handleClose = () => {
    if (isDocumentMode) {
      setActiveDocumentChat(null);
    } else {
      setActiveWorkspace(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="notebook-header">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: color }}
          />
          <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {label}
          </h2>
          {count !== null && (
            <span className="text-xs text-[var(--text-muted)]">
              {count} filer
            </span>
          )}
        </div>
        <button
          className="notebook-header__close"
          onClick={handleClose}
          aria-label="Stäng chatt"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Notebook entries */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-0 overflow-y-auto pb-2">
        {conversation?.entries.map((entry, index) => {
          const isLast = index === conversation.entries.length - 1;
          return (
              <NotebookEntry
                key={entry.id}
                query={entry.query}
                response={entry.response}
                sourceCount={entry.sourceCount}
                errorMessage={entry.errorMessage}
                isStreaming={isLast && isStreaming}
                streamingText={isLast && isStreaming ? conversation.streamingText : undefined}
              />
            );
        })}

        {(!conversation || conversation.entries.length === 0) && (
          <div className="flex min-h-[200px] flex-col items-center justify-center text-center gap-4 px-4">
            <div className="notebook-empty-icon" style={{ "--empty-color": color } as React.CSSProperties}>
              <svg width="28" height="28" viewBox="0 0 16 16" fill="none">
                <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5.5L3 13.5V11H3a1 1 0 0 1-1-1V3Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
                <path d="M5.5 5.5h5M5.5 7.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              {emptyPrompt}
            </p>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="mt-3 shrink-0">
        <NotebookInput
          placeholder={placeholder}
          disabled={isStreaming}
          onSubmit={sendMessage}
        />
      </div>
    </div>
  );
}
