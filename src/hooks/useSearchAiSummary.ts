import { useCallback, useRef, useState } from "react";
import { streamWorkspaceChat } from "../lib/api";

type SummaryState = {
  status: "idle" | "streaming" | "done" | "error";
  text: string;
  errorMessage: string | null;
};

const IDLE: SummaryState = { status: "idle", text: "", errorMessage: null };

export function useSearchAiSummary() {
  const [state, setState] = useState<SummaryState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(async (query: string) => {
    // Abort any previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: "streaming", text: "", errorMessage: null });

    try {
      let text = "";
      let tokenCount = 0;
      for await (const event of streamWorkspaceChat("all", query, [], {
        signal: controller.signal,
      })) {
        if (event.type === "token") {
          text += event.data.text;
          tokenCount++;
          setState({ status: "streaming", text, errorMessage: null });
        } else if (event.type === "error") {
          setState({ status: "error", text: "", errorMessage: event.data.error || "Okänt fel" });
          return;
        }
      }
      if (tokenCount === 0) {
        setState({ status: "error", text: "", errorMessage: "Inget svar från AI-motorn" });
      } else {
        setState({ status: "done", text, errorMessage: null });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setState({
        status: "error",
        text: "",
        errorMessage: error instanceof Error ? error.message : "Anslutningsfel",
      });
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE);
  }, []);

  return { summary: state, askAi: ask, resetAiSummary: reset };
}
