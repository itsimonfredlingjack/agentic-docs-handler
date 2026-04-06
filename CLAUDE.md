# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Product vision and transformation guide: `claude-code-transformation-guide.md`.

## What This Is

"Linear for Files" (working name: Brainfileing). Workspace-centric AI file management — users dump files in, the app organizes them into workspaces, generates AI briefs, extracts entities, and lets you search/chat across everything. The full product vision and transformation roadmap is in `claude-code-transformation-guide.md`.

Everything runs locally on the Mac: Tauri desktop app → FastAPI backend (localhost:9000) → Ollama (Qwen 3.5) → SQLite + LanceDB. **Workspaces are the organizing unit, not files.** Files land in an Inbox and get suggested into workspaces by AI.

## Architecture

```text
Mac (Tauri 2 + React 19)
  ├── FastAPI backend (localhost:9000)
  │     ├── Ollama (localhost:11434) — Qwen 3.5
  │     ├── SQLite (brainfileing.db) + FTS5
  │     ├── sentence-transformers + LanceDB
  │     └── WorkspaceRegistry (workspace CRUD)
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

# Start backend (Swedish, default)
uvicorn server.main:app --host 0.0.0.0 --port 9000

# Start backend (English)
ADH_LOCALE=en uvicorn server.main:app --host 0.0.0.0 --port 9000

# English prompt smoke tests (requires running backend + Ollama)
PYTHONPATH=. pytest server/tests/test_english_smoke.py -m smoke -v

# Full verification before shipping
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

## Core Workflow Notes

- Local setup: `python3.14 -m venv .venv`, activate it, `pip install -r server/requirements.txt`, then `npm install`. Copy `.env.example` to `.env` when needed.
- Backend-only development: start `uvicorn`, then use `/healthz`, `/readyz`, `/validation/report`, `/search`, `/documents`, `/documents/counts`, `/activity`, `/workspace/categories`, and `POST /process` for spot checks. `POST /workspace/chat` streams SSE with `context`, `token`, `done`, and `error` events.
- Frontend and Tauri: `npm run dev` for the renderer, `npm run tauri dev` for the desktop shell, `cargo check --manifest-path src-tauri/Cargo.toml` for Rust-side validation.
- Verification before shipping: run the full verification chain.

## WebSocket Events

Per-client events (routed by `client_id`, no broadcast):

- `connection.ready`, `heartbeat`
- `job.started`, `job.progress`, `job.completed`, `job.failed`
- `file.moved`, `file.move_undone`, `move.dismissed`

Tauri commands exposed to the renderer: `get_client_id`, `get_backend_base_url`, `reconnect_backend_ws`.

## Key Files

UI primitives (`src/components/ui/`):

- `Button.tsx` — variant (primary/secondary/text), size (sm/md/lg), loading state
- `Card.tsx` — variant (default/clickable/elevated)
- `StatusBadge.tsx` — status (success/warning/error/info) with optional icon
- `EmptyState.tsx` — centered placeholder with title, description, optional action
- `ErrorBanner.tsx` — alert banner with optional retry button
- `ProgressBar.tsx` — accessible progress indicator
- `SkeletonLoader.tsx` — repeating pulse placeholder

State hooks:

- `src/hooks/useUxState.ts` — async action state machine (idle → working → success/error)

Backend core:

- `server/main.py` - app factory, SQLite setup, migration, service wiring
- `server/services.py` - `AppServices` container for dependency injection across the app
- `server/config.py` - `pydantic_settings.BaseSettings` config with `ADH_` prefix
- `server/schemas.py` - all Pydantic models including workspace types
- `server/document_registry.py` - SQLite-backed document persistence
- `server/workspace_registry.py` - workspace CRUD operations
- `server/realtime.py` - per-client WebSocket routing
- `server/clients/ollama_client.py` - Ollama API client wrapper
- `server/migrations/schema.sql` - SQLite DDL (all tables, indexes, FTS5)

Pipelines (core logic layer):

- `server/pipelines/process_pipeline.py` - main processing orchestration
- `server/pipelines/classifier.py` - document and image classification
- `server/pipelines/extractor.py` - structured field extraction
- `server/pipelines/entity_extractor.py` - entity extraction from documents
- `server/pipelines/search.py` - hybrid search (LanceDB vectors + keywords)
- `server/pipelines/workspace_chat.py` - workspace retrieval + streamed answers
- `server/pipelines/workspace_brief.py` - auto-generated workspace briefs
- `server/pipelines/workspace_suggester.py` - auto-suggest workspace assignment
- `server/pipelines/discovery.py` - document discovery pipeline
- `server/pipelines/thumbnails.py` - thumbnail generation for UI records

LLM prompts (text files that drive classification, extraction, and chat behavior):

- `server/prompts/sv/` - Swedish prompts (default reference locale)
- `server/prompts/en/` - English prompts (full parity with sv/)
- `server/prompts/sv/classifier_system.txt` - text classification system prompt
- `server/prompts/sv/image_classifier_system.txt` - vision classification system prompt
- `server/prompts/sv/extractors/*.txt` - per-document-type extraction prompts
- `server/prompts/sv/workspace_*.txt` - workspace chat, brief, and suggestion prompts

API layer:

- `server/api/routes.py` - ingest, search, moves, workspace CRUD HTTP routes
- `server/api/ws.py` - WebSocket endpoint

Frontend:

- `src/store/documentStore.ts` - document state (Zustand)
- `src/store/workspaceStore.ts` - workspace state (Zustand)
- `src/hooks/useWebSocket.ts` - backend event handling in the renderer
- `src/hooks/useWorkspaceChat.ts` - workspace chat SSE hook
- `src/hooks/useSearch.ts` - search state and execution
- `src/lib/api.ts` - backend HTTP client
- `src/types/documents.ts` - shared document type definitions
- `src/types/workspace.ts` - shared workspace type definitions

Tauri shell:

- `src-tauri/src/main.rs` - Tauri commands and bootstrap
- `src-tauri/src/ws_client.rs` - Rust WebSocket bridge

## LLM Prompt Architecture

All LLM behavior is driven by text prompt files in `server/prompts/`. Classification, extraction, chat, and workspace features each have a system prompt file. Per-document-type extractors live under `server/prompts/extractors/`. Changing LLM behavior usually means editing these text files, not Python code.

The Ollama client (`server/clients/ollama_client.py`) wraps all LLM calls. Qwen 3.5 hangs with Ollama's `json_object` response format — extract structured data from raw text output instead.

### Prompt locales

Prompts exist in two languages: Swedish (default) and English.

```text
server/prompts/
  sv/                  ← Swedish prompts (default, reference locale)
  en/                  ← English prompts (full parity with sv/)
  _planned/            ← Future prompts not yet in the runtime registry
```

14 prompt files are loaded at startup (defined in `AppConfig.PROMPT_NAMES` in `server/config.py`):
- 2 classifier prompts (text + image)
- 1 entity extraction prompt
- 8 per-type extractor prompts (receipt, invoice, contract, meeting_notes, report, letter, tax_document, generic)
- 3 workspace prompts (chat, brief, suggest)

Resolution order (`config.resolve_prompt_path()`): locale dir → `sv/` fallback → flat fallback.

**Locale rules for prompt editing:**
- Swedish (`sv/`) is the reference locale — edit there first.
- English (`en/`) must preserve identical JSON output contracts (same keys, same schema).
- When editing a prompt in one locale, update the other to keep them aligned.
- Examples should be culturally adapted (Swedish names/amounts in `sv/`, English in `en/`), not literally translated.

### Running in English

To run the backend in English, set the locale before starting:

```bash
ADH_LOCALE=en uvicorn server.main:app --port 9000
```

Without this, everything runs in Swedish (the default).

### Smoke tests (English prompt quality)

Synthetic English test documents live in `server/tests/fixtures/en/`. To verify English prompts work against a live backend + Ollama:

```bash
# Start backend with English locale first, then in another terminal:
PYTHONPATH=. pytest server/tests/test_english_smoke.py -m smoke -v
```

These tests are excluded from the normal test suite (`pytest server/tests -q` skips them).

## Design Token System

CSS custom properties in `src/index.css` `:root`. Always use tokens — never raw `rgba(255,255,255,X)` values.

Text colors: `--text-primary` (0.92), `--text-secondary` (0.65), `--text-muted` (0.42), `--text-disabled` (0.35).

Surface backgrounds: `--surface-4`, `--surface-6`, `--surface-8`, `--surface-10` (white at 4%/6%/8%/10% opacity).

Semantic document-type colors: `--receipt-color`, `--invoice-color`, `--meeting-color`, `--contract-color`, `--report-color`, `--audio-color`. Each has an `-rgb` variant for `rgba()` usage (e.g., `rgba(var(--receipt-color-rgb), 0.12)`).

Accent: `--accent-primary` (#5856d6), `--accent-secondary`, `--accent-surface`.

Transitions: `--transition-fast` (60ms), `--transition-normal` (120ms), `--transition-smooth` (180ms), `--transition-slide` (220ms).

Layout: `--sidebar-width` (240px), `--detail-panel-width` (320px), `--card-radius` (6px), `--button-radius` (4px).

Font sizes (Tailwind): `text-xs-ui` (10px), `text-sm-ui` (12px), `text-base-ui` (13px), `text-lg-ui` (16px), `text-xl-ui` (22px). Defined in `tailwind.config.js`.

Letter-spacing: `tracking-[0.04em]` (mono badges), `tracking-[0.08em]` (uppercase labels), `tracking-tight` (headings).

## UI Design Rule

One app, one design. Never create separate layouts or visual states for online/offline, loading/loaded, or any other status. The layout (sidebar + workspace header + content area) is always the same. Status changes only affect content *inside* the layout. Empty workspace content shows the AiPresence avatar with a short message — same layout as when documents exist.

## Code Style Rules

See `CODE_STYLE.md` for full conventions. Key rules that affect correctness:

- Use `Literal` union types for string enums in both Python and TypeScript. Never use Python `enum` or TypeScript `enum`.
- Python functions use keyword-only arguments (`*` separator) for public APIs.
- Pydantic `BaseModel` for API contracts; `@dataclass(slots=True)` for internal containers.
- Optional types use `str | None` (not `Optional[str]`).
- Named exports only in React (`export function Foo`). Default export only for `App.tsx`.
- UI primitives use a local `cx()` helper for conditional classes — no external clsx/classnames library.
- UI primitives use `forwardRef` with explicit generic (e.g., `forwardRef<HTMLButtonElement>`).
- Variant/size styling defined as `const Record<Type, string>` maps, not inline ternaries.
- Frontend tests colocate with source (`Component.test.tsx`); backend tests go in `server/tests/`.
- Configuration is `pydantic_settings.BaseSettings` with `ADH_` env prefix (`server/config.py`).

## Gotchas

- `PYTHONPATH=.` is required for pytest commands.
- The backend runs locally on the Mac alongside the Tauri frontend.
- Ollama concurrency is effectively `1`, so LLM-heavy work queues.
- PDFs without extractable text fall back to the image pipeline.
- Local uploads stage under `/tmp/agentic-docs/server-staging` before processing.
- Env vars are prefixed `ADH_`; check `.env.example` before adding config.
- Key env vars: `ADH_LOCALE` (default `sv`, set to `en` for English), `ADH_OLLAMA_BASE_URL`, `ADH_OLLAMA_MODEL`, `ADH_OLLAMA_MODEL_CLASSIFIER`, `ADH_OLLAMA_MODEL_EXTRACTOR`, `ADH_OLLAMA_MODEL_WORKSPACE_CHAT`, `ADH_OLLAMA_NUM_CTX_WORKSPACE_CHAT`, `ADH_SQLITE_DB_PATH`, `ADH_LANCEDB_PATH`, `ADH_PROMPTS_DIR`, `ADH_CORS_ALLOWED_ORIGINS`.
