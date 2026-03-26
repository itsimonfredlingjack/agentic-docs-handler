# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Keep this file aligned with `AGENTS.md` when commands or workflows change.

## What This Is

Local-first AI-powered document handler. Everything runs on the Mac: a Tauri desktop app ingests files, a local FastAPI backend classifies and extracts with Qwen via Ollama, documents are organized by YAML rules and indexed for hybrid search. Only Whisper transcription is proxied to ai-server2.

## Architecture

```text
Mac (Tauri 2 + React 19)
  ├── FastAPI backend (localhost:9000)
  │     ├── Ollama (localhost:11434)
  │     ├── sentence-transformers + LanceDB
  │     ├── FileOrganizer (YAML rules)
  │     └── Whisper proxy → ai-server2:8090
  └── Tauri UI → localhost:9000
```

Layer rule:

- `server/pipelines/` is the core logic layer.
- `server/api/` may import from `server/pipelines/`.
- `server/pipelines/` must never import from `server/api/` or UI layers.

Pipeline flow:

- Text documents: classify → extract → organize → index
- Images: downscale → vision classify/extract → organize → index
- Audio: whisper transcribe → classify transcription → organize → index
- HTTP responses return after classification and extraction; indexing continues in the background.
- `POST /process` is the only ingest endpoint. The backend determines text, image, or audio flow.

Move execution model:

- `move_executor="client"` yields client-pending states (`auto_pending_client` / `awaiting_confirmation`); the desktop app finalizes through move endpoints.
- `move_executor="none"` skips the move step entirely.
- `job.completed` is emitted after indexing finishes, except when waiting on client move confirmation.

## Commands

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

# Frontend tests (Vitest + jsdom + @testing-library)
npm test

# Frontend single test file
npm test -- src/components/DocumentRow.test.tsx

# Frontend single test by name
npm test -- -t "renders completed document"

# Frontend tests in watch mode
npm run test:watch

# Type-check + build frontend (there is no separate lint script)
npm run build

# Rust/Tauri check
cargo check --manifest-path src-tauri/Cargo.toml

# Vite dev server (port 1420)
npm run dev

# Tauri desktop shell
npm run tauri dev

# Start backend
uvicorn server.main:app --host 0.0.0.0 --port 9000

# Deploy Whisper to ai-server2
bash scripts/deploy_whisper_server.sh

# Full verification before shipping
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

## Core Workflow Notes

- Local setup: `python3.14 -m venv .venv`, activate it, `pip install -r server/requirements.txt`, then `npm install`. Copy `.env.example` to `.env` when needed.
- Backend-only development: start `uvicorn`, then use `/healthz`, `/readyz`, `/validation/report`, `/search`, `/documents`, `/documents/counts`, `/activity`, `/workspace/categories`, and `POST /process` for spot checks. `POST /workspace/chat` streams SSE with `context`, `token`, `done`, and `error` events.
- Frontend and Tauri: `npm run dev` for the renderer, `npm run tauri dev` for the desktop shell, `cargo check --manifest-path src-tauri/Cargo.toml` for Rust-side validation.
- Verification before shipping: run the full verification chain.
- Deploy: `scripts/deploy_whisper_server.sh` deploys to `ai-server2` in tmux session `adh-whisper` on port 8090.

## WebSocket Events

Per-client events (routed by `client_id`, no broadcast):

- `connection.ready`, `heartbeat`
- `job.started`, `job.progress`, `job.completed`, `job.failed`
- `file.moved`, `file.move_undone`, `move.dismissed`

Tauri commands exposed to the renderer: `get_client_id`, `get_backend_base_url`, `reconnect_backend_ws`.

## Key Files

- `server/main.py` - app factory and service wiring
- `server/pipelines/process_pipeline.py` - main processing orchestration
- `server/pipelines/search.py` - hybrid search
- `server/pipelines/thumbnails.py` - thumbnail generation
- `server/pipelines/workspace_chat.py` - workspace retrieval + streamed answers
- `server/pipelines/file_organizer.py` - YAML-driven file moves
- `server/pipelines/classifier.py` - document classification
- `server/pipelines/extractor.py` - field extraction
- `server/document_registry.py` - UI document read model
- `server/api/routes.py` - ingest, search, moves, workspace HTTP routes
- `server/api/ws.py` - WebSocket endpoint
- `server/realtime.py` - per-client WebSocket routing
- `server/file_rules.yaml` - destination and naming rules
- `server/tests/test_workspace_api.py` - workspace HTTP/SSE tests
- `server/tests/test_workspace_chat.py` - workspace chat pipeline tests
- `src/store/documentStore.ts` - UI state source of truth (Zustand)
- `src/hooks/useWebSocket.ts` - renderer WebSocket integration
- `src-tauri/src/main.rs` - Tauri commands and bootstrap
- `src-tauri/src/ws_client.rs` - Rust WebSocket bridge

## Code Style Rules

See `CODE_STYLE.md` for full conventions. Key rules that affect correctness:

- Use `Literal` union types for string enums in both Python and TypeScript. Never use Python `enum` or TypeScript `enum`.
- Python functions use keyword-only arguments (`*` separator) for public APIs.
- Pydantic `BaseModel` for API contracts; `@dataclass(slots=True)` for internal containers.
- Optional types use `str | None` (not `Optional[str]`).
- Named exports only in React (`export function Foo`). Default export only for `App.tsx`.
- Frontend tests colocate with source (`Component.test.tsx`); backend tests go in `server/tests/`.
- Configuration is `pydantic_settings.BaseSettings` with `ADH_` env prefix (`server/config.py`).

## Gotchas

- `PYTHONPATH=.` is required for pytest commands.
- The backend runs locally on the Mac alongside the Tauri frontend.
- Ollama concurrency is effectively `1`, so LLM-heavy work queues.
- PDFs without extractable text fall back to the image pipeline.
- Local uploads stage under `/tmp/agentic-docs/server-staging` before processing.
- Env vars are prefixed `ADH_`; check `.env.example` before adding config.
- Key env vars: `ADH_OLLAMA_BASE_URL`, `ADH_OLLAMA_MODEL`, `ADH_OLLAMA_MODEL_CLASSIFIER`, `ADH_OLLAMA_MODEL_EXTRACTOR`, `ADH_OLLAMA_MODEL_WORKSPACE_CHAT`, `ADH_OLLAMA_NUM_CTX_WORKSPACE_CHAT`, `ADH_WHISPER_BASE_URL`, `ADH_LANCEDB_PATH`, `ADH_UI_DOCUMENTS_PATH`, `ADH_CORS_ALLOWED_ORIGINS`.
