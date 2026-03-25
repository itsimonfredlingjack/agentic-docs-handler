# Workspace Chat Context Redesign

**Date:** 2026-03-25
**Status:** Approved
**Scope:** `server/pipelines/workspace_chat.py` + tests

## Problem

The workspace chat pipeline (`prepare_context`) builds context by dumping up to 200 documents into a markdown field table, adding 8 RAG snippets, conversation history, and a system prompt — all competing for a 16K token context window (`ollama_num_ctx_workspace_chat=16384`). There is no token budgeting, no relevance filtering on the field table, and no overflow protection.

A 200-row markdown table with 5+ columns can consume 8-10K tokens alone, leaving little room for RAG, history, and the user's actual question. This risks truncated or degraded responses from the 9B model.

## Solution: RAG-First Context with Token Budget

Replace the "dump all documents" approach with a RAG-first strategy where search results drive which documents appear in the context.

### Context Flow (category/all mode)

```
User question
  │
  ├─ 1. RAG search (query=question, limit=12, category filter if not "all")
  │     → ranked results with doc_ids
  │
  ├─ 2. Enrich top-N from DocumentRegistry
  │     → fetch record per doc_id → build focused field table
  │
  ├─ 3. Aggregate statistics (always included)
  │     → compact line: "STATISTIK: 42 kvitton | amount: summa 127 340, snitt 3 032"
  │     → computed from ALL records in category, not just top-N
  │     → only numeric fields, max 5 fields, max ~200 chars per field
  │
  ├─ 4. Token budget → assemble system message
  │
  └─ 5. History + user message (unchanged)
```

### Token Budget Model

Estimation: 1 token ≈ 4 characters (conservative for Swedish/mixed text). No external tokenizer dependency — `len(text) // 4`.

Budget proportions (scale with `num_ctx`):

| Section | Share | ~Tokens (16K) | Contents |
|---------|-------|---------------|----------|
| System prompt + statistics | 10% | ~1,600 | Fixed instructions + aggregate line |
| Field table (enriched RAG hits) | 40% | ~6,500 | Top-N documents with title + fields |
| RAG snippets | 20% | ~3,200 | Text excerpts from search results |
| Conversation history | 20% | ~3,200 | Recent turns, truncated from oldest |
| User message + margin | 10% | ~1,600 | Current question + safety margin |

### Overflow Handling

- Field table: reduce document count until it fits
- RAG snippets: truncate last snippet, then reduce count
- History: remove oldest turns first
- System prompt + aggregate exceeding its budget: log warning, never reject request

Budget proportions are module-level constants in `workspace_chat.py`, not env-configurable.

### Aggregate Statistics

New static method `_build_aggregate_summary`:

- Iterate all records, collect numeric fields (strip `kr`, `SEK`, whitespace before `float()`)
- Per field: compute sum, mean, count
- Format: `"STATISTIK: 42 kvitton | amount: summa 127 340, snitt 3 032 | vat_amount: summa 25 468, snitt 606"`
- Hard cap: max 5 fields, ~200 chars per field
- Fallback: `"STATISTIK: 42 dokument i kategorin."` if no numeric fields

### RAG Search and Enrichment

- Increase `RAG_SEARCH_LIMIT` from 8 to 12
- Search results provide `doc_id` + `snippet`
- Matching records fetched from `DocumentRegistry.get_document()` per `doc_id`
- Field table built **only** from these matched records
- Snippets included separately under `RELEVANTA TEXTUTDRAG`
- Documents not in search results appear only in aggregate statistics

**Fallback:** If RAG search returns 0 results (empty index, new category), fall back to `list_documents(limit=20)` with token budget protection.

### What Does NOT Change

- `_prepare_document_context` — single document mode, untouched
- `stream_response` — untouched
- `WorkspaceContext` dataclass — untouched
- API contract (`POST /workspace/chat`) — untouched
- Frontend hook `useWorkspaceChat.ts` — untouched
- SSE event format — untouched

## Testing Strategy

- Update existing tests to verify RAG-first behavior
- Add test for token budget truncation (large document set)
- Add test for aggregate statistics (numeric field extraction)
- Add test for fallback when RAG returns empty results
- Add test for overflow handling (verify no crash at budget limits)
