type Props = {
  query: string;
  response: string;
  sourceCount: number;
  isStreaming?: boolean;
  streamingText?: string;
};

export function NotebookEntry({ query, response, sourceCount, isStreaming, streamingText }: Props) {
  const displayText = isStreaming ? streamingText ?? "" : response;

  return (
    <div className="notebook-entry">
      {query && (
        <p className="notebook-entry__query">
          <span className="text-[var(--text-muted)]">{"\u25B8"}</span> {query}
        </p>
      )}
      {displayText && (
        <div className="notebook-entry__response">
          <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)] leading-relaxed">
            {displayText}
            {isStreaming && <span className="notebook-cursor">{"\u2588"}</span>}
          </p>
        </div>
      )}
      {!isStreaming && response && sourceCount > 0 && (
        <p className="notebook-entry__sources">
          K\u00E4lla: {sourceCount} dokument analyserade
        </p>
      )}
    </div>
  );
}
