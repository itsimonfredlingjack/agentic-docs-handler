import { useCallback, useEffect, useRef } from "react";
import { useDocumentStore } from "../store/documentStore";
import { fetchConversation, saveConversationEntry, streamWorkspaceChat } from "../lib/api";
import { useWorkspaceStore } from "../store/workspaceStore";
import { t } from "../lib/locale";

export function useWorkspaceChat() {
  const conversations = useDocumentStore((s) => s.conversations);
  const startQuery = useDocumentStore((s) => s.startWorkspaceQuery);
  const appendToken = useDocumentStore((s) => s.appendStreamingToken);
  const finalize = useDocumentStore((s) => s.finalizeStreamingEntry);
  const hydrate = useDocumentStore((s) => s.hydrateConversation);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const selectedDocumentId = useDocumentStore((s) => s.selectedDocumentId);

  const abortRef = useRef<AbortController | null>(null);

  const conversationKey = activeWorkspaceId;
  const workspaceId = activeWorkspaceId ?? undefined;

  const conversation = conversationKey ? conversations[conversationKey] : undefined;
  const isStreaming = conversation?.isStreaming ?? false;

  // Hydrate persisted conversation when context activates
  useEffect(() => {
    if (!conversationKey) return;
    const existing = useDocumentStore.getState().conversations[conversationKey];
    if (existing && existing.entries.length > 0) return;

    let cancelled = false;
    fetchConversation(conversationKey)
      .then((data) => {
        if (cancelled || !data.entries.length) return;
        hydrate(conversationKey, data.entries.map((e) => ({
          id: e.id,
          query: e.query,
          response: e.response,
          timestamp: e.timestamp,
          sourceCount: e.sourceCount,
          sources: e.sources,
          errorMessage: e.errorMessage,
        })));
      })
      .catch(() => {
        // Hydration failure is non-fatal — conversation starts empty
      });
    return () => { cancelled = true; };
  }, [conversationKey, hydrate]);

  // Abort any in-flight stream when chat context changes or component unmounts
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [conversationKey]);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!conversationKey) return;
      const currentConv = useDocumentStore.getState().conversations[conversationKey];
      if (currentConv?.isStreaming) return;

      // Abort any previous stream before starting a new one
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      startQuery(conversationKey, message);

      // Build history from previous entries (before the one we just added)
      const conv = useDocumentStore.getState().conversations[conversationKey];
      const history: Array<{ role: string; content: string }> = [];
      if (conv) {
        for (const entry of conv.entries.slice(0, -1)) {
          if (entry.query) history.push({ role: "user", content: entry.query });
          if (entry.response) history.push({ role: "assistant", content: entry.response });
        }
      }

      let sourceCount = 0;
      let sources: Array<{ id: string; title: string }> = [];
      let errorMessage: string | null = null;
      let tokenCount = 0;
      try {
        for await (const event of streamWorkspaceChat(undefined, message, history, {
          signal: controller.signal,
          workspace_id: workspaceId,
          ...(selectedDocumentId ? { document_id: selectedDocumentId } : {}),
        })) {
          if (event.type === "context") {
            sourceCount = event.data.source_count;
            sources = event.data.sources ?? [];
          } else if (event.type === "token") {
            appendToken(conversationKey, event.data.text);
            tokenCount++;
          } else if (event.type === "error") {
            console.error("workspace.chat.failed", event.data.error);
            errorMessage = event.data.error || t("chat.unknown_error");
            break;
          }
        }
        // Handle empty response from LLM
        if (!errorMessage && tokenCount === 0) {
          errorMessage = t("chat.empty_response");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // Stream was intentionally cancelled — finalize silently
          finalize(conversationKey, sourceCount, sources, null);
          return;
        }
        errorMessage = error instanceof Error ? error.message : t("chat.connection_error");
      }
      finalize(conversationKey, sourceCount, sources, errorMessage);

      // Persist the finalized entry to the backend
      const finalConv = useDocumentStore.getState().conversations[conversationKey];
      if (finalConv && finalConv.entries.length > 0) {
        const lastEntry = finalConv.entries[finalConv.entries.length - 1];
        saveConversationEntry(conversationKey, {
          query: lastEntry.query,
          response: lastEntry.response,
          sourceCount: lastEntry.sourceCount,
          sources: lastEntry.sources,
          errorMessage: lastEntry.errorMessage,
        }).catch(() => {
          // Persistence failure is non-fatal — entry remains in memory
        });
      }
    },
    [conversationKey, workspaceId, selectedDocumentId, startQuery, appendToken, finalize],
  );

  return { conversation, isStreaming, sendMessage, conversationKey, selectedDocumentId };
}
