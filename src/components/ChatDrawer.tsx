import { useEffect, useRef, useCallback } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkspaceChat } from "../hooks/useWorkspaceChat";
import { NotebookEntry } from "./NotebookEntry";
import { NotebookInput } from "./NotebookInput";
import { t } from "../lib/locale";

type ChatDrawerProps = {
  workspaceId: string;
};

export function ChatDrawer({ workspaceId }: ChatDrawerProps) {
  const expanded = useDocumentStore((s) => s.chatDrawerExpanded);
  const setExpanded = useDocumentStore((s) => s.setChatDrawerExpanded);
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === workspaceId),
  );
  const { conversation, isStreaming, sendMessage, selectedDocumentId } = useWorkspaceChat();
  const selectedDoc = useDocumentStore((s) =>
    s.selectedDocumentId ? s.documents[s.selectedDocumentId] : null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const hasEntries = (conversation?.entries.length ?? 0) > 0;
  const docCount = workspace?.file_count ?? 0;

  // Auto-scroll to bottom on new messages / streaming text
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.streamingText, conversation?.entries.length]);

  // Escape key collapses drawer (capture phase, scoped to drawer)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !expanded) return;
      const target = e.target as HTMLElement | null;
      if (target && drawerRef.current?.contains(target)) {
        e.stopPropagation();
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [expanded, setExpanded]);

  // Handle submit from minimized state: expand + send
  const handleMinimizedSubmit = useCallback(
    (message: string) => {
      setExpanded(true);
      sendMessage(message);
    },
    [setExpanded, sendMessage],
  );

  // Handle focus in minimized bar: expand if there's an existing conversation
  const handleMinimizedFocus = useCallback(
    (focused: boolean) => {
      if (focused && hasEntries) {
        setExpanded(true);
      }
    },
    [hasEntries, setExpanded],
  );

  // Clear conversation for "Ny chatt"
  const handleNewChat = useCallback(() => {
    useDocumentStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        [workspaceId]: { entries: [], isStreaming: false, streamingText: "" },
      },
    }));
  }, [workspaceId]);

  // Small AI ring SVG (14px) for context header
  const aiRing = (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6" stroke="var(--accent-primary)" strokeWidth="1" opacity="0.5" />
      <circle cx="7" cy="7" r="3" fill="var(--accent-primary)" opacity="0.6" />
    </svg>
  );

  // ── Minimized state ──────────────────────────────────
  if (!expanded) {
    return (
      <div
        ref={drawerRef}
        className="chat-drawer shrink-0"
        style={{ height: 52 }}
      >
        <div
          className="flex items-center border-t px-3"
          style={{
            height: 52,
            borderColor: "var(--accent-primary)",
            background: "var(--surface-4)",
          }}
        >
          <div className="flex-1">
            <NotebookInput
              placeholder={t("chat.drawer_placeholder")}
              disabled={isStreaming}
              onSubmit={handleMinimizedSubmit}
              onFocusChange={handleMinimizedFocus}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Expanded state ───────────────────────────────────
  return (
    <div
      ref={drawerRef}
      className="chat-drawer flex shrink-0 flex-col border-t"
      style={{
        height: "50%",
        borderColor: "var(--accent-primary)",
        background: "var(--surface-4)",
      }}
    >
      {/* Context header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--surface-6)]">
        {aiRing}
        <span className="truncate text-xs-ui font-semibold text-[var(--text-primary)]">
          {workspace?.name ?? "Workspace"}
        </span>
        <span className="text-xs-ui text-[var(--text-muted)]">
          {docCount}
        </span>
        {selectedDoc && (
          <span className="truncate text-xs-ui text-[var(--accent-primary)]">
            · {t("chat.focus")}: {selectedDoc.title}
          </span>
        )}
        <span className="flex-1 min-w-0" />
        <button
          type="button"
          onClick={handleNewChat}
          className="text-xs-ui text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-0.5"
        >
          {t("chat.new_chat")}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs-ui text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-0.5"
        >
          {t("chat.minimize")}
        </button>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 scrollbar-hide">
        {hasEntries ? (
          conversation!.entries.map((entry, index) => {
            const isLast = index === conversation!.entries.length - 1;
            return (
              <NotebookEntry
                key={entry.id}
                query={entry.query}
                response={entry.response}
                sourceCount={entry.sourceCount}
                sources={entry.sources}
                errorMessage={entry.errorMessage}
                isStreaming={isLast && isStreaming}
                streamingText={isLast && isStreaming ? conversation!.streamingText : undefined}
              />
            );
          })
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm-ui text-[var(--text-muted)]">
              {t("chat.empty_prompt").replace("{count}", String(docCount))}
            </p>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-[var(--surface-6)] px-3 py-2">
        <NotebookInput
          placeholder={t("chat.followup_placeholder")}
          disabled={isStreaming}
          onSubmit={sendMessage}
        />
      </div>
    </div>
  );
}
