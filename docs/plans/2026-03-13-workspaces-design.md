# Workspaces — Scoped AI Chat

**Date:** 2026-03-13
**Status:** Design approved

## Vision

Users interrogate document categories as isolated databases. "Ask your 15 receipts what the total VAT is." A second app mode alongside the Activity Feed — premium, tactical, analyst-notebook UX.

## Architecture

### Backend

**New pipeline:** `server/pipelines/workspace_chat.py`

```
POST /workspace/chat → SSE stream

Input:  { category, message, history[] }
Flow:
  1. Pull extracted fields for all docs in category from DocumentRegistry
     → Structured table: [vendor, amount, vat_amount] × N
  2. RAG search filtered by document_type (LanceDB WHERE clause)
     → Relevant text chunks for grounding
  3. Build prompt: system + structured fields table + RAG chunks + conversation history + user message
  4. Stream Ollama response via SSE (StreamingResponse)
```

**New endpoints:**
- `GET /workspace/categories` — categories with counts and field summaries
- `POST /workspace/chat` — SSE-streamed chat scoped to a category

**Pipeline rules:**
- `workspace_chat.py` imports from `search.py` (filtered search) and `document_registry.py` (extracted fields)
- Never imports from `api/` or `mcp/`
- Ollama streaming via `AsyncOllamaClient` (new streaming method)

**Context assembly strategy:**
- Extracted fields as a structured markdown table (primary data source for aggregation)
- RAG chunks for grounding and detail (secondary, for specific document questions)
- Conversation history (last N turns, capped to stay within context window)
- System prompt in Swedish, tuned for aggregation and document analysis

### Frontend

**State additions to `documentStore.ts`:**
```typescript
viewMode: "activity" | "workspaces"
activeWorkspace: string | null          // category key e.g. "receipt"
conversations: Record<string, WorkspaceConversation>
```

```typescript
interface WorkspaceConversation {
  entries: NotebookEntry[]
  isStreaming: boolean
  streamingText: string
}

interface NotebookEntry {
  id: string
  query: string
  response: string
  timestamp: string
  sourceCount: number
}
```

Session-persistent: lives in Zustand, survives mode switches, resets on app restart.

**New components:**

| Component | Purpose |
|---|---|
| `ModeToggle` | Segmented control in Sidebar header (Activity / Analys) |
| `WorkspaceGrid` | Category cards in main area — glass panels, type color, count |
| `WorkspaceCard` | Single category card — clickable, shows count + icon |
| `WorkspaceNotebook` | Notebook view per category — entries + input |
| `NotebookEntry` | Single Q→A block — query line + streamed response |
| `NotebookInput` | "Ask your Kvitton anything..." input with submit |

**No new components needed:** `Sidebar`, `DetailPanel`, `ProcessingRail` all remain as-is.

### UX Contract

- No chat bubbles, no avatars, no iMessage styling
- Log/notebook aesthetic: query as muted monospace line, response as clean prose
- Structured data (amounts, dates, totals) rendered in `data-pill` or `control-card` styling
- Streaming via ghost-typing (character-by-character append)
- Thin separator between Q&A blocks
- Back navigation from notebook to workspace grid
- Category cards show type-color accent, document count, category label

### Notebook entry layout

```
▸ {user query}                              ← monospace, text-muted

{streamed AI response}                      ← text-primary, proportional
┌─ SAMMANFATTNING ─────────────────────┐
│  Total moms: 4 312,50 kr            │    ← data-pill styling
│  Genomsnitt:   287,50 kr            │
└──────────────────────────────────────┘
Källa: 15/15 kvitton analyserade            ← text-muted, small

─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─     ← thin dashed separator
```

### SSE Streaming

Frontend uses `EventSource` or `fetch` + `ReadableStream` for SSE.

SSE event format:
```
event: token
data: {"text": "Baserat"}

event: token
data: {"text": " på"}

event: done
data: {"source_count": 15}
```

### Ollama Concurrency

Concurrency is 1. Chat queues behind active processing jobs. Mitigations:
- Show "AI-motor upptagen..." indicator if request is queuing
- Future: second Ollama instance on separate port for chat

## File Locations

**Backend (new):**
- `server/pipelines/workspace_chat.py` — chat pipeline
- `server/prompts/workspace_system.txt` — system prompt

**Backend (modified):**
- `server/pipelines/search.py` — add `document_type` filter parameter to `search()`
- `server/api/routes.py` — add workspace endpoints
- `server/main.py` — wire workspace pipeline into app

**Frontend (new):**
- `src/components/ModeToggle.tsx`
- `src/components/WorkspaceGrid.tsx`
- `src/components/WorkspaceCard.tsx`
- `src/components/WorkspaceNotebook.tsx`
- `src/components/NotebookEntry.tsx`
- `src/components/NotebookInput.tsx`

**Frontend (modified):**
- `src/store/documentStore.ts` — workspace state slice
- `src/components/Sidebar.tsx` — add ModeToggle
- `src/components/App.tsx` — conditional render based on viewMode
- `src/lib/api.ts` — workspace API calls
- `src/types/documents.ts` — workspace types

## Decisions

- **Conversation persistence:** Session-only (Zustand). Resets on app restart. Upgrade to persisted later if needed.
- **Streaming transport:** SSE via fetch + ReadableStream (not WebSocket — chat is request-response).
- **Context strategy:** Structured extracted fields table + filtered RAG chunks. Fields are primary for aggregation queries.
- **No new search index:** Reuse existing LanceDB table with document_type filter. No separate per-category index.
- **ProcessingRail stays visible** in workspaces mode — user needs to see active jobs regardless of mode.
