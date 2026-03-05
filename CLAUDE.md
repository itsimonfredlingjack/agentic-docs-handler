# CLAUDE.md

This file mirrors the repo guidance in `AGENTS.md`. Treat `AGENTS.md` as canonical for workflows and commands, and keep both files aligned when editing repo instructions.

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

## Commands

```bash
PYTHONPATH=. pytest server/tests -q
PYTHONPATH=. pytest server/tests/test_api.py -q
PYTHONPATH=. pytest server/tests/test_api.py -k "test_process_pdf" -q
npm test
npm run test:watch
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run dev
npm run tauri dev
uvicorn server.main:app --host 0.0.0.0 --port 9000
npm --prefix apps/chatgpt-widget run build
bash scripts/deploy_ai_server.sh
bash scripts/deploy_whisper_server.sh
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

## Core Workflow Notes

- Local setup: `python3.14 -m venv .venv`, activate it, `pip install -r server/requirements.txt`, then `npm install`.
- Backend-only development: start `uvicorn`, then use `/healthz`, `/readyz`, `/validation/report`, `/search`, `/documents`, `/documents/counts`, and `/activity` for spot checks.
- Frontend and Tauri: `npm run dev` for the renderer, `npm run tauri dev` for the desktop shell, `cargo check --manifest-path src-tauri/Cargo.toml` for Rust-side validation.
- Verification before shipping: run the full verification chain; also run `npm --prefix apps/chatgpt-widget run build` if widget or MCP UI resources changed.
- Deploy: `scripts/deploy_ai_server.sh` is the source of truth for `ai-server` deploy behavior and warmup; `scripts/deploy_whisper_server.sh` is the source of truth for `ai-server2` and the whisper runtime.

## MCP And ChatGPT

- MCP is mounted inside the FastAPI process at `/mcp`.
- ChatGPT upload flow uses fileParam tools such as `analyze_uploaded_document`, `transcribe_uploaded_audio`, and `preview_organize_uploaded`.
- Organization through ChatGPT must follow the two-step guard:
  `preview_organize_uploaded` -> `confirm_organize_uploaded`
- `confirm_organize_uploaded` requires the returned `confirm_token` plus an `idempotency_key`.
- Session follow-up uses `search_session_documents` and `fetch_session_document`.
- Widget asset build command: `npm --prefix apps/chatgpt-widget run build`

## Key Files

- `server/main.py` - app factory and service wiring
- `server/pipelines/process_pipeline.py` - main processing orchestration
- `server/pipelines/search.py` - hybrid search
- `server/document_registry.py` - UI document read model
- `server/realtime.py` - per-client WebSocket routing
- `server/mcp/app.py` - MCP mount
- `server/mcp/services.py` - shared MCP service container
- `server/mcp/chatgpt_tools.py` - ChatGPT upload and write-guard tools
- `src/store/documentStore.ts` - UI state source of truth
- `src/hooks/useWebSocket.ts` - renderer WebSocket integration
- `src-tauri/src/main.rs` - Tauri commands and bootstrap
- `src-tauri/src/ws_client.rs` - Rust WebSocket bridge

## Gotchas

- `PYTHONPATH=.` is required for pytest commands.
- The real backend normally runs on `ai-server`; the Mac mainly runs the Tauri frontend.
- Ollama concurrency is effectively `1`, so LLM-heavy work queues.
- PDFs without extractable text fall back to the image pipeline.
- ChatGPT upload staging is cleaned up by a TTL-based background loop.
- Env vars are prefixed `ADH_`; check `.env.example` before adding config.
