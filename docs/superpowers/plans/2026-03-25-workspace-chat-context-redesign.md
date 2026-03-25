# Workspace Chat Context Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dump-all-documents approach in workspace chat with RAG-first context building and token budgeting to improve response quality and prevent context overflow.

**Architecture:** The `prepare_context` method in `WorkspaceChatPipeline` is rewritten to search first (RAG), enrich matched documents from the registry, build aggregate statistics from all documents, and assemble the system message within a hard token budget. Single-document mode and all public interfaces remain unchanged.

**Tech Stack:** Python 3.14, pytest, existing SearchPipeline (hybrid vector+BM25), existing DocumentRegistry

**Spec:** `docs/superpowers/specs/2026-03-25-workspace-chat-context-redesign.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/pipelines/workspace_chat.py` | Modify | Core changes: new constants, `_parse_numeric`, `_build_aggregate_summary`, `_estimate_tokens`, `_truncate_to_budget`, rewritten `prepare_context` |
| `server/main.py:215-220` | Modify | Pass `num_ctx` to `WorkspaceChatPipeline.__init__` |
| `server/tests/test_workspace_chat.py` | Modify | Adapt existing tests + add new tests for all new behaviors |

---

## Task 1: Add `_parse_numeric` helper and test

**Files:**
- Modify: `server/tests/test_workspace_chat.py`
- Modify: `server/pipelines/workspace_chat.py`

This is a pure utility function with no dependencies on the pipeline. It parses Swedish-formatted numeric strings into floats.

- [ ] **Step 1: Write the failing test**

Add to `server/tests/test_workspace_chat.py`:

```python
from server.pipelines.workspace_chat import WorkspaceChatPipeline


def test_parse_numeric_plain_integer() -> None:
    assert WorkspaceChatPipeline._parse_numeric("500") == 500.0


def test_parse_numeric_with_currency_suffix() -> None:
    assert WorkspaceChatPipeline._parse_numeric("500 kr") == 500.0
    assert WorkspaceChatPipeline._parse_numeric("1200 SEK") == 1200.0


def test_parse_numeric_swedish_thousands() -> None:
    assert WorkspaceChatPipeline._parse_numeric("127 340 kr") == 127340.0
    assert WorkspaceChatPipeline._parse_numeric("1 200") == 1200.0


def test_parse_numeric_decimal() -> None:
    assert WorkspaceChatPipeline._parse_numeric("99.50") == 99.5


def test_parse_numeric_returns_none_for_non_numeric() -> None:
    assert WorkspaceChatPipeline._parse_numeric("ICA Maxi") is None
    assert WorkspaceChatPipeline._parse_numeric("ca 500") is None
    assert WorkspaceChatPipeline._parse_numeric("") is None
    assert WorkspaceChatPipeline._parse_numeric("N/A") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py::test_parse_numeric_plain_integer -v`
Expected: FAIL — `_parse_numeric` does not exist yet.

- [ ] **Step 3: Implement `_parse_numeric`**

Add to `server/pipelines/workspace_chat.py` as a `@staticmethod` on `WorkspaceChatPipeline`:

```python
import re

_CURRENCY_SUFFIX_RE = re.compile(r"\s*(kr|sek)\s*$", re.IGNORECASE)

@staticmethod
def _parse_numeric(value: str) -> float | None:
    """Parse a Swedish-formatted numeric string to float, or return None."""
    text = value.strip()
    if not text:
        return None
    # Strip currency suffix
    text = _CURRENCY_SUFFIX_RE.sub("", text).strip()
    if not text:
        return None
    # Remove internal spaces (thousands separators)
    text = text.replace(" ", "")
    # Remove non-breaking spaces
    text = text.replace("\u00a0", "")
    try:
        return float(text)
    except ValueError:
        return None
```

Note: `_CURRENCY_SUFFIX_RE` is defined at module level (above the class). The method is a `@staticmethod` on the class.

- [ ] **Step 4: Run all parse_numeric tests**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py -k "parse_numeric" -v`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pipelines/workspace_chat.py server/tests/test_workspace_chat.py
git commit -m "feat(workspace-chat): add _parse_numeric for Swedish number parsing"
```

---

## Task 2: Add `_build_aggregate_summary` and test

**Files:**
- Modify: `server/tests/test_workspace_chat.py`
- Modify: `server/pipelines/workspace_chat.py`

Depends on: Task 1 (`_parse_numeric`).

- [ ] **Step 1: Write the failing test**

Add to `server/tests/test_workspace_chat.py`:

```python
def test_build_aggregate_summary_with_numeric_fields() -> None:
    records = [
        build_test_record(record_id="r1", title="K1", fields={"vendor": "ICA", "amount": "500 kr", "vat_amount": "100"}),
        build_test_record(record_id="r2", title="K2", fields={"vendor": "Coop", "amount": "300 kr", "vat_amount": "60"}),
    ]
    result = WorkspaceChatPipeline._build_aggregate_summary(records, "receipt")
    assert "2 kvitton" in result.lower() or "2" in result
    # Should contain aggregated numeric fields
    assert "800" in result  # sum of amount
    assert "160" in result  # sum of vat_amount


def test_build_aggregate_summary_no_numeric_fields() -> None:
    records = [
        build_test_record(record_id="r1", title="K1", fields={"vendor": "ICA", "note": "test"}),
    ]
    result = WorkspaceChatPipeline._build_aggregate_summary(records, "receipt")
    assert "1" in result
    assert "kvitton" in result.lower()


def test_build_aggregate_summary_empty_records() -> None:
    result = WorkspaceChatPipeline._build_aggregate_summary([], "receipt")
    assert "0" in result or "inga" in result.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py::test_build_aggregate_summary_with_numeric_fields -v`
Expected: FAIL — `_build_aggregate_summary` does not exist yet.

- [ ] **Step 3: Implement `_build_aggregate_summary`**

Add to `WorkspaceChatPipeline` as a `@staticmethod`:

```python
MAX_AGGREGATE_FIELDS = 5

@staticmethod
def _build_aggregate_summary(records: list[Any], category: str) -> str:
    """Build a compact one-line summary with aggregate statistics."""
    count = len(records)
    label = CATEGORY_LABELS.get(category, "dokument")
    if count == 0:
        return f"STATISTIK: Inga {label.lower()} i kategorin."

    # Collect numeric values per field key
    numeric_fields: dict[str, list[float]] = {}
    for record in records:
        extraction = getattr(record, "extraction", None)
        if extraction is None or not hasattr(extraction, "fields"):
            continue
        for key, value in extraction.fields.items():
            if not isinstance(value, str) or not value.strip():
                continue
            parsed = WorkspaceChatPipeline._parse_numeric(value)
            if parsed is not None:
                numeric_fields.setdefault(key, []).append(parsed)

    if not numeric_fields:
        return f"STATISTIK: {count} {label.lower()} i kategorin."

    # Build compact field summaries (top N by occurrence count)
    sorted_fields = sorted(numeric_fields.items(), key=lambda kv: -len(kv[1]))
    parts = [f"STATISTIK: {count} {label.lower()}"]
    for key, values in sorted_fields[:MAX_AGGREGATE_FIELDS]:
        total = sum(values)
        mean = total / len(values)
        part = f"{key}: summa {total:,.0f}, snitt {mean:,.0f}".replace(",", " ")
        parts.append(part)

    return " | ".join(parts)
```

Note: `MAX_AGGREGATE_FIELDS = 5` is a module-level constant.

- [ ] **Step 4: Run all aggregate tests**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py -k "aggregate" -v`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pipelines/workspace_chat.py server/tests/test_workspace_chat.py
git commit -m "feat(workspace-chat): add _build_aggregate_summary with numeric field stats"
```

---

## Task 3: Add token budget helpers and test

**Files:**
- Modify: `server/tests/test_workspace_chat.py`
- Modify: `server/pipelines/workspace_chat.py`

No dependencies on previous tasks.

- [ ] **Step 1: Write the failing test**

Add to `server/tests/test_workspace_chat.py`:

```python
from server.pipelines.workspace_chat import estimate_tokens, compute_token_budget


def test_estimate_tokens() -> None:
    assert estimate_tokens("abcd") == 1  # 4 chars = 1 token
    assert estimate_tokens("abcdefgh") == 2  # 8 chars = 2 tokens
    assert estimate_tokens("") == 0


def test_token_budget_scales_with_num_ctx() -> None:
    budget = compute_token_budget(16384)
    assert budget["system"] + budget["fields"] + budget["rag"] + budget["history"] + budget["margin"] == 16384


def test_token_budget_proportions() -> None:
    budget = compute_token_budget(16384)
    # Fields should get ~40% = ~6553
    assert 6000 < budget["fields"] < 7000
    # System should get ~10% = ~1638
    assert 1400 < budget["system"] < 1900
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py::test_estimate_tokens -v`
Expected: FAIL — `estimate_tokens` does not exist yet.

- [ ] **Step 3: Implement token budget utilities**

Add to `server/pipelines/workspace_chat.py` at module level:

```python
# Token budget proportions
BUDGET_SYSTEM = 0.10
BUDGET_FIELDS = 0.40
BUDGET_RAG = 0.20
BUDGET_HISTORY = 0.20
BUDGET_MARGIN = 0.10

DEFAULT_NUM_CTX = 16384


def estimate_tokens(text: str) -> int:
    """Estimate token count: ~4 characters per token (conservative for Swedish)."""
    return len(text) // 4


def compute_token_budget(num_ctx: int) -> dict[str, int]:
    """Compute token budgets per section from the total context window size."""
    return {
        "system": int(num_ctx * BUDGET_SYSTEM),
        "fields": int(num_ctx * BUDGET_FIELDS),
        "rag": int(num_ctx * BUDGET_RAG),
        "history": int(num_ctx * BUDGET_HISTORY),
        "margin": num_ctx - int(num_ctx * BUDGET_SYSTEM) - int(num_ctx * BUDGET_FIELDS) - int(num_ctx * BUDGET_RAG) - int(num_ctx * BUDGET_HISTORY),
    }
```

Note: `margin` absorbs rounding so the total always equals `num_ctx`.

- [ ] **Step 4: Run all budget tests**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py -k "token_budget or estimate_tokens" -v`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pipelines/workspace_chat.py server/tests/test_workspace_chat.py
git commit -m "feat(workspace-chat): add token budget estimation and proportional budgets"
```

---

## Task 4: Add `num_ctx` parameter to `WorkspaceChatPipeline.__init__` and wire in `main.py`

**Files:**
- Modify: `server/pipelines/workspace_chat.py:54-68` (constructor)
- Modify: `server/main.py:215-220` (wiring)
- Modify: `server/tests/test_workspace_chat.py` (existing tests)

- [ ] **Step 1: Add `num_ctx` param to `__init__`**

In `server/pipelines/workspace_chat.py`, modify `WorkspaceChatPipeline.__init__`:

```python
def __init__(
    self,
    *,
    ollama_client: StreamingLLM,
    search_pipeline: SearchPipeline,
    document_registry: DocumentSource,
    system_prompt: str,
    temperature: float = 0.3,
    num_ctx: int = DEFAULT_NUM_CTX,
) -> None:
    self.ollama_client = ollama_client
    self.search_pipeline = search_pipeline
    self.document_registry = document_registry
    self.system_prompt = system_prompt
    self.temperature = temperature
    self.num_ctx = num_ctx
```

- [ ] **Step 2: Wire `num_ctx` in `main.py`**

In `server/main.py:215-220`, update the `WorkspaceChatPipeline` instantiation:

```python
workspace_chat_service = WorkspaceChatPipeline(
    ollama_client=workspace_llm,
    search_pipeline=search_service,
    document_registry=document_registry,
    system_prompt=read_prompt(config.prompts_dir / "workspace_system.txt"),
    num_ctx=config.resolve_num_ctx("workspace_chat") or DEFAULT_NUM_CTX,
)
```

Extend the existing lazy import at line 214 of `main.py` (keep it lazy — do NOT move to top-level):

```python
from server.pipelines.workspace_chat import WorkspaceChatPipeline, DEFAULT_NUM_CTX
```

Note: The import is lazy (inside the `if` block) intentionally. Keep it there.

- [ ] **Step 3: Run existing tests to verify nothing breaks**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py -v`
Expected: All existing tests PASS (the new param has a default value).

- [ ] **Step 4: Commit**

```bash
git add server/pipelines/workspace_chat.py server/main.py
git commit -m "feat(workspace-chat): add num_ctx param and wire from config"
```

---

## Task 5: Rewrite `prepare_context` to RAG-first with token budget

**Files:**
- Modify: `server/pipelines/workspace_chat.py:70-139` (the `prepare_context` method)
- Modify: `server/tests/test_workspace_chat.py`

Depends on: Tasks 1-4.

This is the core change. The existing `prepare_context` method (lines 70-139) is replaced entirely for the category/all path. The `document_id` branch still delegates to `_prepare_document_context` unchanged.

- [ ] **Step 1: Write the failing test for RAG-first behavior**

Add to `server/tests/test_workspace_chat.py`:

```python
@pytest.mark.asyncio
async def test_prepare_context_rag_first_only_includes_matched_docs(tmp_path) -> None:
    """Field table should only contain documents that matched the RAG search."""
    ollama = FakeOllamaClient()
    search = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
    )
    # Index only r1 — r2 is in registry but not in search index
    search.index_documents([
        IndexedDocument(doc_id="r1", title="Kvitto ICA", source_path="/r1.pdf",
                        text="ICA Maxi kvitto moms 100", metadata={"document_type": "receipt"}),
    ])
    registry = FakeDocumentRegistry([
        build_test_record(record_id="r1", title="Kvitto ICA", kind="receipt",
                          fields={"vendor": "ICA", "amount": "500"}),
        build_test_record(record_id="r2", title="Kvitto Coop", kind="receipt",
                          fields={"vendor": "Coop", "amount": "300"}),
    ])

    pipeline = WorkspaceChatPipeline(
        ollama_client=ollama, search_pipeline=search,
        document_registry=registry, system_prompt="Test.",
    )

    context = await pipeline.prepare_context(
        category="receipt", message="Vad kostade ICA?", history=[],
    )

    system_msg = context.messages[0]["content"]
    # r1 matched search — should be in field table
    assert "ICA" in system_msg
    # r2 did NOT match — field table section (before STATISTIK) should not contain Coop
    assert "EXTRAHERADE" in system_msg
    fields_section = system_msg.split("EXTRAHERADE")[1].split("RELEVANTA")[0] if "RELEVANTA" in system_msg else system_msg.split("EXTRAHERADE")[1].split("STATISTIK")[0]
    assert "Coop" not in fields_section
    # source_count should be total docs in category (2), not just matched (1)
    assert context.source_count == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py::test_prepare_context_rag_first_only_includes_matched_docs -v`
Expected: FAIL — current behavior includes all documents in field table.

- [ ] **Step 3: Rewrite `prepare_context`**

Replace lines 70-139 of `server/pipelines/workspace_chat.py` with:

```python
FALLBACK_DOCUMENT_LIMIT = 20

async def prepare_context(
    self,
    *,
    category: str,
    message: str,
    history: list[dict[str, str]],
    document_id: str | None = None,
) -> WorkspaceContext:
    request_id = str(uuid4())

    if document_id:
        return self._prepare_document_context(
            document_id=document_id,
            category=category,
            message=message,
            history=history,
            request_id=request_id,
        )

    is_global = category == "all"
    budget = compute_token_budget(self.num_ctx)

    # 1. Fetch all documents for aggregate stats + source_count
    listing = self.document_registry.list_documents(
        kind=None if is_global else category, limit=MAX_CONTEXT_DOCUMENTS,
    )
    all_records = listing.documents
    source_count = len(all_records)

    # 2. RAG search
    enriched_records: list[Any] = []
    rag_snippets: list[str] = []
    try:
        search_result = await self.search_pipeline.search(
            message, limit=RAG_SEARCH_LIMIT, mode="fast",
            document_type=None if is_global else category,
        )
        if search_result.results:
            rag_snippets = [
                f"[{r.title}]: {r.snippet}" for r in search_result.results
            ]
            # Enrich: fetch full records for matched doc_ids
            seen_ids: set[str] = set()
            for r in search_result.results:
                if r.doc_id in seen_ids:
                    continue
                seen_ids.add(r.doc_id)
                record = self.document_registry.get_document(record_id=r.doc_id)
                if record is not None:
                    enriched_records.append(record)
                else:
                    logger.debug(
                        "workspace_chat.stale_index_entry doc_id=%s request_id=%s",
                        r.doc_id, request_id,
                    )
    except Exception:
        logger.warning("workspace_chat.rag_search_failed request_id=%s", request_id)

    # 3. Fallback: if RAG returned nothing, use list_documents
    if not enriched_records:
        fallback = self.document_registry.list_documents(
            kind=None if is_global else category, limit=FALLBACK_DOCUMENT_LIMIT,
        )
        enriched_records = fallback.documents

    # 4. Build sections
    aggregate = self._build_aggregate_summary(all_records, category)
    fields_table = self._build_fields_table(enriched_records, category)
    rag_context = "\n".join(rag_snippets)

    # 5. Token-budgeted assembly
    label = CATEGORY_LABELS.get(category, "Alla dokument") if not is_global else "Alla dokument"
    system_header = (
        f"{self.system_prompt}\n\n"
        f"{'ALLA KATEGORIER' if is_global else f'KATEGORI: {label}'}\n"
        f"ANTAL DOKUMENT: {source_count}\n\n"
        f"{aggregate}\n\n"
    )

    # Truncate fields table to budget
    if estimate_tokens(fields_table) > budget["fields"]:
        # Progressively reduce rows
        rows = fields_table.split("\n")
        while len(rows) > 3 and estimate_tokens("\n".join(rows)) > budget["fields"]:
            rows.pop(-1)
        fields_table = "\n".join(rows)

    system_msg = system_header + f"EXTRAHERADE FÄLT:\n{fields_table}"

    # Truncate RAG snippets to budget
    if rag_context and estimate_tokens(rag_context) > budget["rag"]:
        lines = rag_context.split("\n")
        while len(lines) > 1 and estimate_tokens("\n".join(lines)) > budget["rag"]:
            lines.pop(-1)
        rag_context = "\n".join(lines)

    if rag_context:
        system_msg += f"\n\nRELEVANTA TEXTUTDRAG:\n{rag_context}"

    messages: list[dict[str, str]] = [{"role": "system", "content": system_msg}]

    # Truncate history to budget
    history_turns = history[-MAX_HISTORY_TURNS * 2:]
    history_budget_chars = budget["history"] * 4
    while history_turns and sum(len(t["content"]) for t in history_turns) > history_budget_chars:
        history_turns.pop(0)

    for turn in history_turns:
        messages.append({"role": turn["role"], "content": turn["content"]})

    messages.append({"role": "user", "content": message})

    return WorkspaceContext(
        source_count=source_count,
        messages=messages,
        request_id=request_id,
    )
```

Also update the module constants at the top of the file:

```python
RAG_SEARCH_LIMIT = 12  # was 8
```

- [ ] **Step 4: Run the new test**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py::test_prepare_context_rag_first_only_includes_matched_docs -v`
Expected: PASS.

- [ ] **Step 5: Run ALL existing tests to check for regressions**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py -v`
Expected: All tests PASS. The existing tests use registries where docs are both indexed and registered, so RAG-first enrichment should find them.

- [ ] **Step 6: Commit**

```bash
git add server/pipelines/workspace_chat.py server/tests/test_workspace_chat.py
git commit -m "feat(workspace-chat): rewrite prepare_context to RAG-first with token budget"
```

---

## Task 6: Add edge case tests

**Files:**
- Modify: `server/tests/test_workspace_chat.py`

Depends on: Task 5.

- [ ] **Step 1: Write test for stale index entries**

```python
@pytest.mark.asyncio
async def test_prepare_context_stale_index_entry_skipped(tmp_path) -> None:
    """Search returns doc_id with no matching registry record — silently skipped."""
    ollama = FakeOllamaClient()
    search = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
    )
    # Index a doc that does NOT exist in registry
    search.index_documents([
        IndexedDocument(doc_id="ghost", title="Ghost", source_path="/ghost.pdf",
                        text="ghost document data", metadata={"document_type": "receipt"}),
        IndexedDocument(doc_id="r1", title="Real", source_path="/r1.pdf",
                        text="real document data", metadata={"document_type": "receipt"}),
    ])
    registry = FakeDocumentRegistry([
        build_test_record(record_id="r1", title="Real Doc", kind="receipt",
                          fields={"vendor": "ICA", "amount": "500"}),
    ])

    pipeline = WorkspaceChatPipeline(
        ollama_client=ollama, search_pipeline=search,
        document_registry=registry, system_prompt="Test.",
    )

    context = await pipeline.prepare_context(
        category="receipt", message="test", history=[],
    )

    system_msg = context.messages[0]["content"]
    assert "ICA" in system_msg  # real doc enriched
    assert "Ghost" not in system_msg  # stale entry skipped
```

- [ ] **Step 2: Write test for empty search fallback**

```python
@pytest.mark.asyncio
async def test_prepare_context_fallback_when_search_empty(tmp_path) -> None:
    """When RAG returns 0 results, fall back to list_documents."""
    ollama = FakeOllamaClient()
    search = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
    )
    # Empty search index — no documents indexed
    registry = FakeDocumentRegistry([
        build_test_record(record_id="r1", title="Kvitto ICA", kind="receipt",
                          fields={"vendor": "ICA", "amount": "500"}),
    ])

    pipeline = WorkspaceChatPipeline(
        ollama_client=ollama, search_pipeline=search,
        document_registry=registry, system_prompt="Test.",
    )

    context = await pipeline.prepare_context(
        category="receipt", message="Visa allt", history=[],
    )

    system_msg = context.messages[0]["content"]
    # Fallback should include registry docs
    assert "ICA" in system_msg
    assert context.source_count == 1
```

- [ ] **Step 3: Write test for token budget truncation**

```python
@pytest.mark.asyncio
async def test_prepare_context_truncates_large_history(tmp_path) -> None:
    """History exceeding budget is truncated from the oldest."""
    ollama = FakeOllamaClient()
    search = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
    )
    search.index_documents([
        IndexedDocument(doc_id="r1", title="K1", source_path="/r1.pdf",
                        text="data", metadata={"document_type": "receipt"}),
    ])
    registry = FakeDocumentRegistry([
        build_test_record(record_id="r1", title="K1", kind="receipt", fields={"amount": "100"}),
    ])

    pipeline = WorkspaceChatPipeline(
        ollama_client=ollama, search_pipeline=search,
        document_registry=registry, system_prompt="Test.",
        num_ctx=1024,  # very small budget to force truncation
    )

    long_history = []
    for i in range(20):
        long_history.append({"role": "user", "content": f"Question {i} " * 50})
        long_history.append({"role": "assistant", "content": f"Answer {i} " * 50})

    context = await pipeline.prepare_context(
        category="receipt", message="Latest question", history=long_history,
    )

    # Should not crash, and should have fewer history messages than input
    history_msgs = [m for m in context.messages if m["role"] != "system" and m["content"] != "Latest question"]
    assert len(history_msgs) < 40  # truncated from original
```

- [ ] **Step 4: Run all tests**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tests/test_workspace_chat.py
git commit -m "test(workspace-chat): add edge case tests for stale entries, fallback, truncation"
```

---

## Task 7: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full backend test suite**

Run: `PYTHONPATH=. pytest server/tests -q`
Expected: All tests PASS.

- [ ] **Step 2: Run type check / build**

Run: `npm run build`
Expected: No errors (frontend unchanged).

- [ ] **Step 3: Verify cargo check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: No errors (Rust unchanged).

- [ ] **Step 4: Final commit if any fixups were needed**

Only if previous steps required adjustments. Otherwise skip.
