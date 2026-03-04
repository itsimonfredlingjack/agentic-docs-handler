import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

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
  type DocumentCorpus,
} from "./lib/documents.js";

const DEFAULT_PORT = 8787;
const MCP_PATH = "/mcp";

const searchInputSchema = {
  query: z.string().min(1),
};

const fetchInputSchema = {
  id: z.string().min(1),
};

const listDocumentsInputSchema = {
  limit: z.number().int().min(1).max(100).optional(),
};

const relatedDocumentsInputSchema = {
  id: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
};

const compareDocumentsInputSchema = {
  firstId: z.string().min(1),
  secondId: z.string().min(1),
};

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
} as const;

const setCorsHeaders = (response: ServerResponse): void => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
  response.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
};

export const createDocsMcpServer = (corpus: DocumentCorpus): McpServer => {
  const server = new McpServer({
    name: "agentic-docs-handler",
    version: "0.1.0",
  });

  server.registerTool(
    "search",
    {
      title: "Search indexed documents",
      description:
        "Use this when you need to search the indexed document corpus for relevant documents before reading one in full.",
      inputSchema: searchInputSchema,
      annotations: readOnlyAnnotations,
    },
    createSearchHandler(corpus)
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch a document",
      description:
        "Use this when you already have a document id from search and need its full text and canonical URL.",
      inputSchema: fetchInputSchema,
      annotations: readOnlyAnnotations,
    },
    createFetchHandler(corpus)
  );

  server.registerTool(
    "list_documents",
    {
      title: "List indexed documents",
      description:
        "Use this when you need a compact inventory of the indexed documents before deciding which one to inspect further.",
      inputSchema: listDocumentsInputSchema,
      annotations: readOnlyAnnotations,
    },
    createListDocumentsHandler(corpus)
  );

  server.registerTool(
    "get_document_metadata",
    {
      title: "Get document metadata",
      description:
        "Use this when you already know a document id and need headings, keywords, counts, and file metadata without reading the full text.",
      inputSchema: fetchInputSchema,
      annotations: readOnlyAnnotations,
    },
    createGetDocumentMetadataHandler(corpus)
  );

  server.registerTool(
    "get_project_overview",
    {
      title: "Get project overview",
      description:
        "Use this when you need a high-level view of the indexed corpus, including major themes and document coverage.",
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    createGetProjectOverviewHandler(corpus)
  );

  server.registerTool(
    "get_related_documents",
    {
      title: "Get related documents",
      description:
        "Use this when you have one document id and want to discover nearby documents based on shared themes and keywords.",
      inputSchema: relatedDocumentsInputSchema,
      annotations: readOnlyAnnotations,
    },
    createGetRelatedDocumentsHandler(corpus)
  );

  server.registerTool(
    "compare_documents",
    {
      title: "Compare documents",
      description:
        "Use this when you need a direct comparison between two documents, including shared themes and unique focus areas.",
      inputSchema: compareDocumentsInputSchema,
      annotations: readOnlyAnnotations,
    },
    createCompareDocumentsHandler(corpus)
  );

  server.registerTool(
    "find_action_items",
    {
      title: "Find action items",
      description:
        "Use this when you need action-oriented lines, implementation steps, or recommended follow-up work from one document.",
      inputSchema: fetchInputSchema,
      annotations: readOnlyAnnotations,
    },
    createFindActionItemsHandler(corpus)
  );

  server.registerTool(
    "find_risks",
    {
      title: "Find risks",
      description:
        "Use this when you need risk statements, fallback notes, or instability warnings extracted from one document.",
      inputSchema: fetchInputSchema,
      annotations: readOnlyAnnotations,
    },
    createFindRisksHandler(corpus)
  );

  return server;
};

const handleMcpRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  corpus: DocumentCorpus
): Promise<void> => {
  const server = createDocsMcpServer(corpus);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  response.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    console.error("MCP request failed", error);
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end("Internal server error");
  }
};

export const createHttpApp = (corpus: DocumentCorpus) =>
  createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`
    );

    if (request.method === "OPTIONS" && requestUrl.pathname === MCP_PATH) {
      setCorsHeaders(response);
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          name: "agentic-docs-handler",
          status: "ok",
          mcpPath: MCP_PATH,
          indexedDocuments: corpus.documents.length,
        })
      );
      return;
    }

    if (
      requestUrl.pathname === MCP_PATH &&
      request.method !== undefined &&
      ["GET", "POST", "DELETE"].includes(request.method)
    ) {
      setCorsHeaders(response);
      await handleMcpRequest(request, response, corpus);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  });

const start = async (): Promise<void> => {
  const corpus = await createCorpusFromFiles(process.cwd(), [
    "agentic-docs-design-spec.md",
    "agentic-docs-handler-blueprint-v4.md",
  ]);

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const httpServer = createHttpApp(corpus);

  httpServer.listen(port, () => {
    console.log(`agentic-docs-handler listening on http://localhost:${port}${MCP_PATH}`);
  });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  void start();
}
