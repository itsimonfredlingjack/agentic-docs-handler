import { useEffect, useRef } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceChat } from "../hooks/useWorkspaceChat";
import { NotebookEntry } from "./NotebookEntry";
import { NotebookInput } from "./NotebookInput";
import { kindColor } from "../lib/document-colors";
import type { UiDocumentKind } from "../types/documents";

const CATEGORY_LABELS: Record<string, string> = {
  receipt: "Kvitton",
  contract: "Avtal",
  invoice: "Fakturor",
  meeting_notes: "M\u00F6ten",
  audio: "Ljud",
  generic: "\u00D6vrigt",
};

export function WorkspaceNotebook() {
  const activeWorkspace = useDocumentStore((s) => s.activeWorkspace);
  const setActiveWorkspace = useDocumentStore((s) => s.setActiveWorkspace);
  const counts = useDocumentStore((s) => s.counts);
  const { conversation, isStreaming, sendMessage } = useWorkspaceChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.streamingText, conversation?.entries.length]);

  if (!activeWorkspace) return null;

  const label = CATEGORY_LABELS[activeWorkspace] ?? activeWorkspace;
  const count = counts[activeWorkspace as keyof typeof counts] ?? 0;
  const color = kindColor(activeWorkspace as UiDocumentKind);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3">
        <button
          className="action-secondary px-2.5 py-1 text-xs"
          onClick={() => setActiveWorkspace(null)}
        >
          {"\u2190"}
        </button>
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
          />
          <h2 className="text-base font-bold text-[var(--text-primary)]">
            {label}
          </h2>
          <span className="font-mono text-xs text-[var(--text-muted)]">
            ({count})
          </span>
        </div>
      </div>

      {/* Notebook entries */}
      <div ref={scrollRef} className="flex-1 space-y-0 overflow-y-auto">
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
          <div className="flex min-h-[300px] flex-col items-center justify-center text-center gap-5">
            <div className="ai-avatar" style={{ "--avatar-color": color } as React.CSSProperties}>
              <div className="ai-avatar__ring" />
              <span className="ai-avatar__letter">S</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              Fråga dina {label.toLowerCase()} vad som helst
            </p>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="mt-3">
        <NotebookInput
          placeholder={`Fråga dina ${label.toLowerCase()}...`}
          disabled={isStreaming}
          onSubmit={sendMessage}
        />
      </div>
    </div>
  );
}
