import { useCallback } from "react";
import { useDocumentStore } from "../store/documentStore";
import { streamWorkspaceChat } from "../lib/api";

export function useWorkspaceChat() {
  const activeWorkspace = useDocumentStore((s) => s.activeWorkspace);
  const conversations = useDocumentStore((s) => s.conversations);
  const startQuery = useDocumentStore((s) => s.startWorkspaceQuery);
  const appendToken = useDocumentStore((s) => s.appendStreamingToken);
  const finalize = useDocumentStore((s) => s.finalizeStreamingEntry);

  const conversation = activeWorkspace ? conversations[activeWorkspace] : undefined;
  const isStreaming = conversation?.isStreaming ?? false;

  const sendMessage = useCallback(
    async (message: string) => {
      const currentConv = activeWorkspace ? useDocumentStore.getState().conversations[activeWorkspace] : undefined;
      if (!activeWorkspace || currentConv?.isStreaming) return;

      startQuery(activeWorkspace, message);

      // Build history from previous entries (before the one we just added)
      const conv = useDocumentStore.getState().conversations[activeWorkspace];
      const history: Array<{ role: string; content: string }> = [];
      if (conv) {
        for (const entry of conv.entries.slice(0, -1)) {
          if (entry.query) history.push({ role: "user", content: entry.query });
          if (entry.response) history.push({ role: "assistant", content: entry.response });
        }
      }

      let sourceCount = 0;
      let errorMessage: string | null = null;
      try {
        for await (const event of streamWorkspaceChat(activeWorkspace, message, history)) {
          if (event.type === "context") {
            sourceCount = event.data.source_count;
          } else if (event.type === "token") {
            appendToken(activeWorkspace, event.data.text);
          } else if (event.type === "error") {
            errorMessage = event.data.error || "Okänt fel";
            break;
          }
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "Anslutningsfel";
      }
      finalize(activeWorkspace, sourceCount, errorMessage);
    },
    [activeWorkspace, startQuery, appendToken, finalize],
  );

  return { conversation, isStreaming, sendMessage };
}
