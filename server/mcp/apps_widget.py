from __future__ import annotations

from textwrap import dedent

from mcp.server.fastmcp import FastMCP

WIDGET_RESOURCE_URI = "ui://widget/docs-search-v1.html"
WIDGET_RESOURCE_MIME = "text/html;profile=mcp-app"

WIDGET_RESOURCE_META: dict[str, object] = {
    "ui": {
        "prefersBorder": True,
        "csp": {
            "connectDomains": [],
            "resourceDomains": ["https://persistent.oaistatic.com"],
        },
    },
    "openai/widgetDescription": "Interactive search and fetch view for Agentic Docs Handler documents.",
    "openai/widgetPrefersBorder": True,
    "openai/widgetCSP": {
        "connect_domains": [],
        "resource_domains": ["https://persistent.oaistatic.com"],
    },
}


def build_docs_widget_html() -> str:
    return dedent(
        """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Agentic Docs Search</title>
          <style>
            :root {
              color-scheme: light dark;
              --bg: #f5f6fa;
              --panel: #ffffff;
              --border: #d6d9e0;
              --text: #1f2430;
              --muted: #5f677a;
              --accent: #3f5efb;
              --accent-strong: #2d4ff0;
              --radius: 12px;
              --space: 12px;
            }

            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              font-family: "Inter", "Segoe UI", sans-serif;
              background: var(--bg);
              color: var(--text);
            }

            #root {
              padding: 14px;
            }

            .card {
              background: var(--panel);
              border: 1px solid var(--border);
              border-radius: var(--radius);
              padding: var(--space);
              box-shadow: 0 3px 12px rgba(15, 23, 42, 0.06);
            }

            .title {
              margin: 0 0 8px;
              font-size: 15px;
              font-weight: 700;
            }

            .subtitle {
              margin: 0 0 10px;
              color: var(--muted);
              font-size: 12px;
            }

            .toolbar {
              display: flex;
              gap: 8px;
              margin-bottom: 10px;
            }

            .input {
              flex: 1;
              padding: 10px;
              border: 1px solid var(--border);
              border-radius: 10px;
              font-size: 13px;
              min-width: 0;
            }

            .btn {
              border: 0;
              border-radius: 10px;
              background: var(--accent);
              color: #fff;
              font-size: 13px;
              font-weight: 600;
              padding: 10px 12px;
              cursor: pointer;
            }

            .btn:hover {
              background: var(--accent-strong);
            }

            .status {
              margin: 0 0 10px;
              font-size: 12px;
              color: var(--muted);
            }

            .results {
              display: flex;
              flex-direction: column;
              gap: 8px;
            }

            .result {
              width: 100%;
              text-align: left;
              border: 1px solid var(--border);
              border-radius: 10px;
              padding: 10px;
              background: #fafbff;
              cursor: pointer;
            }

            .result-title {
              display: block;
              font-size: 13px;
              font-weight: 600;
              margin-bottom: 4px;
              color: var(--text);
            }

            .result-url {
              display: block;
              font-size: 11px;
              color: var(--muted);
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            .document {
              margin-top: 10px;
              border: 1px solid var(--border);
              border-radius: 10px;
              padding: 10px;
              background: #fff;
            }

            .document h3 {
              margin: 0 0 8px;
              font-size: 13px;
            }

            .document p {
              margin: 0;
              font-size: 12px;
              line-height: 1.45;
              white-space: pre-wrap;
              color: var(--muted);
            }
          </style>
        </head>
        <body>
          <div id="root"></div>
          <script>
            (() => {
              const root = document.getElementById("root");
              const state = {
                query: "",
                results: [],
                selected: null,
                status: "Type a query and run search.",
              };

              const bridge = () => (typeof window !== "undefined" ? window.openai ?? null : null);

              const parseJsonText = (text) => {
                if (typeof text !== "string") {
                  return null;
                }
                try {
                  return JSON.parse(text);
                } catch (_) {
                  return null;
                }
              };

              const parseSearchPayload = (toolResult) => {
                if (toolResult && toolResult.structuredContent && Array.isArray(toolResult.structuredContent.results)) {
                  return toolResult.structuredContent;
                }
                const text = toolResult && Array.isArray(toolResult.content) ? toolResult.content[0] && toolResult.content[0].text : null;
                const parsed = parseJsonText(text);
                if (parsed && Array.isArray(parsed.results)) {
                  return parsed;
                }
                return { results: [] };
              };

              const parseFetchPayload = (toolResult) => {
                if (toolResult && toolResult.structuredContent && typeof toolResult.structuredContent === "object") {
                  return toolResult.structuredContent;
                }
                const text = toolResult && Array.isArray(toolResult.content) ? toolResult.content[0] && toolResult.content[0].text : null;
                return parseJsonText(text);
              };

              const saveState = () => {
                const api = bridge();
                if (api && typeof api.setWidgetState === "function") {
                  api.setWidgetState({
                    query: state.query,
                    selectedId: state.selected && state.selected.id ? state.selected.id : null,
                  });
                }
              };

              const loadSeedData = () => {
                const api = bridge();
                if (!api) {
                  state.status = "ChatGPT bridge unavailable in this environment.";
                  return;
                }

                if (api.widgetState && typeof api.widgetState.query === "string") {
                  state.query = api.widgetState.query;
                }

                if (api.toolOutput && Array.isArray(api.toolOutput.results)) {
                  state.results = api.toolOutput.results;
                  if (api.toolOutput.query) {
                    state.query = api.toolOutput.query;
                  }
                  state.status = state.results.length > 0 ? `Loaded ${state.results.length} initial result(s).` : state.status;
                }
              };

              const callTool = async (name, args) => {
                const api = bridge();
                if (!api || typeof api.callTool !== "function") {
                  state.status = "Cannot call tools: bridge is not available.";
                  render();
                  return null;
                }
                try {
                  state.status = `Running ${name}...`;
                  render();
                  return await api.callTool(name, args);
                } catch (error) {
                  const detail = error && error.message ? error.message : "Unknown error";
                  state.status = `Tool call failed: ${detail}`;
                  render();
                  return null;
                }
              };

              const runSearch = async () => {
                const query = state.query.trim();
                if (!query) {
                  state.results = [];
                  state.status = "Enter a query before searching.";
                  render();
                  return;
                }
                const result = await callTool("search", { query });
                if (!result) {
                  return;
                }
                const payload = parseSearchPayload(result);
                state.results = Array.isArray(payload.results) ? payload.results : [];
                state.selected = null;
                state.status = state.results.length > 0 ? `Found ${state.results.length} document(s).` : "No matches found.";
                saveState();
                render();
              };

              const loadDocument = async (id) => {
                const result = await callTool("fetch", { id });
                if (!result) {
                  return;
                }
                const payload = parseFetchPayload(result);
                if (!payload || typeof payload !== "object") {
                  state.status = "Document response could not be parsed.";
                  render();
                  return;
                }
                state.selected = payload;
                state.status = `Opened ${payload.title || payload.id || id}.`;
                saveState();
                render();
              };

              const render = () => {
                root.innerHTML = "";

                const card = document.createElement("section");
                card.className = "card";

                const title = document.createElement("h2");
                title.className = "title";
                title.textContent = "Agentic Docs Search";
                card.appendChild(title);

                const subtitle = document.createElement("p");
                subtitle.className = "subtitle";
                subtitle.textContent = "Search knowledge docs and open a full entry.";
                card.appendChild(subtitle);

                const toolbar = document.createElement("div");
                toolbar.className = "toolbar";

                const input = document.createElement("input");
                input.className = "input";
                input.type = "search";
                input.placeholder = "Search by keyword";
                input.value = state.query;
                input.addEventListener("input", (event) => {
                  state.query = event.target.value;
                });
                input.addEventListener("keydown", (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runSearch();
                  }
                });
                toolbar.appendChild(input);

                const button = document.createElement("button");
                button.className = "btn";
                button.type = "button";
                button.textContent = "Search";
                button.addEventListener("click", () => {
                  void runSearch();
                });
                toolbar.appendChild(button);

                card.appendChild(toolbar);

                const status = document.createElement("p");
                status.className = "status";
                status.textContent = state.status;
                card.appendChild(status);

                const results = document.createElement("div");
                results.className = "results";
                for (const item of state.results) {
                  const row = document.createElement("button");
                  row.type = "button";
                  row.className = "result";
                  row.addEventListener("click", () => {
                    void loadDocument(item.id);
                  });

                  const rowTitle = document.createElement("span");
                  rowTitle.className = "result-title";
                  rowTitle.textContent = item.title || item.id;
                  row.appendChild(rowTitle);

                  const rowUrl = document.createElement("span");
                  rowUrl.className = "result-url";
                  rowUrl.textContent = item.url || "";
                  row.appendChild(rowUrl);

                  results.appendChild(row);
                }
                card.appendChild(results);

                if (state.selected) {
                  const documentPanel = document.createElement("article");
                  documentPanel.className = "document";

                  const heading = document.createElement("h3");
                  heading.textContent = state.selected.title || state.selected.id || "Document";
                  documentPanel.appendChild(heading);

                  const body = document.createElement("p");
                  body.textContent = state.selected.text || "No body text available.";
                  documentPanel.appendChild(body);

                  card.appendChild(documentPanel);
                }

                root.appendChild(card);
              };

              loadSeedData();
              render();
            })();
          </script>
        </body>
        </html>
        """
    ).strip()


def register_widget_resource(server: FastMCP) -> None:
    @server.resource(
        WIDGET_RESOURCE_URI,
        name="docs-search-widget",
        title="Docs Search Widget",
        description="ChatGPT widget template for project search and fetch flow.",
        mime_type=WIDGET_RESOURCE_MIME,
        meta=WIDGET_RESOURCE_META,
    )
    def docs_search_widget() -> str:
        return build_docs_widget_html()
