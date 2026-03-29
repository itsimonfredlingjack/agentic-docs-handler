import { useEffect, useRef } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkspaceChat } from "../hooks/useWorkspaceChat";
import { NotebookEntry } from "./NotebookEntry";
import { NotebookInput } from "./NotebookInput";
import { kindColor } from "../lib/document-colors";

export function WorkspaceNotebook() {
  const activeDocumentChat = useDocumentStore((s) => s.activeDocumentChat);
  const setActiveDocumentChat = useDocumentStore((s) => s.setActiveDocumentChat);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const setChatPanelOpen = useWorkspaceStore((s) => s.setChatPanelOpen);
  const { conversation, isStreaming, sendMessage, chatDocument } = useWorkspaceChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.streamingText, conversation?.entries.length]);

  // Determine mode: category or document
  const isDocumentMode = activeDocumentChat !== null;
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const isActive = workspace !== undefined || isDocumentMode;

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
    label = workspace?.name ?? "Workspace";
    count = workspace?.file_count ?? 0;
    color = workspace?.cover_color || "var(--accent-primary)";
    placeholder = `Fråga ${label}...`;
    emptyPrompt = `Fråga ${label} vad som helst`;
  }

  const handleClose = () => {
    if (isDocumentMode) setActiveDocumentChat(null);
    setChatPanelOpen(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-2 min-w-0 pr-2">
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: color }}
          />
          <h2 className="truncate text-[10px] uppercase font-bold tracking-[0.08em] text-[var(--text-primary)]">
            {label}
          </h2>
          {count !== null && (
            <span className="text-[10px] text-[var(--text-muted)] font-[var(--font-mono)]">
              {count}
            </span>
          )}
        </div>
        <button
          className="text-[var(--text-muted)] hover:text-white transition-colors p-1"
          onClick={handleClose}
          aria-label="Stäng chatt"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Notebook entries */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-0 overflow-y-auto pb-2 scrollbar-hide">
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
          <div className="flex min-h-[120px] flex-col justify-center px-2 py-4 border border-dashed border-[rgba(255,255,255,0.06)] rounded-sm mt-2">
            <p className="text-[10px] uppercase tracking-[0.08em] font-bold text-[var(--text-muted)] mb-1">
              Contextual Chat
            </p>
            <p className="text-xs leading-relaxed text-[var(--text-disabled)] max-w-xs">
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
