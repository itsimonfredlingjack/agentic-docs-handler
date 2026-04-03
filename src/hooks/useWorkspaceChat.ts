import { useCallback, useEffect, useRef } from "react";
import { useDocumentStore } from "../store/documentStore";
import { streamWorkspaceChat } from "../lib/api";
import { useWorkspaceStore } from "../store/workspaceStore";

export function useWorkspaceChat() {
  const activeDocumentChat = useDocumentStore((s) => s.activeDocumentChat);
  const documents = useDocumentStore((s) => s.documents);
  const conversations = useDocumentStore((s) => s.conversations);
  const startQuery = useDocumentStore((s) => s.startWorkspaceQuery);
  const appendToken = useDocumentStore((s) => s.appendStreamingToken);
  const finalize = useDocumentStore((s) => s.finalizeStreamingEntry);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const abortRef = useRef<AbortController | null>(null);

  const chatDocument = activeDocumentChat ? documents[activeDocumentChat] : null;
  const isDocumentMode = activeDocumentChat !== null;
  const conversationKey = isDocumentMode
    ? `doc:${activeDocumentChat}`
    : activeWorkspaceId;
  const category = chatDocument?.kind;
  const workspaceId = activeWorkspaceId ?? undefined;

  const conversation = conversationKey ? conversations[conversationKey] : undefined;
  const isStreaming = conversation?.isStreaming ?? false;

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
        const docId = useDocumentStore.getState().activeDocumentChat;
        for await (const event of streamWorkspaceChat(category, message, history, {
          signal: controller.signal,
          document_id: docId ?? undefined,
          workspace_id: workspaceId,
        })) {
          if (event.type === "context") {
            sourceCount = event.data.source_count;
            sources = event.data.sources ?? [];
          } else if (event.type === "token") {
            appendToken(conversationKey, event.data.text);
            tokenCount++;
          } else if (event.type === "error") {
            console.error("workspace.chat.failed", event.data.error);
            errorMessage = event.data.error || "Okänt fel";
            break;
          }
        }
        // Handle empty response from LLM
        if (!errorMessage && tokenCount === 0) {
          errorMessage = "Inget svar från AI-motorn";
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // Stream was intentionally cancelled — finalize silently
          finalize(conversationKey, sourceCount, sources, null);
          return;
        }
        errorMessage = error instanceof Error ? error.message : "Anslutningsfel";
      }
      finalize(conversationKey, sourceCount, sources, errorMessage);
    },
    [conversationKey, category, workspaceId, startQuery, appendToken, finalize],
  );

  return { conversation, isStreaming, sendMessage, chatDocument };
}
