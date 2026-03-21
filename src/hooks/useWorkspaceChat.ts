import { useCallback, useEffect, useRef } from "react";
import { useDocumentStore } from "../store/documentStore";
import { streamWorkspaceChat } from "../lib/api";

export function useWorkspaceChat() {
  const activeWorkspace = useDocumentStore((s) => s.activeWorkspace);
  const activeDocumentChat = useDocumentStore((s) => s.activeDocumentChat);
  const documents = useDocumentStore((s) => s.documents);
  const conversations = useDocumentStore((s) => s.conversations);
  const startQuery = useDocumentStore((s) => s.startWorkspaceQuery);
  const appendToken = useDocumentStore((s) => s.appendStreamingToken);
  const finalize = useDocumentStore((s) => s.finalizeStreamingEntry);

  const abortRef = useRef<AbortController | null>(null);

  // Derive conversation key: category name for category chat, "doc:{id}" for document chat
  const chatDocument = activeDocumentChat ? documents[activeDocumentChat] : null;
  const conversationKey = activeWorkspace ?? (activeDocumentChat ? `doc:${activeDocumentChat}` : null);
  const category = activeWorkspace ?? chatDocument?.kind ?? "generic";

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
      let errorMessage: string | null = null;
      let tokenCount = 0;
      try {
        const docId = useDocumentStore.getState().activeDocumentChat;
        for await (const event of streamWorkspaceChat(category, message, history, {
          signal: controller.signal,
          document_id: docId ?? undefined,
        })) {
          if (event.type === "context") {
            sourceCount = event.data.source_count;
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
          finalize(conversationKey, sourceCount, null);
          return;
        }
        errorMessage = error instanceof Error ? error.message : "Anslutningsfel";
      }
      finalize(conversationKey, sourceCount, errorMessage);
    },
    [conversationKey, category, startQuery, appendToken, finalize],
  );

  return { conversation, isStreaming, sendMessage, chatDocument };
}
