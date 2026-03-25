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
  ├─ 1. RAG search (query=question, limit=12, category filter if not "all", mode="fast")
  │     → ranked results with doc_ids
  │
  ├─ 2. Enrich top-N from DocumentRegistry
  │     → fetch record per doc_id → build focused field table
  │     → skip any doc_id where get_document() returns None (stale index entry)
  │
  ├─ 3. Aggregate statistics (always included)
  │     → compact line: "STATISTIK: 42 kvitton | amount: summa 127 340, snitt 3 032"
  │     → computed from ALL records via list_documents(limit=MAX_CONTEXT_DOCUMENTS)
  │     → only numeric fields, max 5 fields, max ~200 chars per field
  │
  ├─ 4. Token budget → assemble system message
  │
  └─ 5. History + user message (unchanged)
```

### Key Invariant

`SearchResult.doc_id` corresponds to `UiDocumentRecord.id` — both are assigned as `record_id` in `process_pipeline.py` at indexing time. However, the search index and document registry are not transactionally consistent: a document may be deleted from the registry after indexing, or the index may contain stale entries. Therefore, when enriching search results, `get_document(record_id=doc_id)` returning `None` is handled by silently skipping that result (with a debug-level log).

### Token Budget Model

Estimation: 1 token ≈ 4 characters (conservative for Swedish/mixed text). No external tokenizer dependency — `len(text) // 4`. Note: markdown table syntax has ~30% structural overhead (pipes, dashes), so the field table budget yields fewer rows than pure prose would. The overflow handling compensates by reducing document count dynamically.

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

- Fetch all records via `list_documents(limit=MAX_CONTEXT_DOCUMENTS)` (reuses existing constant, currently 200)
- Collect numeric fields: strip currency suffixes (`kr`, `SEK`), remove all internal whitespace and thousands separators, then `float()`. Example: `"127 340 kr"` → strip `kr` → remove spaces → `"127340"` → `float("127340")`. Values that fail parsing are silently skipped.
- Per field: compute sum, mean, count
- Format: `"STATISTIK: 42 kvitton | amount: summa 127 340, snitt 3 032 | vat_amount: summa 25 468, snitt 606"`
- Hard cap: max 5 fields, ~200 chars per field
- Fallback: `"STATISTIK: 42 dokument i kategorin."` if no numeric fields

### RAG Search and Enrichment

- Increase `RAG_SEARCH_LIMIT` from 8 to 12 (named constant)
- Search uses `mode="fast"` (unchanged from current behavior)
- Search results provide `doc_id` + `snippet`
- Matching records fetched from `DocumentRegistry.get_document()` per `doc_id`; `None` results silently skipped
- Field table built **only** from these matched records (reuses `_build_fields_table`, same signature but called with the smaller enriched list)
- Snippets included separately under `RELEVANTA TEXTUTDRAG`
- Documents not in search results appear only in aggregate statistics

**Fallback:** If RAG search returns 0 results (empty index, new category), fall back to `list_documents(limit=FALLBACK_DOCUMENT_LIMIT)` where `FALLBACK_DOCUMENT_LIMIT = 20` (named constant), with token budget protection.

### `source_count` Semantics

`WorkspaceContext.source_count` changes meaning: it now represents the **total number of documents in the category** (from the aggregate listing), not the number of documents in the field table. This matches what the frontend displays ("baserat på N dokument") and stays accurate regardless of how many documents the RAG search returned. The number of enriched documents in the field table is visible from the table itself.

### What Does NOT Change

- `_prepare_document_context` — single document mode, untouched
- `_build_fields_table` — same static method, same signature, called with smaller input list
- `stream_response` — untouched
- `WorkspaceContext` dataclass — untouched
- API contract (`POST /workspace/chat`) — untouched
- Frontend hook `useWorkspaceChat.ts` — untouched
- SSE event format — untouched

## Testing Strategy

- **Adapt existing tests** (`test_workspace_chat_builds_fields_table`, `test_workspace_chat_streams_response_with_context`) to verify RAG-first behavior — field table should contain only search-matched documents
- **Add test for token budget truncation**: create 50+ records, verify field table is trimmed to fit budget
- **Add test for aggregate statistics**: records with numeric fields (`"500 kr"`, `"1 200"`, `"N/A"`) — verify correct sums, mean, and that non-parseable values are skipped
- **Add test for Swedish number parsing**: `"127 340 kr"` → 127340.0, `"ca 500"` → skipped, `""` → skipped
- **Add test for fallback**: empty search index → falls back to `list_documents(limit=20)`
- **Add test for stale index entries**: search returns `doc_id` with no matching registry record → silently skipped, no crash
- **Add test for overflow handling**: verify system works at budget boundaries without error
