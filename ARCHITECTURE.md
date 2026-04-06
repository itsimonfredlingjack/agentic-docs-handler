# Architecture Overview

## Product Purpose

**Brainfileing** (formerly "Linear for Files") is a workspace-centric AI file management application that runs locally on macOS. Users dump files (PDFs, images, Word docs, markdown) into the app; the system automatically organizes them into workspaces and generates AI-generated overviews, entity extraction, and topic summaries.

**Core principle:** Workspaces are the organizing unit, not files. Files land in an Inbox and get AI-suggested into workspaces.

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Desktop Shell | Tauri 2 + React 19 + TypeScript | 2.10.x / 19.2.x |
| Backend API | FastAPI (Python) | 0.132.0 |
| LLM | Ollama (Qwen 3.5) | - |
| Vector Store | LanceDB + sentence-transformers | 0.29.2 / 5.1.2 |
| Database | SQLite (FTS5) | - |
| Audio Transcription | Whisper (via ai-server2) | turbo-v3 |
| Styling | Tailwind CSS | 3.4.19 |

## System Architecture

```text
Mac (Tauri 2 + React 19)
  ├── Tauri Shell (src-tauri/src/main.rs, ws_client.rs)
  │   └── Tauri commands: file operations, WebSocket management
  ├── Frontend (src/)
  │   ├── React 19 components (functional, named exports)
  │   ├── Zustand stores (documentStore, workspaceStore)
  │   ├── Custom hooks (useWebSocket, useSearch, useWorkspaceChat)
  │   └── Types (TypeScript, Literal unions)
  └── Backend (server/)
      ├── FastAPI app factory (main.py)
      ├── Service container (services.py)
      ├── API routes (api/routes.py)
      ├── WebSocket endpoint (api/ws.py)
      └── Processing pipelines (pipelines/)

LLM (Ollama)
  ├── Classifiers (DocumentClassifier)
  ├── Extractors (DocumentExtractor, EntityExtractor)
  ├── Chat pipeline (WorkspaceChatPipeline)
  ├── Brief generator (WorkspaceBriefPipeline)
  └── Suggester (WorkspaceSuggester)

Data Layer
  ├── SQLite (brainfileing.db) — documents, workspaces, metadata
  ├── LanceDB (lancedb/) — vector embeddings for search
  ├── JSONL files (ui_documents.jsonl, move_history.jsonl)
  └── Staging directory (/tmp/agentic-docs/server-staging)

External Services
  ├── Ollama (localhost:11434/v1) — LLM inference
  ├── Whisper Server (ai-server2:8090) — audio transcription
  └── ai-server2 — GPU compute for Whisper
```

## Directory Structure

```
agentic-docs-handler/
├── server/                              # FastAPI backend (Python)
│   ├── api/                            # HTTP routes & WebSocket
│   │   ├── routes.py                   # REST endpoints (ingest, search, workspace CRUD)
│   │   └── ws.py                       # WebSocket per-client routing
│   ├── pipelines/                      # Core logic layer (NO imports from api or UI)
│   │   ├── process_pipeline.py         # Main ingestion orchestration
│   │   ├── classifier.py               # Document & image classification
│   │   ├── extractor.py                # Structured field extraction
│   │   ├── entity_extractor.py         # People, companies, dates, amounts
│   │   ├── search.py                   # Hybrid search (vectors + keywords)
│   │   ├── workspace_chat.py           # RAG chat over workspace docs
│   │   ├── workspace_brief.py          # AI-generated workspace summaries
│   │   ├── workspace_suggester.py      # Auto-suggest workspace assignment
│   │   ├── discovery.py                # File-to-file relationship discovery
│   │   ├── thumbnails.py               # Thumbnail generation
│   │   ├── file_organizer.py           # File organization (deprecated, workspace-based)
│   │   ├── noop_organizer.py           # Placeholder organizer
│   │   └── whisper_proxy.py            # Whisper transcription proxy
│   ├── clients/                        # External service clients
│   │   └── ollama_client.py            # Ollama API wrapper
│   ├── migrations/                     # Database schema & migrations
│   │   ├── schema.sql                  # SQLite DDL (all tables, FTS5)
│   │   └── jsonl_to_sqlite.py          # JSONL → SQLite migration
│   ├── prompts/                        # LLM system prompts (text files)
│   │   ├── classifier_system.txt
│   │   ├── image_classifier_system.txt
│   │   ├── extractors/*.txt            # Per-document-type extraction prompts
│   │   ├── entity_system.txt
│   │   ├── workspace_system.txt
│   │   ├── workspace_brief_system.txt
│   │   ├── workspace_suggest_system.txt
│   │   ├── search_rewrite_system.txt
│   │   └── search_answer_system.txt
│   ├── services.py                     # AppServices container (dependency injection)
│   ├── config.py                       # pydantic_settings.BaseSettings (ADH_* env vars)
│   ├── schemas.py                      # Pydantic models (API contracts)
│   ├── document_registry.py            # SQLite-backed document persistence
│   ├── workspace_registry.py           # Workspace CRUD operations
│   ├── engagement_tracker.py           # Document engagement tracking
│   ├── logging_config.py               # Structured logging (LLM logs, validation logs)
│   ├── realtime.py                     # Per-client WebSocket routing
│   └── tests/                          # Backend tests (pytest)
│
├── src/                                 # Tauri frontend (TypeScript/React 19)
│   ├── components/                     # React components (named exports)
│   │   ├── DocumentRow.tsx            # Document row in feed
│   │   ├── WorkspaceView.tsx          # Main workspace view
│   │   ├── WorkspaceSidebar.tsx       # Sidebar with workspaces
│   │   ├── ProcessingRail.tsx         # Document processing progress
│   │   ├── DiscoveryCards.tsx         # Related files in workspace
│   │   ├── WorkspaceNotebook.tsx      # AI-generated notes
│   │   ├── AiPresence.tsx             # AI assistant presence
│   │   ├── HomeChat.tsx               # Inbox/generic view chat
│   │   └── *.test.tsx                 # Colocated tests (vitest)
│   ├── hooks/                          # Custom hooks
│   │   ├── useWebSocket.ts            # Backend event handling
│   │   ├── useSearch.ts               # Search state & execution
│   │   ├── useWorkspaceChat.ts        # SSE workspace chat
│   │   ├── useSearchAiSummary.ts      # AI search summaries
│   │   └── useAiPresenceModel.ts      # AI assistant state
│   ├── store/                          # Zustand stores
│   │   ├── documentStore.ts           # Document state (documents, counts, search)
│   │   ├── workspaceStore.ts          # Workspace state (workspaces, selection)
│   │   └── *.test.ts
│   ├── lib/                            # Utility functions
│   │   ├── api.ts                     # Backend HTTP client
│   │   ├── document-mappers.ts        # Server → UI document mapping
│   │   ├── document-colors.ts         # Document color mapping
│   │   ├── mime.ts                    # MIME type handling
│   │   ├── status.ts                  # Status constants & helpers
│   │   ├── highlight-snippet.tsx      # Search result highlighting
│   │   ├── tauri-events.ts            # Tauri command bindings
│   │   └── feed-utils.ts              # Feed time grouping
│   ├── types/                          # Shared type definitions
│   │   ├── documents.ts               # Document types
│   │   └── workspace.ts               # Workspace types
│   ├── App.tsx                         # Root component (default export only)
│   ├── main.tsx                        # React entry point
│   ├── index.css                       # Tailwind + design tokens (CSS custom properties)
│   └── vite-env.d.ts                   # Vite type definitions
│
├── src-tauri/                           # Rust/Tauri shell
│   ├── src/
│   │   ├── main.rs                     # Tauri commands, app bootstrap
│   │   └── ws_client.rs                # Rust WebSocket bridge to backend
│   ├── Cargo.toml                      # Rust dependencies (Tauri 2.10, tokio, serde)
│   └── tauri.conf.json                 # Tauri configuration
│
├── whisper-server/                      # Whisper transcription service (separate repo)
│   ├── server.py                       # FastAPI Whisper server
│   └── requirements.txt
│
├── legacy/                              # Legacy/migrated code
│   └── mcp-docs-scaffold/              # MCP documentation scaffold (deprecated)
│
├── docs/                                # Project documentation
│   ├── validation/                     # Validation reports (JSONL)
│   ├── plans/                          # Implementation plans
│   └── specs/                          # Specification documents
│
├── CLAUDE.md                            # Project-specific AI instructions
├── CODE_STYLE.md                        # Coding conventions
├── .env.example                         # Environment variable template
├── .env                                 # Environment configuration (not in repo)
├── package.json                         # Node dependencies (frontend)
├── tsconfig.json                        # TypeScript config
├── tailwind.config.js                   # Tailwind CSS config
├── postcss.config.js                    # PostCSS config
└── pytest.ini                           # Pytest configuration
```

## Core Components

### Backend API Layer (server/api/)

- **routes.py**: REST endpoints
  - `POST /process` — Single ingest endpoint for all file types
  - `GET /documents`, `GET /documents/counts`
  - `GET /workspace/categories`
  - `GET /activity`
  - `POST /workspace/{workspace_id}/move`
  - `POST /workspace/{workspace_id}/unmoved`
  - `GET /validation/report`
  - `GET /search`, `POST /search/rewrite`
  - `POST /workspace/chat` (SSE)

- **ws.py**: WebSocket endpoint
  - Per-client routing by `client_id`
  - Events: `connection.ready`, `heartbeat`, `job.started`, `job.progress`, `job.completed`, `job.failed`, `file.moved`, `file.move_undone`, `move.dismissed`

### Processing Pipelines (server/pipelines/)

**Layer rule:** Pipelines never import from `api/` or UI layers.

**Text document flow:**
1. `process_pipeline.py` (orchestrator)
2. `classifier.py` — classify document type
3. `extractor.py` — extract structured fields (receipt, contract, invoice, meeting_notes, generic)
4. `entity_extractor.py` — extract people, companies, dates, amounts, places
5. `organizer.py` — assign to workspace (default: noop)
6. `search.py` — index into LanceDB (background)

**Image flow:**
1. `classifier.py` (vision classification via Ollama)
2. Same extraction pipeline as text
3. `thumbnails.py` — generate thumbnails for UI

**Audio flow:**
1. `whisper_proxy.py` — proxy to Whisper server (ai-server2:8090)
2. Transcribe audio
3. Text flows through classification → extraction → organization → index

**Workspace features:**
- `workspace_chat.py` — RAG chat over workspace documents (SSE)
- `workspace_brief.py` — AI-generated workspace summary
- `workspace_suggester.py` — Auto-suggest workspace assignment

**Search:**
- `search.py` — hybrid search (LanceDB vectors + SQLite FTS5 keywords)
- `search_rewrite_system.txt` — LLM rewrite query before search
- `search_answer_system.txt` — LLM generate answer from search results

### Tauri Shell (src-tauri/src/)

**Commands** (in `main.rs`):
- `get_client_id` — Get or create per-desktop-client UUID
- `get_backend_base_url` — Get backend URL (env var or localhost:9000)
- `reconnect_backend_ws` — Force WebSocket reconnection
- `show_in_folder(path)` — Show file in macOS Finder
- `move_local_file(from, to)` — Execute file move on disk
- `undo_local_file_move(from, to)` — Undo previous move
- `stage_local_upload(name, bytes)` — Stage upload to `/tmp/agentic-docs/uploads`
- `cleanup_staged_uploads(max_age_hours)` — Clean old staged uploads

**WebSocket bridge** (`ws_client.rs`):
- Rust WebSocket client to backend
- Auto-reconnect on disconnect
- Route backend events to renderer via Tauri events

### Frontend (src/)

**Components:**
- Functional React 19 components with named exports
- No default exports except `App.tsx`
- Props typed with inline `Props` types or exported `ComponentProps`

**Stores (Zustand):**
- `documentStore.ts` — documents, counts, search, client_id
- `workspaceStore.ts` — workspaces, selection, categories

**Hooks:**
- `useWebSocket.ts` — listen to backend events, update stores
- `useSearch.ts` — search execution, results, loading state
- `useWorkspaceChat.ts` — SSE stream handling for workspace chat
- `useSearchAiSummary.ts` — AI-generated search summaries

**Lib:**
- `api.ts` — HTTP client wrapper (fetch with typed responses)
- `document-mappers.ts` — map backend types to UI types

## Data Flow

### Ingestion (POST /process)

```
1. Tauri stages file at /tmp/agentic-docs/server-staging/<uuid>-<filename>
2. Frontend calls POST /process with staged path
3. Backend:
   a. classify document type (LLM classifier)
   b. extract fields (LLM extractor)
   c. extract entities (LLM entity_extractor)
   d. suggest workspace (LLM workspace_suggester)
   e. move to target workspace (or inbox)
   f. index into LanceDB (background)
   g. emit WebSocket events (job.started, job.progress, job.completed)
4. Frontend updates UI via WebSocket events
```

### Workspace Chat (POST /workspace/chat SSE)

```
1. User sends query
2. Frontend calls POST /workspace/chat with query
3. Backend:
   a. Retrieve workspace documents (LanceDB + FTS5)
   b. Build context (retrieved docs)
   c. Call LLM (workspace_chat) with context
   d. Stream SSE events: context, token, done, error
4. Frontend renders streaming response with source attribution
```

### Search (GET /search)

```
1. User enters query
2. LLM rewrites query (search_rewrite_system.txt)
3. Backend:
   a. Vector search in LanceDB (nomic-embed-text-v1.5)
   b. Keyword search in SQLite FTS5
   c. Hybrid rank results
   d. Filter by workspace/category
4. Frontend renders results with highlight snippets
```

## Database Schema

### Tables (from `server/migrations/schema.sql`)

- **document**: doc_id, url, title, document_type, workspace_id, status, text, metadata, created_at, updated_at
- **workspace**: id, name, description, ai_brief, ai_entities, ai_topics, cover_color, is_inbox, created_at, updated_at
- **file_relation**: id, file_a_id, file_b_id, relation_type, confidence, explanation, created_at
- **entity**: id, name, entity_type, UNIQUE(name, entity_type)
- **file_entity**: file_id, entity_id, context, PRIMARY KEY (file_id, entity_id)

**Indexes:**
- FTS5 indexes on document.text
- Workspace foreign key on document.workspace_id
- Entity junction on file_entity

## Configuration

**Environment variables** (prefixed `ADH_`):

- `ADH_OLLAMA_BASE_URL` — Ollama API endpoint (default: http://localhost:11434/v1)
- `ADH_OLLAMA_MODEL` — Default LLM model (default: qwen3.5:9b)
- `ADH_OLLAMA_MODEL_CLASSIFIER/EXTRACTOR/WORKSPACE_CHAT` — Per-pipeline model overrides
- `ADH_OLLAMA_NUM_CTX_WORKSPACE_CHAT` — Context window for chat (default: 16384)
- `ADH_SQLITE_DB_PATH` — SQLite database path (default: server/data/brainfileing.db)
- `ADH_LANCEDB_PATH` — LanceDB directory (default: server/data/lancedb)
- `ADH_PROMPTS_DIR` — LLM prompt directory (default: server/prompts)
- `ADH_EMBEDDING_MODEL_NAME` — Sentence transformer model (default: nomic-ai/nomic-embed-text-v1.5)
- `ADH_WHISPER_BASE_URL` — Whisper server (default: http://ai-server2:8090)
- `ADH_CORS_ALLOWED_ORIGINS` — CORS origins (default: ["*"])

## Build & Run

**Backend:**
```bash
# Setup
python3.14 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
cp .env.example .env

# Run
uvicorn server.main:app --host 0.0.0.0 --port 9000

# Tests
PYTHONPATH=. pytest server/tests -q
PYTHONPATH=. pytest server/tests/test_workspace_chat.py -q  # Focused
```

**Frontend:**
```bash
npm install
npm run dev  # Vite dev server (port 1420)
npm run test  # Vitest
npm run build  # Type-check + build
```

**Tauri:**
```bash
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

**Full verification before shipping:**
```bash
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

## Key Design Decisions

1. **Single ingest endpoint**: All files (text, image, audio) go through `POST /process`. Backend determines type and routing.

2. **Pipeline layering**: `pipelines/` is the core logic layer. No imports from `api/` or UI.

3. **LLM via text prompts**: All LLM behavior driven by prompt files in `server/prompts/`. Qwen 3.5 uses raw text output (JSON object format fails).

4. **Workspace-centric organization**: Workspaces are the primary container. Files in inbox → AI-suggest workspace → move.

5. **Per-client WebSocket routing**: Backend routes events by `client_id`, no broadcast.

6. **Local-first**: Everything runs locally on Mac. Ollama on localhost. Whisper on ai-server2 for GPU.

7. **Hybrid search**: Vector search (LanceDB) + keyword search (FTS5) with LLM query rewrite and answer generation.

8. **Streaming chat**: Workspace chat uses SSE streaming with `context`, `token`, `done`, `error` events.

9. **Type-safe contracts**: Pydantic models for API contracts. No JSON round-trip data loss.

10. **Design token system**: CSS custom properties in `index.css`. Never hardcode colors.

## Migration Path

The current app is migrating from "Agentic Doc Handler" to "Brainfileing". Workspaces and workspace features are being added to the existing document management system.
