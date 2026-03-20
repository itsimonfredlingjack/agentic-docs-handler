# Architecture Overview

**Agentic Docs Handler** is a local AI-powered document processing system. Users drop files into a Tauri desktop app, the FastAPI backend classifies and extracts data with Qwen via Ollama, files are organized through YAML rules, and documents are indexed for hybrid RAG search.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Shell | Tauri 2 + Rust |
| Frontend | React 19 + TypeScript + Tailwind CSS + Zustand |
| Backend API | FastAPI (Python 3.14+) |
| LLM Inference | Ollama (Qwen models) |
| Transcription | Whisper (deployed to ai-server2) |
| Vector Search | LanceDB + sentence-transformers |
| MCP | FastMCP mounted at `/mcp` |

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Mac (Desktop)                           │
│  ┌──────────────────┐    ┌──────────────────────────────────┐  │
│  │  Tauri 2 Shell   │    │   React 19 Renderer (Vite)       │  │
│  │  (Rust)          │───▶│   src/                           │  │
│  │  src-tauri/      │    │   - Zustand store                │  │
│  │  - WS bridge     │    │   - Tailwind CSS                 │  │
│  └────────┬─────────┘    └──────────────┬───────────────────┘  │
│           │ WS :9000/ws                  │ HTTP :9000           │
└───────────┼──────────────────────────────┼──────────────────────┘
            │                              │
            ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ai-server (FastAPI :9000)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ API Routes  │  │ Pipelines    │  │ MCP /mcp             │   │
│  │ /process    │─▶│ classifier   │  │ - read_tools         │   │
│  │ /search     │  │ extractor    │  │ - write_tools        │   │
│  │ /workspace  │  │ file_organizer│  │ - chatgpt_tools      │   │
│  └─────────────┘  │ search       │  └──────────────────────┘   │
│                   └──────┬───────┘                              │
│                          │                                      │
│  ┌───────────────────────┼──────────────────────────────────┐  │
│  │ Services              │                                  │  │
│  │ - Ollama Client ──────┼──▶ localhost:11434               │  │
│  │ - LanceDB             │                                  │  │
│  │ - Document Registry   │                                  │  │
│  │ - Whisper Proxy ──────┼──▶ ai-server2:8090               │  │
│  └───────────────────────┴──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
agentic-docs-handler/
├── src/                      # React 19 frontend
│   ├── components/           # 28 UI components (DocumentRow, DetailPanel, etc.)
│   ├── hooks/                # Custom hooks (useWebSocket, useSearch, useWorkspaceChat)
│   ├── lib/                  # Utilities (api.ts, status.ts, feed-utils.ts)
│   ├── store/                # Zustand state (documentStore.ts - single source of truth)
│   ├── types/                # TypeScript type definitions
│   └── templates/            # UI templates
│
├── src-tauri/                # Tauri 2 desktop shell
│   ├── src/
│   │   ├── main.rs           # Tauri commands (get_client_id, reconnect_backend_ws)
│   │   └── ws_client.rs      # Rust WebSocket bridge
│   ├── capabilities/         # Tauri security capabilities
│   └── tauri.conf.json       # Tauri configuration
│
├── server/                   # FastAPI backend
│   ├── main.py               # App factory, service wiring
│   ├── config.py             # Environment configuration (ADH_* vars)
│   ├── schemas.py            # Pydantic models for API contracts
│   ├── document_registry.py  # UI read model persistence (JSONL)
│   ├── realtime.py           # Per-client WebSocket routing
│   ├── file_rules.yaml       # YAML-driven file organization rules
│   │
│   ├── api/                  # HTTP/WebSocket routes
│   │   ├── routes.py         # Main REST endpoints
│   │   └── ws.py             # WebSocket endpoint
│   │
│   ├── pipelines/            # Core processing logic (ISOLATED LAYER)
│   │   ├── process_pipeline.py    # Main orchestrator
│   │   ├── classifier.py          # Document/image classification via Ollama
│   │   ├── extractor.py           # Structured field extraction
│   │   ├── search.py              # Hybrid search with LanceDB
│   │   ├── file_organizer.py      # YAML-driven file moves
│   │   ├── thumbnails.py          # Thumbnail generation
│   │   ├── workspace_chat.py      # Workspace context + streamed answers
│   │   └── whisper_proxy.py       # Proxy to Whisper server
│   │
│   ├── mcp/                  # Model Context Protocol for ChatGPT
│   │   ├── app.py            # FastMCP mount
│   │   ├── services.py       # Shared MCP service container
│   │   ├── read_tools.py     # Search, fetch, preview tools
│   │   ├── write_tools.py    # File organization tools
│   │   ├── chatgpt_tools.py  # ChatGPT upload/write-guard tools
│   │   ├── chatgpt_sessions.py    # Session tracking + TTL cleanup
│   │   ├── chatgpt_file_ingest.py # ChatGPT file download
│   │   └── chatgpt_widget_resource.py  # Widget resource wiring
│   │
│   ├── clients/              # External service clients
│   │   └── ollama_client.py  # Async Ollama client with concurrency control
│   │
│   ├── prompts/              # LLM prompt templates
│   │   ├── classifier_system.txt
│   │   ├── image_classifier_system.txt
│   │   ├── workspace_system.txt
│   │   └── extractors/       # Per-document-type extraction prompts
│   │
│   ├── data/                 # Persistent data
│   │   ├── lancedb/          # Vector database
│   │   ├── ui_documents.jsonl
│   │   └── move_history.jsonl
│   │
│   └── tests/                # pytest test suite
│       ├── fixtures/         # Test data files
│       └── test_*.py         # Test modules
│
├── whisper-server/           # Standalone Whisper transcription node
│   ├── whisper_server.py     # FastAPI server on port 8090
│   └── requirements.txt      # Whisper dependencies
│
├── apps/chatgpt-widget/      # Pre-built ChatGPT widget bundle
│   └── dist/                 # Checked-in widget.js and widget.css
│
├── scripts/                  # Deployment scripts
│   ├── deploy_ai_server.sh   # Deploy backend to ai-server
│   └── deploy_whisper_server.sh  # Deploy Whisper to ai-server2
│
├── docs/                     # Planning and validation docs
├── legacy/                   # Archived scaffold code
└── dist/                     # Production frontend build
```

## Core Components

### 1. Document Processing Pipeline

**Entry Point**: `POST /process`

```
File Upload
    │
    ▼
┌─────────────────┐
│ Detect Modality │ ──▶ text / image / audio
└────────┬────────┘
         │
    ┌────┴────┬──────────────┐
    ▼         ▼              ▼
  TEXT      IMAGE          AUDIO
    │         │              │
    ▼         ▼              ▼
 Extract    Vision       Whisper
  Text      Classify    Transcribe
    │         │              │
    └────┬────┴──────────────┘
         ▼
┌─────────────────┐
│   Classify      │ ──▶ document_type, title, summary, tags
│   (Ollama)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Extract       │ ──▶ Structured fields per document type
│   (Ollama)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Organize      │ ──▶ Plan/execute file move via YAML rules
│ (file_rules.yaml)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Index         │ ──▶ LanceDB + sentence-transformers (background)
│   (Search)      │
└─────────────────┘
```

**Key Files**:
- `server/pipelines/process_pipeline.py` - Main orchestrator (~40KB)
- `server/pipelines/classifier.py` - Text and image classification
- `server/pipelines/extractor.py` - Field extraction
- `server/pipelines/file_organizer.py` - YAML-driven file moves

### 2. Search Pipeline

Hybrid search combining:
- **Semantic search**: LanceDB with nomic-embed-text-v1.5 embeddings
- **Chunking**: 900-char chunks with 120-char overlap

**Key Files**:
- `server/pipelines/search.py` - SearchPipeline, embedder, chunking

### 3. Workspace Chat

RAG-powered chat over indexed documents:
1. Retrieve relevant chunks via semantic search
2. Assemble context with category filtering
3. Stream response from Ollama via SSE

**Key Files**:
- `server/pipelines/workspace_chat.py`
- `server/api/routes.py` - `/workspace/chat` SSE endpoint

### 4. MCP Integration

Model Context Protocol server for ChatGPT Developer Mode:
- Mounted at `/mcp` within the same FastAPI process
- Tools for search, fetch, classify, extract, transcribe
- Write-guard for file organization (preview → confirm pattern)
- Widget resource: `ui://widget/docs-console-v1.html`

**Key Files**:
- `server/mcp/app.py` - FastMCP mounting
- `server/mcp/read_tools.py` - Read-only tools
- `server/mcp/write_tools.py` - Mutating tools
- `server/mcp/chatgpt_tools.py` - ChatGPT-specific tools

### 5. Realtime Events

Per-client WebSocket routing for:
- `job.started`, `job.progress`, `job.completed`, `job.failed`
- `file.moved`, `file.move_undone`

**Key Files**:
- `server/realtime.py` - ConnectionManager
- `server/api/ws.py` - WebSocket endpoint
- `src-tauri/src/ws_client.rs` - Rust WS bridge

## Data Flow

### Document Ingestion

```
User drops file
    │
    ▼
Tauri desktop app
    │
    ▼
POST /process (HTTP)
    │
    ▼
Backend classifies, extracts, plans move
    │
    ├────────────────────────────┐
    │                            │
    ▼                            ▼
HTTP Response              Background Task
(classify + extract)       (index to LanceDB)
    │
    ▼
UI updates via WebSocket events
```

### Search Flow

```
GET /search?query=...
    │
    ▼
SearchPipeline.search()
    │
    ├─▶ Embed query (sentence-transformers)
    │
    ├─▶ LanceDB vector search
    │
    └─▶ Return ranked results with snippets
```

### ChatGPT MCP Flow

```
ChatGPT calls MCP tool
    │
    ▼
POST /mcp (within FastAPI)
    │
    ▼
Tool handler (read_tools / write_tools / chatgpt_tools)
    │
    ├─▶ Read: search, fetch, preview
    │
    └─▶ Write: preview_organize → confirm_organize
```

## Layering Rules

| Layer | May Import From | Must NOT Import From |
|-------|-----------------|---------------------|
| `server/pipelines/` | `server/clients/`, `server/schemas.py` | `server/api/`, `server/mcp/` |
| `server/api/` | `server/pipelines/`, `server/schemas.py` | - |
| `server/mcp/` | `server/pipelines/`, `server/schemas.py` | - |
| `src/` (React) | HTTP to backend, no direct imports | Backend Python code |

## External Integrations

| Service | Endpoint | Purpose |
|---------|----------|---------|
| Ollama | `localhost:11434` or `ADH_OLLAMA_BASE_URL` | LLM inference (Qwen) |
| Whisper | `ai-server2:8090` | Audio transcription |
| LanceDB | Local filesystem | Vector storage |

## Configuration

Environment variables (prefix: `ADH_`):

| Variable | Default | Description |
|----------|---------|-------------|
| `ADH_OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama API endpoint |
| `ADH_OLLAMA_MODEL` | `qwen3.5:9b` | Default model |
| `ADH_OLLAMA_MODEL_CLASSIFIER` | (falls back) | Classifier-specific model |
| `ADH_OLLAMA_MODEL_EXTRACTOR` | (falls back) | Extractor-specific model |
| `ADH_OLLAMA_MODEL_WORKSPACE_CHAT` | (falls back) | Workspace chat model |
| `ADH_WHISPER_BASE_URL` | `http://ai-server2:8090` | Whisper server |
| `ADH_LANCEDB_PATH` | `server/data/lancedb` | Vector DB location |
| `ADH_MCP_ENABLED` | `true` | Enable MCP server |
| `ADH_MCP_MOUNT_PATH` | `/mcp` | MCP endpoint path |

See `.env.example` for full configuration options.

## Build & Deploy

### Local Development

```bash
# Backend
uvicorn server.main:app --host 0.0.0.0 --port 9000

# Frontend (Vite dev)
npm run dev

# Desktop (Tauri)
npm run tauri dev
```

### Deploy to ai-server

```bash
bash scripts/deploy_ai_server.sh
# Syncs code via rsync, starts in tmux session 'adh-phase3'
```

### Deploy Whisper to ai-server2

```bash
bash scripts/deploy_whisper_server.sh
# Creates .venv-whisper, starts in tmux session 'adh-whisper'
```

## Testing

```bash
# Backend tests
PYTHONPATH=. pytest server/tests -q

# Frontend tests
npm test

# Full verification
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```
