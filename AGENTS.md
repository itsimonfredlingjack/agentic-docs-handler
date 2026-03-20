# AGENTS.md

Canonical repo instructions for coding agents working in this repository. Keep this file aligned with `CLAUDE.md` when commands or workflows change.

## What This Repo Is

`Agentic Docs Handler` is a local AI-powered document handler. Users drop files into a Tauri desktop app, the FastAPI backend classifies and extracts with Qwen via Ollama, files are organized through YAML rules, and documents are indexed for hybrid RAG search. The same pipeline layer is exposed through MCP for ChatGPT Developer Mode.

## Architecture Summary

```text
Mac (Tauri 2 + React 19)
  ├── Rust WS bridge → ws://ai-server:9000/ws
  ├── React UI → HTTP to ai-server:9000
  └── ai-server (FastAPI :9000)
        ├── Ollama :11434
        ├── sentence-transformers + LanceDB
        ├── FileOrganizer (YAML rules)
        ├── MCP mounted at /mcp
        └── Whisper proxy → ai-server2:8090
```

Layering rule:

- `server/pipelines/` is the core logic layer.
- `server/api/` and `server/mcp/` may import from `server/pipelines/`.
- `server/pipelines/` must never import from `server/api/`, `server/mcp/`, or UI layers.

Pipeline flow:

- Text documents: classify -> extract -> organize -> index
- Images: downscale -> vision classify/extract -> organize -> index
- Audio: whisper transcribe -> classify transcription -> organize -> index
- HTTP responses return after classification and extraction; indexing continues in the background
- `POST /process` is the single ingest endpoint; the backend selects the text, image, or audio path

## Repo Map

Important paths:

- `server/api/routes.py` - HTTP routes for ingest, search, move lifecycle, and workspace chat
- `server/api/ws.py` - WebSocket endpoint for per-client realtime events
- `server/main.py` - app factory and service wiring
- `server/pipelines/classifier.py` - document and image classification
- `server/pipelines/extractor.py` - structured field extraction
- `server/pipelines/process_pipeline.py` - main document processing orchestrator
- `server/pipelines/search.py` - hybrid search pipeline
- `server/pipelines/file_organizer.py` - YAML-driven file moves
- `server/pipelines/thumbnails.py` - thumbnail generation for UI records
- `server/pipelines/workspace_chat.py` - workspace context assembly and streamed answers
- `server/document_registry.py` - UI read model persistence
- `server/realtime.py` - per-client WebSocket routing
- `server/mcp/app.py` - FastMCP mount at `/mcp`
- `server/mcp/services.py` - shared MCP service container
- `server/mcp/read_tools.py` - read-only and preview MCP tools
- `server/mcp/write_tools.py` - mutating MCP file organization tools
- `server/mcp/chatgpt_file_ingest.py` - ChatGPT file download and staging
- `server/mcp/chatgpt_tools.py` - ChatGPT upload and write-guard tools
- `server/mcp/chatgpt_sessions.py` - session document tracking and TTL cleanup
- `server/mcp/chatgpt_widget_resource.py` - widget resource wiring
- `server/file_rules.yaml` - destination and naming rules
- `server/tests/` - backend tests
- `server/tests/test_mcp_chatgpt_tools.py` - ChatGPT upload, widget, and write-guard tests
- `server/tests/test_workspace_api.py` - workspace HTTP and SSE tests
- `server/tests/test_workspace_chat.py` - workspace retrieval and prompt-building tests
- `src/` - React desktop renderer
- `src/store/documentStore.ts` - single source of truth for UI state
- `src/hooks/useWebSocket.ts` - backend event handling in the renderer
- `src-tauri/src/main.rs` - Tauri commands and app bootstrap
- `src-tauri/src/ws_client.rs` - Rust WebSocket bridge
- `apps/chatgpt-widget/dist/` - checked-in widget bundle used by ChatGPT docs console in this checkout
- `scripts/deploy_ai_server.sh` - backend deploy to `ai-server`
- `scripts/deploy_whisper_server.sh` - whisper deploy to `ai-server2`

## Commands

Run commands from the repo root unless noted otherwise.

```bash
# Backend tests
PYTHONPATH=. pytest server/tests -q

# Single backend test file
PYTHONPATH=. pytest server/tests/test_api.py -q

# Single backend test by name
PYTHONPATH=. pytest server/tests/test_api.py -k "test_process_pdf" -q

# Focused workspace API tests
PYTHONPATH=. pytest server/tests/test_workspace_api.py -q

# Focused workspace chat pipeline tests
PYTHONPATH=. pytest server/tests/test_workspace_chat.py -q

# Focused ChatGPT MCP tests
PYTHONPATH=. pytest server/tests/test_mcp_chatgpt_tools.py -q

# Frontend tests
npm test

# Frontend tests in watch mode
npm run test:watch

# Type-check + build frontend
npm run build

# Rust/Tauri check
cargo check --manifest-path src-tauri/Cargo.toml

# Vite dev server
npm run dev

# Tauri desktop shell
npm run tauri dev

# Start backend
uvicorn server.main:app --host 0.0.0.0 --port 9000

# Deploy backend/search/MCP/proxy to ai-server
bash scripts/deploy_ai_server.sh

# Deploy Whisper node to ai-server2
bash scripts/deploy_whisper_server.sh

# Full verification before shipping
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

## Workflows

### Local Setup

Create the backend environment and install dependencies:

```bash
python3.14 -m venv .venv
. .venv/bin/activate
pip install -r server/requirements.txt
npm install
```

Copy `.env.example` to `.env` when a local env file is needed.

### Backend-Only Development

Start the API:

```bash
uvicorn server.main:app --host 0.0.0.0 --port 9000
```

Useful checks:

```bash
curl http://127.0.0.1:9000/healthz
curl http://127.0.0.1:9000/readyz
curl http://127.0.0.1:9000/validation/report
curl 'http://127.0.0.1:9000/search?query=warmup'
curl http://127.0.0.1:9000/documents
curl http://127.0.0.1:9000/documents/counts
curl http://127.0.0.1:9000/activity
curl http://127.0.0.1:9000/workspace/categories
curl -X POST http://127.0.0.1:9000/process \
  -F 'file=@server/tests/fixtures/texts/receipt-basic.txt;type=text/plain'
curl -N -X POST http://127.0.0.1:9000/workspace/chat \
  -H 'Content-Type: application/json' \
  -d '{"category":"receipt","message":"Vad ar momsen?","history":[]}'
```

Run focused backend tests before broader verification:

```bash
PYTHONPATH=. pytest server/tests/test_api.py -q
```

`/workspace/chat` streams server-sent events with `context`, `token`, `done`, and `error` event types.

### Frontend And Tauri Development

Run the renderer alone:

```bash
npm run dev
```

Run the desktop shell:

```bash
npm run tauri dev
```

Check Rust/Tauri integration without starting the app:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Tauri commands exposed to the renderer:

- `get_client_id`
- `get_backend_base_url`
- `reconnect_backend_ws`

Per-client realtime events routed over `/ws`:

- `connection.ready`, `heartbeat`
- `job.started`, `job.progress`, `job.completed`, `job.failed`
- `file.moved`, `file.move_undone`, `move.dismissed`

### Verification Before Shipping

Default repo verification:

```bash
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

When changing ChatGPT widget resource wiring, verify that `apps/chatgpt-widget/dist/widget.js` and `apps/chatgpt-widget/dist/widget.css` are present. This checkout contains only the built widget bundle, not the widget source package.

### Deploy To ai-server

Deploy backend, search, MCP, and proxy:

```bash
bash scripts/deploy_ai_server.sh
```

The deploy script is the source of truth for remote behavior:

- default host is `ai-server`
- default remote root is `/home/ai-server/01_PROJECTS/agentic-docs-handler`
- code is synced with `rsync`
- the backend starts in tmux session `adh-phase3`
- port `9000` is cleared before restart
- `/healthz` is checked after boot
- a warmup request is sent to `/search?query=warmup`

### Deploy To ai-server2

Deploy the standalone Whisper node:

```bash
bash scripts/deploy_whisper_server.sh
```

The deploy script is the source of truth for remote behavior:

- default host is `ai-server2`
- default remote root is `/home/ai-server2/01_PROJECTS/agentic-docs-handler`
- a dedicated `.venv-whisper` is recreated on deploy
- the process starts in tmux session `adh-whisper`
- port `8090` is cleared before restart
- `/healthz` is checked after boot

### ChatGPT And MCP Workflow

MCP is mounted inside the same FastAPI process at `/mcp`. It is not a separate service.

Current MCP surface includes:

- read and search tools: `search`, `search_documents`, `fetch`, `get_system_status`, `get_validation_report`, `get_activity_log`, `get_workspace_categories`, `fetch_session_document`, `search_session_documents`
- document processing tools: `classify_text`, `classify_image`, `classify_document`, `extract_fields`, `preview_document_processing`, `transcribe_audio`, `transcribe_uploaded_audio`, `analyze_uploaded_document`
- rule inspection tool: `list_file_rules`
- organization tools: `organize_file`, `preview_organize_uploaded`, `confirm_organize_uploaded`
- ChatGPT UI tool: `render_docs_console`

ChatGPT upload flow:

1. Use fileParam tools such as `analyze_uploaded_document`, `transcribe_uploaded_audio`, or `preview_organize_uploaded`.
2. For file organization through ChatGPT, always follow the two-step write guard:
   `preview_organize_uploaded` -> `confirm_organize_uploaded`
3. `confirm_organize_uploaded` requires the previously returned `confirm_token` and an `idempotency_key`.
4. Session follow-up uses `search_session_documents` and `fetch_session_document`.

Widget workflow:

- widget resource path is `ui://widget/docs-console-v1.html`
- widget HTML is built inline from `apps/chatgpt-widget/dist/widget.js` and `apps/chatgpt-widget/dist/widget.css`
- if the widget is stale or missing in this checkout, confirm the `dist/` bundle exists before testing MCP widget rendering

Public MCP URL in the current deployed setup:

- `https://docsgpt.fredlingautomation.dev/mcp`

## Environment And Gotchas

- `PYTHONPATH=.` is required for pytest commands because the project is not installed as a package.
- In the real setup, the backend runs on `ai-server`; the Mac mainly runs the Tauri frontend.
- Ollama concurrency is effectively `1`, so parallel LLM-heavy work will queue.
- PDFs without extractable text fall back to the image pipeline.
- Local uploads are staged under `/tmp/agentic-docs/server-staging` before processing.
- ChatGPT upload staging files are cleaned up on a TTL-based background loop.
- Important env vars are prefixed `ADH_`; check `.env.example` before adding new config.
- Commonly touched env vars include `ADH_OLLAMA_BASE_URL`, `ADH_OLLAMA_MODEL`, `ADH_OLLAMA_MODEL_CLASSIFIER`, `ADH_OLLAMA_MODEL_EXTRACTOR`, `ADH_OLLAMA_MODEL_WORKSPACE_CHAT`, `ADH_OLLAMA_NUM_CTX_WORKSPACE_CHAT`, `ADH_WHISPER_BASE_URL`, `ADH_LANCEDB_PATH`, `ADH_UI_DOCUMENTS_PATH`, `ADH_MCP_ENABLED`, `ADH_MCP_MOUNT_PATH`, `ADH_CHATGPT_WRITE_GUARD_ENABLED`, `ADH_CHATGPT_UPLOAD_MAX_BYTES`, `ADH_CHATGPT_WIDGET_ENABLED`, `ADH_STAGING_DIR`, and `ADH_CORS_ALLOWED_ORIGINS`.
