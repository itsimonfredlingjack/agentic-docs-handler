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

# Full repo verification
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

Notes:
- `PYTHONPATH=.` is required for backend pytest commands.
- There is no dedicated lint script; `npm run build` performs TypeScript checking (`tsc --noEmit`) plus Vite build.

## High-level architecture

Local-first AI-powered workspace file manager (Brainfileing). Everything runs on the Mac:

- Tauri desktop app (`src-tauri/`) + React renderer (`src/`) call backend HTTP endpoints and receive realtime events via `/ws`.
- Backend app composition is in `server/main.py`; routers come from `server/api/routes.py` and `server/api/ws.py`.
- Ollama (localhost:11434) provides LLM inference via Qwen 3.5.
- SQLite + FTS5 for persistence, LanceDB + sentence-transformers for vector search.

Core processing path:

1. `POST /process` is the ingest endpoint.
2. `DocumentProcessPipeline.process_upload()` detects modality (text/image/audio), runs classify/extract, persists UI record, and emits WebSocket progress events.
3. Search indexing is scheduled in background.

## Key conventions

- Layering rule: `server/pipelines/` is core logic and must not import API or UI layers.
- WebSocket events are routed per `client_id` only (no broadcast).
- Frontend state source of truth is Zustand stores: `documentStore.ts` and `workspaceStore.ts`.
- Product vision: `claude-code-transformation-guide.md`.
