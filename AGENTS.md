# AGENTS.md

Canonical repo instructions for coding agents working in this repository. Keep this file aligned with `CLAUDE.md` when commands or workflows change.

## What This Repo Is

`Agentic Docs Handler` is a local-first AI-powered document handler. Users drop files into a Tauri desktop app, a FastAPI backend running on the same Mac classifies and extracts with Qwen via Ollama, files are organized through YAML rules, and documents are indexed for hybrid RAG search.

## Architecture Summary

```text
Mac (Tauri 2 + React 19)
  ├── FastAPI backend (localhost:9000)
  │     ├── Ollama (localhost:11434)
  │     ├── sentence-transformers + LanceDB
  │     ├── FileOrganizer (YAML rules)
  │     └── Whisper proxy → ai-server2:8090
  └── Tauri UI → localhost:9000
```

Layering rule:

- `server/pipelines/` is the core logic layer.
- `server/api/` may import from `server/pipelines/`.
- `server/pipelines/` must never import from `server/api/` or UI layers.

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
- `server/file_rules.yaml` - destination and naming rules
- `server/tests/` - backend tests
- `server/tests/test_workspace_api.py` - workspace HTTP and SSE tests
- `server/tests/test_workspace_chat.py` - workspace retrieval and prompt-building tests
- `src/` - React desktop renderer
- `src/store/documentStore.ts` - single source of truth for UI state
- `src/hooks/useWebSocket.ts` - backend event handling in the renderer
- `src-tauri/src/main.rs` - Tauri commands and app bootstrap
- `src-tauri/src/ws_client.rs` - Rust WebSocket bridge
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

## Environment And Gotchas

- `PYTHONPATH=.` is required for pytest commands because the project is not installed as a package.
- The backend runs locally on the Mac alongside the Tauri frontend.
- Ollama concurrency is effectively `1`, so parallel LLM-heavy work will queue.
- PDFs without extractable text fall back to the image pipeline.
- Local uploads are staged under `/tmp/agentic-docs/server-staging` before processing.
- Important env vars are prefixed `ADH_`; check `.env.example` before adding new config.
- Commonly touched env vars include `ADH_OLLAMA_BASE_URL`, `ADH_OLLAMA_MODEL`, `ADH_OLLAMA_MODEL_CLASSIFIER`, `ADH_OLLAMA_MODEL_EXTRACTOR`, `ADH_OLLAMA_MODEL_WORKSPACE_CHAT`, `ADH_OLLAMA_NUM_CTX_WORKSPACE_CHAT`, `ADH_WHISPER_BASE_URL`, `ADH_LANCEDB_PATH`, `ADH_UI_DOCUMENTS_PATH`, `ADH_STAGING_DIR`, and `ADH_CORS_ALLOWED_ORIGINS`.
