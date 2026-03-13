import type { ReactNode } from "react";

/**
 * Split a snippet into fragments, wrapping substrings that match any query
 * token in a highlighted span using the document's type color.
 */
export function highlightSnippet(snippet: string, query: string): ReactNode[] {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return [snippet];
  }

  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Capturing group — split keeps the matched separators in the array
  const parts = snippet.split(new RegExp(`(${escaped.join("|")})`, "gi"));

  // Non-global regex for testing whether a part is a keyword match
  const isMatch = new RegExp(`^(?:${escaped.join("|")})$`, "i");

  return parts
    .filter((part) => part.length > 0)
    .map((part, i) =>
      isMatch.test(part) ? (
        <span
          key={i}
          className="font-mono text-[var(--type-color)] bg-white/5 px-1 rounded"
        >
          {part}
        </span>
      ) : (
        part
      ),
    );
}
