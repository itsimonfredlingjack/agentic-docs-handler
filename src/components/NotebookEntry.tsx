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
  const entryClassName = hasError ? "notebook-entry notebook-entry--error" : "notebook-entry";
  const responseClassName = hasError
    ? "notebook-entry__response notebook-prose notebook-entry__response--error"
    : "notebook-entry__response notebook-prose";

  return (
    <div className={entryClassName}>
      {query && (
        <p className="notebook-entry__query">
          <span className="text-[var(--text-muted)]">{"\u25B8"}</span> {query}
        </p>
      )}
      {displayText && (
        <div className={responseClassName}>
          <Markdown>{displayText}</Markdown>
          {isStreaming && <span className="notebook-cursor">{"\u2588"}</span>}
        </div>
      )}
      {!isStreaming && response && sourceCount > 0 && (
        <p className="notebook-entry__sources">
          K\u00E4lla: {sourceCount} dokument analyserade
        </p>
      )}
      {!isStreaming && errorMessage && (
        <p className="notebook-entry__error">
          <span className="notebook-entry__error-badge">{"\u26A0"} Fel</span> {errorMessage}
        </p>
      )}
    </div>
  );
}
