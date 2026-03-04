import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type DocumentRecord = {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: {
    filename: string;
    absolutePath: string;
  };
};

type ListDocumentsArgs = {
  limit?: number;
};

type SearchArgs = {
  query: string;
};

type FetchArgs = {
  id: string;
};

type RelatedDocumentsArgs = {
  id: string;
  limit?: number;
};

type CompareDocumentsArgs = {
  firstId: string;
  secondId: string;
};

type TextContent = {
  type: "text";
  text: string;
};

type ToolResult = {
  content: [TextContent];
};

export type DocumentCorpus = {
  documents: DocumentRecord[];
  byId: Map<string, DocumentRecord>;
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "are",
  "det",
  "och",
  "att",
  "som",
  "den",
  "med",
  "för",
  "var",
  "vad",
  "hur",
  "ska",
  "till",
  "via",
  "inte",
  "eller",
  "alla",
  "their",
  "your",
  "into",
  "will",
  "when",
  "only",
  "then",
  "they",
  "you",
  "can",
  "use",
  "app",
  "apps",
  "tool",
  "tools",
  "server",
  "docs",
  "sdk",
]);

const ACTION_PATTERNS = [
  /\binstall/i,
  /\btesta\b/i,
  /\bsetup\b/i,
  /\bverifiera\b/i,
  /\bbuild\b/i,
  /\bskapa\b/i,
  /\blägg till\b/i,
  /\bimplementera\b/i,
  /\bdeploy\b/i,
  /\bconfigure\b/i,
  /\brun\b/i,
];

const RISK_PATTERNS = [
  /\brisk\b/i,
  /\bfallback\b/i,
  /\bkritisk/i,
  /\bcritical\b/i,
  /\berror\b/i,
  /\bproblem\b/i,
  /\bwarning\b/i,
  /\bopålit/i,
  /\binstabil/i,
  /\brejected?\b/i,
];

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");

const tokenize = (value: string): string[] =>
  normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 1);

const createSearchText = (document: DocumentRecord): string =>
  `${document.title}\n${document.text}`;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const scoreDocument = (document: DocumentRecord, queryTokens: string[]): number => {
  const haystack = normalize(createSearchText(document));

  return queryTokens.reduce((score, token) => {
    const matches = haystack.match(new RegExp(escapeRegExp(token), "g"));
    return score + (matches?.length ?? 0);
  }, 0);
};

const countWords = (text: string): number => tokenize(text).length;

const extractHeadings = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^#+\s+/.test(line))
    .map((line) => line.replace(/^#+\s+/, ""));

const keywordCountsForText = (text: string): Map<string, number> => {
  const counts = new Map<string, number>();

  for (const token of tokenize(text)) {
    if (STOP_WORDS.has(token) || token.length < 3) {
      continue;
    }

    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return counts;
};

const topKeywordsFromCounts = (counts: Map<string, number>, limit: number): string[] =>
  [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([token]) => token);

const topKeywordsForText = (text: string, limit = 10): string[] =>
  topKeywordsFromCounts(keywordCountsForText(text), limit);

const documentSummary = (document: DocumentRecord) => ({
  id: document.id,
  title: document.title,
  url: document.url,
  wordCount: countWords(document.text),
  headings: extractHeadings(document.text).slice(0, 8),
  keywords: topKeywordsForText(document.text, 8),
});

const getDocumentOrThrow = (corpus: DocumentCorpus, id: string): DocumentRecord => {
  const document = corpus.byId.get(id);

  if (!document) {
    throw new Error(`Document not found: ${id}`);
  }

  return document;
};

const contentLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const uniqueLines = (lines: string[]): string[] => [...new Set(lines)];

const topIntersectionKeywords = (
  firstCounts: Map<string, number>,
  secondCounts: Map<string, number>,
  limit: number
): string[] =>
  [...firstCounts.entries()]
    .filter(([token]) => secondCounts.has(token))
    .map(([token, count]) => ({
      token,
      score: count + (secondCounts.get(token) ?? 0),
    }))
    .sort((left, right) => right.score - left.score || left.token.localeCompare(right.token))
    .slice(0, limit)
    .map(({ token }) => token);

const exclusiveKeywords = (
  ownCounts: Map<string, number>,
  otherCounts: Map<string, number>,
  limit: number
): string[] =>
  [...ownCounts.entries()]
    .filter(([token]) => !otherCounts.has(token))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([token]) => token);

const matchingLines = (text: string, patterns: RegExp[]): string[] =>
  uniqueLines(
    contentLines(text)
      .filter((line) => line.length >= 12)
      .filter((line) => patterns.some((pattern) => pattern.test(line)))
  );

const jsonTextResult = (payload: unknown): ToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(payload),
    },
  ],
});

export const createCorpusFromFiles = async (
  rootDir: string,
  relativePaths: string[]
): Promise<DocumentCorpus> => {
  const documents = await Promise.all(
    relativePaths.map(async (relativePath) => {
      const absolutePath = path.resolve(rootDir, relativePath);
      const text = await readFile(absolutePath, "utf8");
      const filename = path.basename(relativePath);

      return {
        id: relativePath,
        title: filename.replace(/[-_]/g, " ").replace(/\.md$/i, ""),
        text,
        url: pathToFileURL(absolutePath).toString(),
        metadata: {
          filename,
          absolutePath,
        },
      } satisfies DocumentRecord;
    })
  );

  return {
    documents,
    byId: new Map(documents.map((document) => [document.id, document])),
  };
};

export const createSearchHandler =
  (corpus: DocumentCorpus) =>
  async ({ query }: SearchArgs): Promise<ToolResult> => {
    const queryTokens = tokenize(query);

    const results = corpus.documents
      .map((document) => ({
        document,
        score: scoreDocument(document, queryTokens),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)
      .map(({ document }) => ({
        id: document.id,
        title: document.title,
        url: document.url,
      }));

    return jsonTextResult({ results });
  };

export const createFetchHandler =
  (corpus: DocumentCorpus) =>
  async ({ id }: FetchArgs): Promise<ToolResult> => {
    const document = corpus.byId.get(id);

    if (!document) {
      return jsonTextResult({
        id,
        title: "Not found",
        text: "",
        url: "",
        metadata: {
          error: "Document not found",
        },
      });
    }

    return jsonTextResult({
      id: document.id,
      title: document.title,
      text: document.text,
      url: document.url,
      metadata: document.metadata,
    });
  };

export const createListDocumentsHandler =
  (corpus: DocumentCorpus) =>
  async ({ limit = 20 }: ListDocumentsArgs): Promise<ToolResult> =>
    jsonTextResult({
      documents: corpus.documents.slice(0, limit).map((document) => documentSummary(document)),
    });

export const createGetDocumentMetadataHandler =
  (corpus: DocumentCorpus) =>
  async ({ id }: FetchArgs): Promise<ToolResult> => {
    const document = getDocumentOrThrow(corpus, id);

    return jsonTextResult({
      ...documentSummary(document),
      metadata: document.metadata,
    });
  };

export const createGetProjectOverviewHandler =
  (corpus: DocumentCorpus) =>
  async (): Promise<ToolResult> => {
    const corpusText = corpus.documents.map((document) => document.text).join("\n");
    const headings = corpus.documents.flatMap((document) => extractHeadings(document.text));

    return jsonTextResult({
      documentCount: corpus.documents.length,
      totalWordCount: countWords(corpusText),
      topKeywords: topKeywordsForText(corpusText, 12),
      headings: headings.slice(0, 12),
      documents: corpus.documents.map((document) => documentSummary(document)),
    });
  };

export const createGetRelatedDocumentsHandler =
  (corpus: DocumentCorpus) =>
  async ({ id, limit = 5 }: RelatedDocumentsArgs): Promise<ToolResult> => {
    const source = getDocumentOrThrow(corpus, id);
    const sourceCounts = keywordCountsForText(source.text);

    const documents = corpus.documents
      .filter((document) => document.id !== id)
      .map((document) => {
        const targetCounts = keywordCountsForText(document.text);
        const sharedKeywords = topIntersectionKeywords(sourceCounts, targetCounts, 6);

        return {
          id: document.id,
          title: document.title,
          url: document.url,
          score: sharedKeywords.length,
          sharedKeywords,
        };
      })
      .filter((document) => document.score > 0)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, limit);

    return jsonTextResult({
      sourceId: id,
      documents,
    });
  };

export const createCompareDocumentsHandler =
  (corpus: DocumentCorpus) =>
  async ({ firstId, secondId }: CompareDocumentsArgs): Promise<ToolResult> => {
    const first = getDocumentOrThrow(corpus, firstId);
    const second = getDocumentOrThrow(corpus, secondId);
    const firstCounts = keywordCountsForText(first.text);
    const secondCounts = keywordCountsForText(second.text);

    return jsonTextResult({
      first: documentSummary(first),
      second: documentSummary(second),
      sharedKeywords: topIntersectionKeywords(firstCounts, secondCounts, 10),
      firstOnlyKeywords: exclusiveKeywords(firstCounts, secondCounts, 8),
      secondOnlyKeywords: exclusiveKeywords(secondCounts, firstCounts, 8),
      sharedHeadings: extractHeadings(first.text).filter((heading) =>
        extractHeadings(second.text).includes(heading)
      ),
    });
  };

export const createFindActionItemsHandler =
  (corpus: DocumentCorpus) =>
  async ({ id }: FetchArgs): Promise<ToolResult> => {
    const document = getDocumentOrThrow(corpus, id);
    const actionItems = matchingLines(document.text, ACTION_PATTERNS).slice(0, 20);

    return jsonTextResult({
      id,
      actionItems: actionItems.map((text, index) => ({
        id: `${id}:action:${index + 1}`,
        text,
      })),
    });
  };

export const createFindRisksHandler =
  (corpus: DocumentCorpus) =>
  async ({ id }: FetchArgs): Promise<ToolResult> => {
    const document = getDocumentOrThrow(corpus, id);
    const risks = matchingLines(document.text, RISK_PATTERNS).slice(0, 20);

    return jsonTextResult({
      id,
      risks: risks.map((text, index) => ({
        id: `${id}:risk:${index + 1}`,
        text: `risk: ${text}`,
      })),
    });
  };
