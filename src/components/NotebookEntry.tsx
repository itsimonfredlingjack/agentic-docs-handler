import Markdown from "react-markdown";

type Props = {
  query: string;
  response: string;
  sourceCount: number;
  errorMessage: string | null;
  isStreaming?: boolean;
  streamingText?: string;
};

export function NotebookEntry({ query, response, sourceCount, errorMessage, isStreaming, streamingText }: Props) {
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

      {/* Source count */}
      {!isStreaming && response && sourceCount > 0 && (
        <p className="notebook-entry__sources">
          {sourceCount} dokument analyserade
        </p>
      )}

      {/* Error */}
      {!isStreaming && errorMessage && (
        <div className="notebook-entry__ai notebook-entry__ai--error">
          <p className="text-sm text-[rgb(253,230,138)]">{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
