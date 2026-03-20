# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Keep this file aligned with `AGENTS.md` when commands or workflows change.

## What This Is

Local AI-powered document handler. Files come through a Tauri desktop app, a FastAPI backend classifies and extracts with Qwen via Ollama, documents are organized by YAML rules, indexed for hybrid search, and exposed through an MCP surface for ChatGPT.

## Architecture

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

Layer rule:

- `server/pipelines/` is the core logic layer.
- `server/api/` and `server/mcp/` may import from `server/pipelines/`.
- `server/pipelines/` must never import from `server/api/`, `server/mcp/`, or UI layers.

Pipeline flow:

- Text documents: classify → extract → organize → index
- Images: downscale → vision classify/extract → organize → index
- Audio: whisper transcribe → classify transcription → organize → index
- HTTP responses return after classification and extraction; indexing continues in the background.
- `POST /process` is the only ingest endpoint. The backend determines text, image, or audio flow.

Move execution model:

- `move_executor="server"` executes the file move immediately on the backend.
- `move_executor="client"` yields client-pending states (`auto_pending_client` / `awaiting_confirmation`); the desktop app finalizes through move endpoints.
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

# Focused ChatGPT MCP tests
PYTHONPATH=. pytest server/tests/test_mcp_chatgpt_tools.py -q

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

# Deploy backend to ai-server
bash scripts/deploy_ai_server.sh

# Deploy Whisper to ai-server2
bash scripts/deploy_whisper_server.sh

# Full verification before shipping
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

## Core Workflow Notes

- Local setup: `python3.14 -m venv .venv`, activate it, `pip install -r server/requirements.txt`, then `npm install`. Copy `.env.example` to `.env` when needed.
- Backend-only development: start `uvicorn`, then use `/healthz`, `/readyz`, `/validation/report`, `/search`, `/documents`, `/documents/counts`, `/activity`, `/workspace/categories`, and `POST /process` for spot checks. `POST /workspace/chat` streams SSE with `context`, `token`, `done`, and `error` events.
- Frontend and Tauri: `npm run dev` for the renderer, `npm run tauri dev` for the desktop shell, `cargo check --manifest-path src-tauri/Cargo.toml` for Rust-side validation.
- Verification before shipping: run the full verification chain; if widget or MCP UI resources changed, confirm `apps/chatgpt-widget/dist/widget.js` and `apps/chatgpt-widget/dist/widget.css` are present in this checkout.
- Deploy: `scripts/deploy_ai_server.sh` syncs via rsync, restarts in tmux session `adh-phase3`, clears port 9000, checks `/healthz`, and sends a warmup to `/search?query=warmup`. `scripts/deploy_whisper_server.sh` deploys to `ai-server2` in tmux session `adh-whisper` on port 8090.

## WebSocket Events

Per-client events (routed by `client_id`, no broadcast):

- `connection.ready`, `heartbeat`
- `job.started`, `job.progress`, `job.completed`, `job.failed`
- `file.moved`, `file.move_undone`, `move.dismissed`

Tauri commands exposed to the renderer: `get_client_id`, `get_backend_base_url`, `reconnect_backend_ws`.

## MCP And ChatGPT

- MCP is mounted inside the FastAPI process at `/mcp`. It is not a separate service.
- Public MCP URL: `https://docsgpt.fredlingautomation.dev/mcp`
- Current read/preview tools include `search`, `search_documents`, `fetch`, `get_system_status`, `get_validation_report`, `get_activity_log`, `get_workspace_categories`, `classify_text`, `classify_image`, `classify_document`, `extract_fields`, `preview_document_processing`, `transcribe_audio`, and `list_file_rules`.
- ChatGPT upload flow uses fileParam tools such as `analyze_uploaded_document`, `transcribe_uploaded_audio`, and `preview_organize_uploaded`.
- Organization through ChatGPT must follow the two-step guard:
  `preview_organize_uploaded` → `confirm_organize_uploaded`
- `confirm_organize_uploaded` requires the returned `confirm_token` plus an `idempotency_key`.
- Session follow-up uses `search_session_documents` and `fetch_session_document`.
- Widget resource path: `ui://widget/docs-console-v1.html`
- Widget HTML is assembled from `apps/chatgpt-widget/dist/widget.js` and `apps/chatgpt-widget/dist/widget.css` in this checkout

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
- `server/mcp/app.py` - MCP mount
- `server/mcp/services.py` - shared MCP service container
- `server/mcp/read_tools.py` - read-only and preview tools
- `server/mcp/write_tools.py` - mutating organize tool
- `server/mcp/chatgpt_tools.py` - ChatGPT upload and write-guard tools
- `server/mcp/chatgpt_file_ingest.py` - ChatGPT file staging
- `server/mcp/chatgpt_sessions.py` - session document tracking and TTL cleanup
- `server/tests/test_mcp_chatgpt_tools.py` - ChatGPT widget + write-guard tests
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
- The real backend normally runs on `ai-server`; the Mac mainly runs the Tauri frontend.
- Ollama concurrency is effectively `1`, so LLM-heavy work queues.
- PDFs without extractable text fall back to the image pipeline.
- Local uploads stage under `/tmp/agentic-docs/server-staging` before processing.
- ChatGPT upload staging is cleaned up by a TTL-based background loop.
- Env vars are prefixed `ADH_`; check `.env.example` before adding config.
- Key env vars: `ADH_OLLAMA_BASE_URL`, `ADH_OLLAMA_MODEL`, `ADH_OLLAMA_MODEL_CLASSIFIER`, `ADH_OLLAMA_MODEL_EXTRACTOR`, `ADH_OLLAMA_MODEL_WORKSPACE_CHAT`, `ADH_OLLAMA_NUM_CTX_WORKSPACE_CHAT`, `ADH_WHISPER_BASE_URL`, `ADH_LANCEDB_PATH`, `ADH_UI_DOCUMENTS_PATH`, `ADH_MCP_ENABLED`, `ADH_MCP_MOUNT_PATH`, `ADH_CHATGPT_WRITE_GUARD_ENABLED`, `ADH_CHATGPT_UPLOAD_MAX_BYTES`, `ADH_CHATGPT_WIDGET_ENABLED`, `ADH_STAGING_DIR`, `ADH_CORS_ALLOWED_ORIGINS`.
