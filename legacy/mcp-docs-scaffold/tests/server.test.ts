import { describe, expect, it } from "vitest";

import {
  createCompareDocumentsHandler,
  createCorpusFromFiles,
  createFetchHandler,
  createFindActionItemsHandler,
  createFindRisksHandler,
  createGetDocumentMetadataHandler,
  createGetProjectOverviewHandler,
  createGetRelatedDocumentsHandler,
  createListDocumentsHandler,
  createSearchHandler,
} from "../src/lib/documents.js";

describe("search tool", () => {
  it("returns one JSON text content item with canonical URLs", async () => {
    const corpus = await createCorpusFromFiles(process.cwd(), [
      "agentic-docs-design-spec.md",
      "agentic-docs-handler-blueprint-v4.md",
    ]);

    const result = await createSearchHandler(corpus)({ query: "LanceDB" });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });

    const payload = JSON.parse(result.content[0].text);

    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        url: expect.stringMatching(/^file:\/\//),
      })
    );
  });
});

describe("fetch tool", () => {
  it("returns one JSON text content item with the full document text", async () => {
    const corpus = await createCorpusFromFiles(process.cwd(), [
      "agentic-docs-design-spec.md",
      "agentic-docs-handler-blueprint-v4.md",
    ]);

    const searchResult = await createSearchHandler(corpus)({ query: "Whisper" });
    const searchPayload = JSON.parse(searchResult.content[0].text) as {
      results: Array<{ id: string }>;
    };

    const result = await createFetchHandler(corpus)({
      id: searchPayload.results[0].id,
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });

    const payload = JSON.parse(result.content[0].text);

    expect(payload).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        text: expect.stringContaining("Whisper"),
        url: expect.stringMatching(/^file:\/\//),
      })
    );
  });
});

describe("list_documents tool", () => {
  it("returns all indexed documents with basic metadata", async () => {
    const corpus = await createCorpusFromFiles(process.cwd(), [
      "agentic-docs-design-spec.md",
      "agentic-docs-handler-blueprint-v4.md",
    ]);

    const result = await createListDocumentsHandler(corpus)({});
    const payload = JSON.parse(result.content[0].text) as {
      documents: Array<{ id: string; title: string; wordCount: number }>;
    };

    expect(payload.documents).toHaveLength(2);
    expect(payload.documents[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        wordCount: expect.any(Number),
      })
    );
  });
});

describe("get_document_metadata tool", () => {
  it("returns structural metadata for one document", async () => {
    const corpus = await createCorpusFromFiles(process.cwd(), [
      "agentic-docs-design-spec.md",
      "agentic-docs-handler-blueprint-v4.md",
    ]);

    const result = await createGetDocumentMetadataHandler(corpus)({
      id: "agentic-docs-design-spec.md",
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toEqual(
      expect.objectContaining({
        id: "agentic-docs-design-spec.md",
        title: expect.any(String),
        wordCount: expect.any(Number),
        headings: expect.arrayContaining([expect.any(String)]),
        metadata: expect.objectContaining({
          filename: "agentic-docs-design-spec.md",
        }),
      })
    );
  });
});

describe("get_project_overview tool", () => {
  it("returns corpus-level summary information", async () => {
    const corpus = await createCorpusFromFiles(process.cwd(), [
      "agentic-docs-design-spec.md",
      "agentic-docs-handler-blueprint-v4.md",
    ]);

    const result = await createGetProjectOverviewHandler(corpus)({});
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toEqual(
      expect.objectContaining({
        documentCount: 2,
        topKeywords: expect.arrayContaining([expect.any(String)]),
        documents: expect.arrayContaining([
          expect.objectContaining({ id: expect.any(String), title: expect.any(String) }),
        ]),
      })
    );
  });
});

describe("get_related_documents tool", () => {
  it("returns related documents based on token overlap", async () => {
    const corpus = await createCorpusFromFiles(process.cwd(), [
      "agentic-docs-design-spec.md",
      "agentic-docs-handler-blueprint-v4.md",
    ]);

    const result = await createGetRelatedDocumentsHandler(corpus)({
      id: "agentic-docs-design-spec.md",
      limit: 5,
    });
    const payload = JSON.parse(result.content[0].text) as {
      documents: Array<{ id: string; score: number }>;
    };

    expect(payload.documents).toHaveLength(1);
    expect(payload.documents[0]).toEqual(
      expect.objectContaining({
        id: "agentic-docs-handler-blueprint-v4.md",
        score: expect.any(Number),
      })
    );
  });
});

describe("compare_documents tool", () => {
  it("returns shared and unique themes for two documents", async () => {
    const corpus = await createCorpusFromFiles(process.cwd(), [
      "agentic-docs-design-spec.md",
      "agentic-docs-handler-blueprint-v4.md",
    ]);

    const result = await createCompareDocumentsHandler(corpus)({
      firstId: "agentic-docs-design-spec.md",
      secondId: "agentic-docs-handler-blueprint-v4.md",
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toEqual(
      expect.objectContaining({
        first: expect.objectContaining({ id: "agentic-docs-design-spec.md" }),
        second: expect.objectContaining({ id: "agentic-docs-handler-blueprint-v4.md" }),
        sharedKeywords: expect.arrayContaining([expect.any(String)]),
      })
    );
  });
});

describe("find_action_items tool", () => {
  it("extracts action-oriented lines from a document", async () => {
    const corpus = await createCorpusFromFiles(process.cwd(), [
      "agentic-docs-design-spec.md",
      "agentic-docs-handler-blueprint-v4.md",
    ]);

    const result = await createFindActionItemsHandler(corpus)({
      id: "agentic-docs-handler-blueprint-v4.md",
    });
    const payload = JSON.parse(result.content[0].text) as {
      actionItems: Array<{ text: string }>;
    };

    expect(payload.actionItems.length).toBeGreaterThan(0);
    expect(payload.actionItems[0]).toEqual(
      expect.objectContaining({
        text: expect.any(String),
      })
    );
  });
});

describe("find_risks tool", () => {
  it("extracts risk statements from a document", async () => {
    const corpus = await createCorpusFromFiles(process.cwd(), [
      "agentic-docs-design-spec.md",
      "agentic-docs-handler-blueprint-v4.md",
    ]);

    const result = await createFindRisksHandler(corpus)({
      id: "agentic-docs-handler-blueprint-v4.md",
    });
    const payload = JSON.parse(result.content[0].text) as {
      risks: Array<{ text: string }>;
    };

    expect(payload.risks.length).toBeGreaterThan(0);
    expect(payload.risks[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("risk"),
      })
    );
  });
});
