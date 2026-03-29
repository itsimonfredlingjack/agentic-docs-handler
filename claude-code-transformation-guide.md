# Linear for Files — Transformation Guide for Claude Code

## Context

We're transforming an existing Tauri 2 + React 19 document handler ("Agentic Doc Handler") into "Linear for Files" (working name: Brainfileing) — a workspace-centric AI file management app. The existing backend has strong infrastructure we want to keep. The frontend needs a full UX rebuild. The data model needs workspace tables added.

This document is a conversation starter and architectural map, not a rigid spec. Brainstorm freely about implementation details, challenge assumptions, and suggest better approaches when you see them. But keep the overall direction: **workspaces are the unit, not files.**

---

## The Product in One Paragraph

Users dump files into the app — PDFs, images, Word docs, markdown, anything. The app organizes them into workspaces (project-like containers). Each workspace has an AI-generated overview that tells you what's in it, who's mentioned, what the key dates and topics are. You never organize manually. You open a workspace and instantly understand what you have. You search by meaning, not filename. The app surfaces things you forgot you had.

---

## What We're Keeping (don't break these)

### Backend infrastructure (all working, all staying)
- **FastAPI on localhost:9000** — app factory, service wiring in `server/main.py`
- **Ollama integration** — configurable models via `ADH_` env vars
- **LanceDB + sentence-transformers** — vector storage and embeddings
- **Processing pipeline pattern** — `server/pipelines/` is the core logic layer
- **Hybrid search** — `server/pipelines/search.py`
- **Workspace chat (SSE)** — `server/pipelines/workspace_chat.py` — this already does RAG over documents, streams answers. This IS the "ask your workspace AI" feature.
- **Thumbnail generation** — `server/pipelines/thumbnails.py`
- **WebSocket events** — per-client routing in `server/realtime.py`, events like `job.started`, `job.progress`, `job.completed`
- **Whisper proxy** — transcription via ai-server2:8090
- **Layer rule** — `server/pipelines/` never imports from `server/api/` or UI

### Tauri shell (working, staying)
- `src-tauri/src/main.rs` — commands and bootstrap
- `src-tauri/src/ws_client.rs` — Rust WebSocket bridge
- Tauri commands: `get_client_id`, `get_backend_base_url`, `reconnect_backend_ws`

### Code style (keep all conventions from CODE_STYLE.md)
- Literal unions, not enums
- Keyword-only args in Python
- Pydantic BaseModel for API, dataclass(slots=True) for internals
- Named exports in React
- ADH_ env prefix

### Color theme
- Keep the existing color palette. Don't change the dark theme colors. UX layout changes are welcome, color scheme stays.

---

## What's Changing

### 1. Data Model — Add workspaces as the organizing concept

The current model is a flat document list. We need to add:

**New tables:**

```sql
-- Workspaces (the core new concept)
CREATE TABLE workspace (
    id TEXT PRIMARY KEY,           -- uuid
    name TEXT NOT NULL,
    description TEXT DEFAULT '',   -- user-editable
    ai_brief TEXT DEFAULT '',      -- AI-generated summary of all files in workspace
    ai_entities TEXT DEFAULT '[]', -- JSON: extracted people, companies, dates, amounts
    ai_topics TEXT DEFAULT '[]',   -- JSON: key themes
    cover_color TEXT DEFAULT '',   -- for sidebar visual identity
    is_inbox INTEGER DEFAULT 0,   -- exactly one workspace is the inbox
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- File-to-file relationships (for discovery)
CREATE TABLE file_relation (
    id TEXT PRIMARY KEY,
    file_a_id TEXT NOT NULL,
    file_b_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,   -- 'duplicate' | 'version' | 'related' | 'contradicts' | 'references'
    confidence REAL DEFAULT 0.0,
    explanation TEXT DEFAULT '',   -- AI-generated: "Both mention contract §4.2 but disagree on deadline"
    created_at TEXT NOT NULL
);

-- Extracted entities (people, companies, etc.)
CREATE TABLE entity (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,            -- normalized: "Anders Johansson"
    entity_type TEXT NOT NULL,     -- 'person' | 'company' | 'date' | 'amount' | 'place' | 'topic'
    UNIQUE(name, entity_type)
);

-- Junction: which entities appear in which files
CREATE TABLE file_entity (
    file_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    context TEXT DEFAULT '',       -- the sentence where entity appears
    PRIMARY KEY (file_id, entity_id)
);
```

**Modify existing document/file table:**
- Add `workspace_id TEXT` (FK → workspace, nullable = inbox)
- Add `ai_summary TEXT` (one-paragraph summary)
- Add `ai_title TEXT` (AI-suggested human-readable title)
- Add `ai_type TEXT` (contract, receipt, letter, photo, note, etc.)
- Add `ai_entities TEXT` (JSON: entities found in this file)
- Add `ai_topics TEXT` (JSON: key themes)
- Keep all existing fields that still apply

**One inbox workspace** is auto-created on first run. Files without a confident workspace assignment land here.

### 2. Backend Pipeline — Extend, don't rewrite

The existing pipeline flow is: classify → extract → organize → index.

The new flow adds workspace awareness:

```
File arrives (via POST /process or drag-drop)
  → detect file type (existing)
  → extract text / OCR / vision (existing, keep all paths)
  → classify document type (existing classifier, extend output)
  → extract entities: people, companies, dates, amounts, topics (NEW)
  → suggest workspace (NEW — which workspace does this file belong to?)
  → generate file summary (NEW — one paragraph about this file)
  → generate embeddings (existing)
  → index in LanceDB (existing)
  → store all metadata in SQLite (existing, extended schema)
  → update workspace brief if workspace changed (NEW, background)
```

**New pipeline modules needed:**

`server/pipelines/entity_extractor.py`
- Input: extracted text from a file
- Output: structured JSON of entities (people, companies, dates, amounts, places, topics)
- Uses the configured Ollama model with structured output prompt
- Store entities in entity + file_entity tables

`server/pipelines/workspace_suggester.py`
- Input: file metadata + summary + entities
- Output: suggested workspace_id + confidence score
- Compares file content against existing workspace briefs/topics
- If confidence < threshold → inbox
- Could use embedding similarity against workspace centroids

`server/pipelines/file_summarizer.py`
- Input: extracted text (or image for VLM)
- Output: one-paragraph summary, suggested title, document type
- This might already be partially covered by the existing extractor — brainstorm whether to merge or keep separate

`server/pipelines/workspace_brief.py`
- Input: all file summaries in a workspace
- Output: workspace-level AI brief (what is this project about, key entities, key topics)
- Triggered when files are added/removed from workspace
- Runs in background, updates workspace.ai_brief

`server/pipelines/discovery.py` (Phase 5, not MVP)
- Detect duplicates (SHA-256 hash match + embedding cosine similarity)
- Detect versions (same-ish content, different timestamps)
- Detect relations (shared entities, similar topics)
- Detect contradictions (conflicting claims about same entity/topic)
- Output: file_relation records

### 3. API — Extend routes

**New endpoints needed:**

```
# Workspace CRUD
GET    /workspaces                  → list all workspaces with file counts
POST   /workspaces                  → create workspace
GET    /workspaces/:id              → workspace detail with AI brief
PUT    /workspaces/:id              → update workspace (name, description, color)
DELETE /workspaces/:id              → delete workspace (files go to inbox)

# Workspace files
GET    /workspaces/:id/files        → files in workspace (with AI metadata)
POST   /workspaces/:id/files/move   → move files between workspaces

# Workspace AI
POST   /workspaces/:id/brief        → regenerate workspace AI brief
GET    /workspaces/:id/entities      → entities found across workspace files
GET    /workspaces/:id/discovery     → discovery insights for this workspace

# Existing endpoints to modify:
POST   /process                      → add workspace_id param (optional, defaults to inbox)
GET    /search                       → add workspace_id filter param
POST   /workspace/chat               → already exists! scope to workspace_id
```

### 4. Frontend — Rebuild the UX

**This is the biggest change.** The current UI is a document list/handler. The new UI is a workspace-centric app inspired by Linear.

**Layout structure:**

```
┌──────────────────────────────────────────────────────┐
│  Sidebar (240px)  │  Main Content                    │
│                   │                                  │
│  [App Logo]       │  ┌─ Workspace Header ──────────┐ │
│                   │  │ Name, AI Brief, Stats        │ │
│  ── Inbox (3) ──  │  │ Entity tags, Topics          │ │
│                   │  └──────────────────────────────┘ │
│  Workspaces:      │                                  │
│  📁 Legal Case    │  ┌─ File Grid/List ─────────────┐ │
│  📁 Tax 2025      │  │ [Card] [Card] [Card]         │ │
│  📁 Server Proj   │  │ [Card] [Card] [Card]         │ │
│  📁 Receipts      │  │                              │ │
│                   │  └──────────────────────────────┘ │
│  + New Workspace  │                                  │
│                   │  ┌─ Discovery Cards (if any) ───┐ │
│  ── Settings ──   │  │ "3 files seem related"       │ │
│                   │  │ "Possible duplicate found"   │ │
│                   │  └──────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

**Key components to build:**

`WorkspaceSidebar` — Left panel. Lists workspaces with name, color dot, file count. Inbox always at top. Click to navigate. Dragging a file onto a workspace moves it there.

`WorkspaceView` — Main content when a workspace is selected. Has two sections:
  - `WorkspaceHeader` — Name (editable), AI brief (collapsible), entity pills, topic tags, stats (file count, last updated). This is the "open a project and understand it in 10 seconds" moment.
  - `FileGrid` / `FileList` — Switchable views. Cards show: thumbnail, AI title (not filename), type badge, one-line summary, entity tags. List shows: more compact rows with same info.

`FileCard` — Rich card for grid view. Thumbnail, AI-generated title, type badge (contract/receipt/note/photo), one-line summary, entity pills. Click to open detail panel or preview.

`InboxView` — Special workspace view. Files here have a "Suggested workspace: [X]" badge. One-click to accept suggestion. Bulk select + move.

`CommandPalette` — ⌘K opens it. Search files, navigate workspaces, run actions. Use cmdk library.

`SearchView` — Full search results. Hybrid results with excerpts and relevance. Scoped to current workspace or global toggle.

`FileDetailPanel` — Right panel or overlay when clicking a file. Full metadata, AI summary, extracted entities, file preview, related files. Also where you can ask the workspace AI about this specific file.

**State management:**

Refactor `documentStore.ts` into workspace-centric stores:

```
src/store/
  workspaceStore.ts    — active workspace, workspace list, CRUD
  fileStore.ts         — files for current workspace, file operations
  searchStore.ts       — search state, results
  uiStore.ts           — sidebar open/closed, active view mode, panels
```

### 5. What to tackle in what order

**This is a suggested sequence. Brainstorm if there's a better order.**

**Step 1: Data model + workspace CRUD (backend-first)**
- Add workspace table and modify document table
- Workspace API endpoints (CRUD)
- Auto-create inbox workspace
- Everything still works without frontend changes — existing documents just have workspace_id = null (inbox)

**Step 2: New layout shell (frontend)**
- Sidebar + main content area
- WorkspaceSidebar with workspace list (from new API)
- Basic WorkspaceView showing files in selected workspace
- Keep existing color theme
- Command palette skeleton

**Step 3: File cards + AI metadata display**
- Redesign file display (DocumentRow → FileCard)
- Show AI summary, type badge, entity tags on cards
- Grid and list view toggle

**Step 4: Entity extraction pipeline**
- New entity_extractor pipeline
- Store in entity + file_entity tables
- Show in workspace header and file cards

**Step 5: Workspace AI brief**
- workspace_brief pipeline
- Auto-generate when files change
- Show in WorkspaceHeader

**Step 6: Inbox + workspace suggestion**
- workspace_suggester pipeline
- Inbox special view with suggestion badges
- Move-to-workspace flow

**Step 7: Search refinement**
- Workspace-scoped search
- Command palette search integration
- Hybrid results with excerpts

**Step 8: Discovery** (later phase)
- file_relation detection
- Discovery cards in workspace view

---

## Resolved: AI Models & Architecture

### Mac-local is the default

The existing app proves Mac M4 handles Ollama workloads fine for single-file processing. **The GPU servers are NOT required for the core pipeline.** This simplifies the architecture significantly:

- **Mac M4 (localhost):** Runs Ollama with Qwen 3.5 + nomic-embed-text. Handles classify → extract → summarize → embed for individual files. This is the primary inference path.
- **AI Server 1 (RTX 4070):** Only needed for Whisper transcription and heavy batch jobs (indexing 500+ files at once, bulk re-processing). NOT in the critical path for normal usage.
- **AI Server 2 (RTX 2060):** Whisper endpoint (already deployed). Could mirror embedding model for batch parallel processing but not needed for MVP.

### Model choices (decided)

| Role | Model | Where it runs | Notes |
|------|-------|--------------|-------|
| Classification, summarization, entity extraction | **Qwen 3.5** (via Ollama) | Mac M4 | Already proven in current app. Vision-capable variants handle images/scanned PDFs directly. |
| Workspace suggestion, brief generation | **Qwen 3.5** (same instance) | Mac M4 | Same model, different prompts. No need for a separate model. |
| Embeddings | **nomic-ai/nomic-embed-text-v1.5** | Mac M4 (CPU via sentence-transformers) | Already running. 768 dims, multilingual, handles Swedish+English. No reason to change. |
| Audio transcription | **Whisper** (faster-whisper) | AI Server 2 (RTX 2060) | Already deployed at ai-server2:8090. Keep as-is. |
| OCR fallback | **Qwen 3.5 VL** (vision) | Mac M4 | VLM approach replaces need for Surya/Tesseract for most cases. Only consider Surya if batch-OCR of hundreds of scanned docs becomes a need. |

### What this means for architecture

The architecture diagram simplifies. The Mac is self-contained for normal operation:

```
┌──────────────────────────────────┐
│   Mac M4 — Tauri App + Backend   │
│                                  │
│  Tauri UI (React 19)             │
│       ↕                          │
│  FastAPI (localhost:9000)         │
│  ├── Ollama (localhost:11434)    │
│  │   └── Qwen 3.5               │
│  ├── sentence-transformers       │
│  │   └── nomic-embed-text       │
│  ├── LanceDB (vector store)     │
│  └── SQLite (metadata + FTS5)   │
└──────────┬───────────────────────┘
           │ Only for Whisper + batch jobs
           │ (Tailscale)
    ┌──────┴──────────────────┐
    │  AI Server 2 (RTX 2060) │
    │  └── Whisper endpoint   │
    └─────────────────────────┘
```

GPU Server 1 (RTX 4070) becomes optional — use it for batch processing if/when needed, but it's not in the critical path.

---

## Open Questions (brainstorm these)

1. **File storage model:** The blueprint says "files stay on disk, app indexes in place." The current app stages files under `/tmp/agentic-docs/server-staging`. Do we keep the staging model or switch to index-in-place? Both have tradeoffs. Staging gives the app full control. Index-in-place means zero copying but needs robust file watching.

2. **Workspace suggestion mechanism:** Embedding similarity against workspace centroids? LLM classification with workspace names/descriptions as context? Simpler keyword matching? What's fast and accurate enough given Qwen 3.5 runs locally?

3. **Workspace brief generation:** Aggregate file summaries and run through LLM? Or build brief from entity/topic overlap? How often to regenerate? (Likely: regenerate on file add/remove, debounced.)

4. **The existing file_organizer (YAML rules):** Does this concept survive in the workspace world? Workspaces might replace rule-based organization entirely. Or YAML rules could map to "auto-assign to workspace X when conditions match." Brainstorm which is simpler.

5. **Existing workspace chat:** `server/pipelines/workspace_chat.py` already does RAG + streaming. How does this integrate with the new workspace view? Sidebar panel? Dedicated chat view? Or embedded in workspace header?

---

## Non-Goals (for this transformation)

- Don't change Tauri to Electron (or vice versa)
- Don't change the color theme
- Don't add mobile, cloud sync, or multi-user
- Don't rebuild the WebSocket infrastructure
- Don't replace Ollama with something else
- Don't replace LanceDB with something else

---

## Success Criteria

**Minimum:** Open the app → see workspaces in sidebar → click one → see files with AI summaries → search and find things. That's the MVP. If this feels like "Linear for Files" and not like "a reskinned document handler," we've succeeded.
