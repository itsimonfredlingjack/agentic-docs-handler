import { memo } from "react";
import Markdown from "react-markdown";
import { useDocumentStore } from "../store/documentStore";

type Props = {
  query: string;
  response: string;
  sourceCount: number;
  sources: Array<{ id: string; title: string }>;
  errorMessage: string | null;
  isStreaming?: boolean;
  streamingText?: string;
};

export const NotebookEntry = memo(function NotebookEntry({ query, response, sourceCount, sources, errorMessage, isStreaming, streamingText }: Props) {
  const setSelectedDocument = useDocumentStore((s) => s.setSelectedDocument);
  const displayText = isStreaming ? streamingText ?? "" : response;
  const hasError = !isStreaming && Boolean(errorMessage);

  return (
    <div className="notebook-entry">
      {/* User message */}
      {query && (
        <div className="notebook-entry__user">
          <p className="notebook-entry__user-text">{query}</p>
        </div>
      )}

      {/* AI thinking indicator */}
      {isStreaming && !displayText && (
        <div className="notebook-entry__ai">
          <div className="notebook-entry__thinking">
            <span className="notebook-thinking-dot" />
            <span className="notebook-thinking-dot" />
            <span className="notebook-thinking-dot" />
          </div>
        </div>
      )}

      {/* AI response */}
      {displayText && (
        <div className={`notebook-entry__ai ${hasError ? "notebook-entry__ai--error" : ""}`}>
          <div className="notebook-prose">
            <Markdown>{displayText}</Markdown>
            {isStreaming && <span className="notebook-cursor">{"\u2588"}</span>}
          </div>
        </div>
      )}

      {/* Source attribution */}
      {!isStreaming && response && (
        sources && sources.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {sources.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => setSelectedDocument(source.id)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs-ui rounded-[var(--badge-radius)] bg-[var(--surface-4)] text-[var(--text-secondary)] hover:bg-[var(--surface-8)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <span className="text-[var(--accent-primary)]">⟵</span>
                {source.title}
              </button>
            ))}
          </div>
        ) : sourceCount > 0 ? (
          <p className="notebook-entry__sources">
            {sourceCount} dokument analyserade
          </p>
        ) : null
      )}

      {/* Error */}
      {!isStreaming && errorMessage && (
        <div className="notebook-entry__ai notebook-entry__ai--error">
          <p className="text-sm text-[rgb(253,230,138)]">{errorMessage}</p>
        </div>
      )}
    </div>
  );
});
