# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Local AI-powered document handler. Users drop files (PDF, images, audio) into a Tauri desktop app → FastAPI backend classifies via Qwen 3.5 9B (Ollama), extracts structured fields, sorts to destination folders via YAML rules, and indexes for hybrid RAG search. Everything runs locally, zero cloud.

## Architecture

```
Mac (Tauri 2 + React 19)
  ├── Rust WS bridge → ws://ai-server:9000/ws
  ├── React UI → HTTP to ai-server:9000
  └── ai-server (FastAPI :9000)
        ├── Ollama :11434 (Qwen 3.5 9B, Q4_K_M)
        ├── sentence-transformers (nomic-embed-text, CPU)
        ├── LanceDB (vector DB, disk)
        ├── FileOrganizer (YAML rules → move file)
        └── HTTP → ai-server2:8090 (Whisper large-v3-turbo, RTX 2060)
```

**Layer rule**: `pipelines/` is the core logic layer. `api/` and `mcp/` import from `pipelines/`. Pipelines never import from api or mcp layers.

**Pipeline flow**: File dropped → MIME detect → text/image/audio branch:
- Text (PDF/DOCX/TXT) → Qwen classifies → Qwen extracts fields → FileOrganizer → LanceDB index
- Image → downscale to max 1280px → Qwen vision (native, no OCR) → FileOrganizer → LanceDB
- Audio → Whisper transcribes (ai-server2) → Qwen classifies transcription → FileOrganizer → LanceDB

HTTP response returns after classification+extraction; indexing runs in background.

## Commands

```bash
# Backend tests (run from repo root)
PYTHONPATH=. pytest server/tests -q

# Single backend test file
PYTHONPATH=. pytest server/tests/test_api.py -q

# Single test by name
PYTHONPATH=. pytest server/tests/test_api.py -k "test_process_pdf" -q

# Frontend tests
npm test

# Frontend tests in watch mode
npm run test:watch

# Type-check + build frontend
npm run build

# Rust/Tauri check
cargo check --manifest-path src-tauri/Cargo.toml

# Dev frontend only (Vite on :1420)
npm run dev

# Dev with Tauri shell
npm run tauri dev

# Start backend (on ai-server)
uvicorn server.main:app --host 0.0.0.0 --port 9000

# Deploy backend to ai-server
bash scripts/deploy_ai_server.sh

# Deploy Whisper to ai-server2
bash scripts/deploy_whisper_server.sh

# Full verification before shipping
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

## Key Files

- `server/config.py` — Central config via pydantic-settings. All env vars prefixed `ADH_`. The `LLM_MODEL` constant lives here.
- `server/schemas.py` — All Pydantic models: `ProcessResponse`, `DocumentClassification`, `ExtractionResult`, `UiDocumentRecord`, type literals (`DocumentType`, `SourceModality`, `MoveStatus`, etc.)
- `server/main.py` — App factory (`create_app`). Wires all services: OllamaClient, classifiers, extractors, pipeline, search, registry, MCP.
- `server/clients/ollama_client.py` — All Ollama calls go through `AsyncOllamaClient`. Has retry logic, JSON repair, concurrency semaphore.
- `server/pipelines/process_pipeline.py` — Main orchestrator: classify → extract → organize → index. Handles text/image/audio routing.
- `server/pipelines/file_organizer.py` — Reads `server/file_rules.yaml` to decide destination paths.
- `server/pipelines/search.py` — Hybrid RAG: embedding + BM25 + LLM query rewrite + answer generation.
- `server/document_registry.py` — In-memory document store with JSONL persistence for UI read-model.
- `server/prompts/` — System prompts for classifier, extractor (per doc type), and search.
- `server/file_rules.yaml` — Per-document-type sorting rules (destination folders, naming patterns).
- `src/store/documentStore.ts` — Zustand store. Single source of truth for all UI state.
- `src/types/documents.ts` — TypeScript types mirrored from backend schemas.
- `src/hooks/useWebSocket.ts` — WS hook with auto-reconnect and event routing.
- `src-tauri/src/main.rs` — Tauri setup, exposes `get_client_id`, `get_backend_base_url`, `reconnect_backend_ws` commands.

## Backend Test Patterns

Tests use `FastAPI.TestClient` with `create_app()`. Pipeline dependencies are faked via simple stub classes (e.g., `FakePipeline`). No external services needed — all Ollama/Whisper calls are mocked. Test framework: pytest + pytest-asyncio.

## Frontend Stack

React 19 + Vite 7 + Tailwind 3 + Zustand 5. Tests via Vitest + Testing Library + jsdom. TypeScript strict mode. No external UI library — custom frost-glass components.

## Design Language

"Frost Glass" — light theme, macOS-native feel. `backdrop-filter: blur(40px)`, 16px border-radius, Apple color palette per document type, SF Pro system fonts, animations 150–300ms. Full spec in `agentic-docs-design-spec.md`.

## Document Types

`receipt`, `contract`, `invoice`, `meeting_notes`, `generic`, `unsupported`. Each has a dedicated extractor prompt in `server/prompts/extractors/` and a frontend template card in `src/templates/`.

## Environment Variables

All prefixed `ADH_`. See `.env.example` for the full list. Key ones:
- `ADH_OLLAMA_BASE_URL` / `ADH_OLLAMA_MODEL` — LLM endpoint
- `ADH_WHISPER_BASE_URL` — Whisper server on ai-server2
- `ADH_LANCEDB_PATH` — Vector DB storage
- `ADH_UI_DOCUMENTS_PATH` — JSONL persistence for document registry

## Gotchas

- Ollama concurrency is 1 (`ollama_max_concurrency=1`). Parallel LLM calls queue, causing wait times.
- PDF without extractable text falls back to image pipeline (works but slower).
- Backend runs on ai-server (remote), not on Mac. Mac only runs Tauri frontend.
- MCP server is mounted at `/mcp` inside the same FastAPI process — not a separate service.
