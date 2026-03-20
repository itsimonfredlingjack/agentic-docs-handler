# Copilot Instructions for agentic-docs-handler

## Build, test, and validation commands

Run from repo root.

```bash
# Backend tests (full)
PYTHONPATH=. pytest server/tests -q

# Backend single file
PYTHONPATH=. pytest server/tests/test_api.py -q

# Backend single test by name
PYTHONPATH=. pytest server/tests/test_api.py -k "test_process_pdf" -q

# Frontend tests (Vitest)
npm test

# Frontend single test file
npm test -- src/path/to/file.test.ts

# Frontend single test by name
npm test -- -t "test name"

# Frontend type-check + production build
npm run build

# Rust/Tauri check
cargo check --manifest-path src-tauri/Cargo.toml

# Full repo verification used in docs
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

Notes:
- `PYTHONPATH=.` is required for backend pytest commands.
- There is no dedicated lint script in the root `package.json`; `npm run build` performs TypeScript checking (`tsc --noEmit`) plus Vite build.

## High-level architecture

This repo is a single FastAPI backend serving both the desktop app API and MCP:

- Tauri desktop app (`src-tauri/`) + React renderer (`src/`) call backend HTTP endpoints and receive realtime events via `/ws`.
- Backend app composition is in `server/main.py`; routers come from `server/api/routes.py` and `server/api/ws.py`.
- MCP is mounted in the same FastAPI process at `mount_path` (default `/mcp`) via `server/mcp/app.py`; it is not a separate service.

Core processing path:

1. `POST /process` (`server/api/routes.py`) is the ingest endpoint for document processing in app flow.
2. `DocumentProcessPipeline.process_upload()` (`server/pipelines/process_pipeline.py`) detects modality (text/image/audio), runs classify/extract, plans move, persists UI record, and emits websocket progress events.
3. Search indexing is scheduled in background (`_schedule_indexing`), and `job.completed` is emitted after indexing (except pending client move states).
4. Persisted UI state and move history are managed by `DocumentRegistry` (`server/document_registry.py`), stored as append-only JSONL logs.

## Key conventions in this repository

- Layering rule is strict: `server/pipelines/` is core logic and must not import API/MCP/UI layers. API/MCP layers import pipelines.
- WebSocket events are routed per `client_id` only (`ConnectionManager.emit_to_client`); no broadcast for job events.
- For file organization, move execution is explicit via `move_executor`:
  - `"server"` can execute move immediately.
  - `"client"` yields client-pending states (`auto_pending_client` / `awaiting_confirmation`) and completion is finalized through move endpoints.
- MCP ChatGPT file-organization flow uses a two-step write guard in `server/mcp/chatgpt_tools.py`:
  - `preview_organize_uploaded` -> `confirm_organize_uploaded`
  - confirm requires `confirm_token` and `idempotency_key`.
- Frontend state source of truth is Zustand store `src/store/documentStore.ts`; websocket event handling in `src/hooks/useWebSocket.ts` mutates this store and performs backend resync after reconnect.
- Processing stage labels and event payload structure are part of UI contract (`job.started`, `job.progress`, `job.completed`, `job.failed`, `file.moved`, `file.move_undone`, `move.dismissed`).
