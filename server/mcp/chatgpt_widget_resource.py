from __future__ import annotations

from pathlib import Path
from textwrap import dedent

from mcp.server.fastmcp import FastMCP

WIDGET_RESOURCE_URI = "ui://widget/docs-console-v1.html"
WIDGET_RESOURCE_MIME = "text/html;profile=mcp-app"


def _bundle_paths() -> tuple[Path, Path]:
    root = Path(__file__).resolve().parents[2]
    dist = root / "apps" / "chatgpt-widget" / "dist"
    return dist / "widget.js", dist / "widget.css"


def build_widget_html() -> str:
    js_path, css_path = _bundle_paths()
    if js_path.exists():
        js = js_path.read_text(encoding="utf-8")
        css = css_path.read_text(encoding="utf-8") if css_path.exists() else ""
        return dedent(
            f"""
            <!doctype html>
            <html lang="en">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <title>Agentic Docs Console</title>
              <style>{css}</style>
            </head>
            <body>
              <div id="root"></div>
              <script type="module">{js}</script>
            </body>
            </html>
            """
        ).strip()

    return dedent(
        """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Agentic Docs Console</title>
          <style>
            body { font-family: sans-serif; margin: 0; padding: 12px; }
            .card { border: 1px solid #d1d5db; border-radius: 12px; padding: 12px; }
            code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h3>Docs Console Widget</h3>
            <p>Widget bundle is not built yet.</p>
            <p>Run <code>npm --prefix apps/chatgpt-widget run build</code> and reload the app.</p>
          </div>
        </body>
        </html>
        """
    ).strip()


def register_chatgpt_widget_resource(server: FastMCP) -> None:
    @server.resource(
        WIDGET_RESOURCE_URI,
        name="docs-console-widget",
        title="Docs Console Widget",
        description="Interactive ChatGPT widget for upload, analysis, search and organize flows.",
        mime_type=WIDGET_RESOURCE_MIME,
        meta={
            "ui": {
                "prefersBorder": True,
                "csp": {
                    "connectDomains": [],
                    "resourceDomains": ["https://persistent.oaistatic.com"],
                },
            },
            "openai/widgetDescription": "Interactive document console with upload, search, and safe organize actions.",
            "openai/widgetPrefersBorder": True,
            "openai/widgetCSP": {
                "connect_domains": [],
                "resource_domains": ["https://persistent.oaistatic.com"],
            },
        },
    )
    def docs_console_widget() -> str:
        return build_widget_html()
