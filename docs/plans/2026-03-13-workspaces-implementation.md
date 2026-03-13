# Workspaces Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add scoped AI chat per document category — users interrogate folders like databases with streaming responses, backed by extracted fields + filtered RAG.

**Architecture:** New `WorkspaceChatPipeline` assembles structured extracted-fields tables + filtered RAG chunks into a context window, streams Ollama responses via SSE. Frontend adds a mode toggle (Activity/Analys), workspace grid, and analyst-notebook view with ghost-typing.

**Tech Stack:** FastAPI SSE (StreamingResponse), AsyncOpenAI streaming, LanceDB filtered search, Zustand state slice, React components with existing glass-panel design system.

**Decomposition Strategy:** Layer-based (data → pipeline → API → frontend state → frontend UI)

**Target Model:** Sonnet 30min chunks

**Design doc:** `docs/plans/2026-03-13-workspaces-design.md`

---

## Task 1: Backend — Add `document_type` filter to SearchPipeline

**Chunk estimate:** ~25 min (Sonnet)

**Files:**
- Modify: `server/pipelines/search.py` — add `document_type` param to `search()` and `_rank_keyword_candidates()`
- Test: `server/tests/test_search_pipeline.py` — add filtered search tests

**Step 1: Write failing test**

Add to `server/tests/test_search_pipeline.py`:

```python
@pytest.mark.asyncio
async def test_search_with_document_type_filter_returns_only_matching_category(tmp_path) -> None:
    pipeline = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
        query_planner=None,
        answer_generator=None,
    )
    pipeline.index_documents(
        [
            IndexedDocument(
                doc_id="invoice-1",
                title="Invoice March",
                source_path="docs/invoice.txt",
                text="Invoice for March 2026. Amount 900 SEK.",
                metadata={"document_type": "invoice"},
            ),
            IndexedDocument(
                doc_id="contract-1",
                title="Rental Contract",
                source_path="docs/contract.txt",
                text="Contract for office rental until 2029.",
                metadata={"document_type": "contract"},
            ),
            IndexedDocument(
                doc_id="invoice-2",
                title="Invoice April",
                source_path="docs/invoice2.txt",
                text="Invoice for April 2026. Amount 1200 SEK.",
                metadata={"document_type": "invoice"},
            ),
        ]
    )

    result = await pipeline.search("amount", document_type="invoice")

    assert all(r.metadata.get("document_type") == "invoice" for r in result.results)
    assert len(result.results) >= 1


@pytest.mark.asyncio
async def test_search_without_document_type_filter_returns_all(tmp_path) -> None:
    pipeline = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
        query_planner=None,
        answer_generator=None,
    )
    pipeline.index_documents(
        [
            IndexedDocument(
                doc_id="invoice-1",
                title="Invoice March",
                source_path="docs/invoice.txt",
                text="Invoice for March 2026. Amount 900 SEK.",
                metadata={"document_type": "invoice"},
            ),
            IndexedDocument(
                doc_id="contract-1",
                title="Rental Contract",
                source_path="docs/contract.txt",
                text="Contract for office rental until 2029.",
                metadata={"document_type": "contract"},
            ),
        ]
    )

    result = await pipeline.search("2026")

    doc_types = {r.metadata.get("document_type") for r in result.results}
    assert len(doc_types) > 1  # Both types returned
```

**Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=. pytest server/tests/test_search_pipeline.py::test_search_with_document_type_filter_returns_only_matching_category -v`
Expected: FAIL — `search()` got unexpected keyword argument `document_type`

**Step 3: Implement filtered search**

In `server/pipelines/search.py`, modify `search()` (line 239):

```python
async def search(
    self,
    query: str,
    limit: int | None = None,
    *,
    mode: str = "full",
    document_type: str | None = None,
) -> SearchResponse:
```

After getting `vector_rows` from LanceDB (line 261), add a filter:

```python
vector_rows = table.search(query_vector).limit(max(top_limit, self.candidate_limit)).to_list()
if document_type is not None:
    vector_rows = [
        row for row in vector_rows
        if isinstance(row.get("metadata"), dict)
        and row["metadata"].get("document_type") == document_type
    ]
```

Modify `_rank_keyword_candidates` signature (line 401) to accept and apply the filter:

```python
def _rank_keyword_candidates(
    self,
    query: str,
    *,
    top_limit: int,
    document_type: str | None = None,
) -> list[tuple[str, float, dict[str, Any]]]:
```

Inside `_rank_keyword_candidates`, after building `raw_hits_by_chunk_id` (line 418), filter:

```python
if document_type is not None:
    raw_hits_by_chunk_id = {
        chunk_id: hits
        for chunk_id, hits in raw_hits_by_chunk_id.items()
        if isinstance(self._rows_by_chunk_id.get(chunk_id, {}).get("metadata"), dict)
        and self._rows_by_chunk_id[chunk_id]["metadata"].get("document_type") == document_type
    }
```

Update the call to `_rank_keyword_candidates` in `search()` (line 264):

```python
keyword_ranked = self._rank_keyword_candidates(
    rewritten_query,
    top_limit=top_limit,
    document_type=document_type,
)
```

**Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest server/tests/test_search_pipeline.py -v`
Expected: ALL PASS (new + existing tests)

**Step 5: Commit**

```bash
git add server/pipelines/search.py server/tests/test_search_pipeline.py
git commit -m "feat(search): add document_type filter to SearchPipeline.search()"
```

**Verification Gate:**
1. Automated: `PYTHONPATH=. pytest server/tests/test_search_pipeline.py -v` — all pass
2. Manual: N/A (no server needed)
3. Regression: `PYTHONPATH=. pytest server/tests -q` — no existing tests broken
4. Review: Diff is backward-compatible (document_type defaults to None)

---

## Task 2: Backend — Add streaming to AsyncOllamaClient

**Chunk estimate:** ~20 min (Sonnet)

**Files:**
- Modify: `server/clients/ollama_client.py` — add `chat_text_stream()` method
- Test: `server/tests/test_ollama_client.py` — add streaming test

**Step 1: Write failing test**

Add to `server/tests/test_ollama_client.py`:

```python
@pytest.mark.asyncio
async def test_chat_text_stream_yields_tokens(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    from server.clients.ollama_client import AsyncOllamaClient
    from server.logging_config import LLMLogWriter
    from types import SimpleNamespace

    log_writer = LLMLogWriter(tmp_path / "logs")

    client = AsyncOllamaClient(
        base_url="http://localhost:11434/v1",
        api_key="ollama",
        model="test-model",
        timeout_seconds=10.0,
        log_writer=log_writer,
    )

    # Mock the OpenAI client's streaming response
    class FakeChoice:
        def __init__(self, content: str | None) -> None:
            self.delta = SimpleNamespace(content=content)

    class FakeChunk:
        def __init__(self, content: str | None) -> None:
            self.choices = [FakeChoice(content)]

    chunks = [FakeChunk("Hello"), FakeChunk(" "), FakeChunk("world"), FakeChunk(None)]

    class FakeStreamResponse:
        def __aiter__(self):
            return self

        async def __anext__(self):
            if not chunks:
                raise StopAsyncIteration
            return chunks.pop(0)

    async def fake_create(**kwargs):
        assert kwargs.get("stream") is True
        return FakeStreamResponse()

    monkeypatch.setattr(client.client.chat.completions, "create", fake_create)

    collected: list[str] = []
    async for token in client.chat_text_stream(
        request_id="test-req",
        prompt_name="test",
        input_modality="text",
        messages=[{"role": "user", "content": "Hi"}],
        temperature=0.3,
    ):
        collected.append(token)

    assert collected == ["Hello", " ", "world"]
```

**Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest server/tests/test_ollama_client.py::test_chat_text_stream_yields_tokens -v`
Expected: FAIL — `AsyncOllamaClient` has no attribute `chat_text_stream`

**Step 3: Implement streaming method**

Add to `server/clients/ollama_client.py`, after `chat_text()` (after line 259), add the import at top and new method:

Add to imports (line 7):
```python
from collections.abc import AsyncIterator, Sequence
```

Add method after `chat_text()`:

```python
async def chat_text_stream(
    self,
    *,
    request_id: str,
    prompt_name: str,
    input_modality: str,
    messages: Sequence[dict[str, Any]],
    temperature: float,
) -> AsyncIterator[str]:
    payload = {
        "model": self.model,
        "messages": list(messages),
        "temperature": temperature,
        "stream": True,
    }
    started_at = time.perf_counter()
    logger.info(
        "ollama.stream.start request_id=%s prompt_name=%s model=%s",
        request_id,
        prompt_name,
        self.model,
    )
    try:
        async with self._semaphore:
            response = await self.client.chat.completions.create(**payload)
            async for chunk in response:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
    except (APIConnectionError, APITimeoutError, APIStatusError, httpx.HTTPError) as error:
        raise self._map_error(error) from error
    finally:
        latency_ms = (time.perf_counter() - started_at) * 1000
        logger.info(
            "ollama.stream.done request_id=%s prompt_name=%s latency_ms=%.2f",
            request_id,
            prompt_name,
            latency_ms,
        )
```

**Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest server/tests/test_ollama_client.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/clients/ollama_client.py server/tests/test_ollama_client.py
git commit -m "feat(ollama): add chat_text_stream() for SSE-based workspace chat"
```

**Verification Gate:**
1. Automated: `PYTHONPATH=. pytest server/tests/test_ollama_client.py -v` — all pass
2. Manual: N/A
3. Regression: `PYTHONPATH=. pytest server/tests -q` — no existing tests broken
4. Review: New method follows existing chat_text() patterns, semaphore held during stream

---

## Task 3: Backend — Workspace chat pipeline + system prompt

**Chunk estimate:** ~30 min (Sonnet)

**Files:**
- Create: `server/pipelines/workspace_chat.py`
- Create: `server/prompts/workspace_system.txt`
- Test: `server/tests/test_workspace_chat.py`

**Step 1: Write failing test**

Create `server/tests/test_workspace_chat.py`:

```python
from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from server.pipelines.search import FakeEmbedder  # reuse from test_search_pipeline? No, define locally
from server.pipelines.search import IndexedDocument, SearchPipeline, SearchResponse
from server.schemas import ExtractionResult, UiDocumentRecord


class FakeEmbedder:
    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0, float(len(t.split()))] for t in texts]

    def encode_query(self, text: str) -> list[float]:
        return [1.0, 0.0, float(len(text.split()))]


class FakeOllamaClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.response_tokens = ["Totalt", " moms:", " 500", " kr"]

    async def chat_text_stream(
        self,
        *,
        request_id: str,
        prompt_name: str,
        input_modality: str,
        messages: Sequence[dict[str, Any]],
        temperature: float,
    ) -> AsyncIterator[str]:
        self.calls.append({"messages": list(messages), "prompt_name": prompt_name})
        for token in self.response_tokens:
            yield token


def build_test_record(
    *,
    record_id: str,
    title: str,
    kind: str = "receipt",
    fields: dict[str, Any] | None = None,
) -> UiDocumentRecord:
    return UiDocumentRecord(
        id=record_id,
        request_id=f"req-{record_id}",
        title=title,
        summary=f"Summary for {title}",
        mime_type="application/pdf",
        source_modality="text",
        kind=kind,
        document_type=kind,
        template=kind,
        source_path=None,
        created_at="2026-03-13T10:00:00+00:00",
        updated_at="2026-03-13T10:00:00+00:00",
        classification={
            "document_type": kind,
            "template": kind,
            "title": title,
            "summary": f"Summary for {title}",
            "tags": [],
            "language": "sv",
            "confidence": 0.95,
            "ocr_text": None,
            "suggested_actions": [],
        },
        extraction=ExtractionResult(
            fields=fields or {},
            field_confidence={},
            missing_fields=[],
        ),
        transcription=None,
        move_plan=None,
        move_result=None,
        tags=[],
        status="completed",
        undo_token=None,
        move_status="not_requested",
        retryable=False,
        error_code=None,
        warnings=[],
        diagnostics=None,
        thumbnail_data=None,
    )


class FakeDocumentRegistry:
    def __init__(self, records: list[UiDocumentRecord]) -> None:
        self._records = records

    def list_documents(self, *, kind: str | None = None, limit: int = 50, offset: int = 0):
        filtered = [r for r in self._records if kind is None or r.kind == kind]
        return type("Resp", (), {"documents": filtered[:limit], "total": len(filtered)})()

    def counts(self):
        from collections import Counter
        c = Counter(r.kind for r in self._records)
        return type("Counts", (), {
            "all": len(self._records), "processing": 0,
            "receipt": c.get("receipt", 0), "contract": c.get("contract", 0),
            "invoice": c.get("invoice", 0), "meeting_notes": c.get("meeting_notes", 0),
            "audio": c.get("audio", 0), "generic": c.get("generic", 0), "moved": 0,
        })()


@pytest.mark.asyncio
async def test_workspace_chat_streams_response_with_context(tmp_path) -> None:
    from server.pipelines.workspace_chat import WorkspaceChatPipeline

    ollama = FakeOllamaClient()
    search = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
    )
    search.index_documents([
        IndexedDocument(
            doc_id="r1",
            title="Kvitto ICA",
            source_path="/docs/r1.pdf",
            text="ICA Maxi kvitto 2026-01-15 belopp 500 moms 100",
            metadata={"document_type": "receipt"},
        ),
    ])
    registry = FakeDocumentRegistry([
        build_test_record(
            record_id="r1",
            title="Kvitto ICA",
            kind="receipt",
            fields={"vendor": "ICA Maxi", "amount": "500", "vat_amount": "100"},
        ),
    ])

    pipeline = WorkspaceChatPipeline(
        ollama_client=ollama,
        search_pipeline=search,
        document_registry=registry,
        system_prompt="Du analyserar dokument.",
    )

    context = await pipeline.prepare_context(
        category="receipt",
        message="Vad är momsen?",
        history=[],
    )

    assert context.source_count == 1

    tokens: list[str] = []
    async for token in pipeline.stream_response(context):
        tokens.append(token)

    assert tokens == ["Totalt", " moms:", " 500", " kr"]
    assert len(ollama.calls) == 1
    # Verify structured fields are in the prompt
    user_msg = ollama.calls[0]["messages"][-1]["content"]
    assert "ICA Maxi" in user_msg
    assert "100" in user_msg  # vat_amount


@pytest.mark.asyncio
async def test_workspace_chat_includes_conversation_history(tmp_path) -> None:
    from server.pipelines.workspace_chat import WorkspaceChatPipeline

    ollama = FakeOllamaClient()
    search = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
    )
    search.index_documents([
        IndexedDocument(
            doc_id="r1", title="Kvitto", source_path="/r1.pdf",
            text="kvitto data", metadata={"document_type": "receipt"},
        ),
    ])
    registry = FakeDocumentRegistry([
        build_test_record(record_id="r1", title="Kvitto", kind="receipt"),
    ])

    pipeline = WorkspaceChatPipeline(
        ollama_client=ollama,
        search_pipeline=search,
        document_registry=registry,
        system_prompt="Analysera.",
    )

    context = await pipeline.prepare_context(
        category="receipt",
        message="Visa detaljer",
        history=[
            {"role": "user", "content": "Vad är momsen?"},
            {"role": "assistant", "content": "Momsen är 100 kr."},
        ],
    )

    messages = context.messages
    # System + history (2 turns) + user message = 4 messages minimum
    assert len(messages) >= 4
    assert messages[0]["role"] == "system"
    assert messages[-1]["role"] == "user"
    assert "Visa detaljer" in messages[-1]["content"]
```

**Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.pipelines.workspace_chat'`

**Step 3: Create system prompt**

Create `server/prompts/workspace_system.txt`:

```
Du är en analysassistent för ett lokalt dokumentarkiv.
Du svarar på frågor baserat på strukturerad data (extraherade fält) och relevanta textutdrag från dokument i en specifik kategori.

Regler:
- Svara kort och direkt på svenska.
- Använd siffror och data från den strukturerade tabellen nedan.
- Om du räknar eller aggregerar, visa uträkningen steg för steg.
- Om data saknas eller är ofullständig, säg det tydligt.
- Referera till specifika dokument vid namn när det är relevant.
- Svara BARA utifrån den data du fått — hitta inte på.
```

**Step 4: Create workspace chat pipeline**

Create `server/pipelines/workspace_chat.py`:

```python
from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4

from server.pipelines.search import SearchPipeline

logger = logging.getLogger(__name__)

CATEGORY_LABELS = {
    "receipt": "Kvitton",
    "contract": "Avtal",
    "invoice": "Fakturor",
    "meeting_notes": "Mötesanteckningar",
    "audio": "Ljud",
    "generic": "Övrigt",
}

MAX_HISTORY_TURNS = 10
MAX_CONTEXT_DOCUMENTS = 200
RAG_SEARCH_LIMIT = 8


class StreamingLLM(Protocol):
    async def chat_text_stream(
        self,
        *,
        request_id: str,
        prompt_name: str,
        input_modality: str,
        messages: Sequence[dict[str, Any]],
        temperature: float,
    ) -> AsyncIterator[str]: ...


class DocumentSource(Protocol):
    def list_documents(
        self, *, kind: str | None = None, limit: int = 50, offset: int = 0
    ) -> Any: ...


@dataclass(slots=True)
class WorkspaceContext:
    source_count: int
    messages: list[dict[str, str]]
    request_id: str


class WorkspaceChatPipeline:
    def __init__(
        self,
        *,
        ollama_client: StreamingLLM,
        search_pipeline: SearchPipeline,
        document_registry: DocumentSource,
        system_prompt: str,
        temperature: float = 0.3,
    ) -> None:
        self.ollama_client = ollama_client
        self.search_pipeline = search_pipeline
        self.document_registry = document_registry
        self.system_prompt = system_prompt
        self.temperature = temperature

    async def prepare_context(
        self,
        *,
        category: str,
        message: str,
        history: list[dict[str, str]],
    ) -> WorkspaceContext:
        request_id = str(uuid4())

        # 1. Get all documents in category with extracted fields
        listing = self.document_registry.list_documents(
            kind=category, limit=MAX_CONTEXT_DOCUMENTS,
        )
        records = listing.documents
        source_count = len(records)

        # 2. Build structured fields table
        fields_table = self._build_fields_table(records, category)

        # 3. RAG search filtered by category
        rag_context = ""
        try:
            search_result = await self.search_pipeline.search(
                message, limit=RAG_SEARCH_LIMIT, mode="fast", document_type=category,
            )
            if search_result.results:
                snippets = [
                    f"[{r.title}]: {r.snippet}" for r in search_result.results
                ]
                rag_context = "\n".join(snippets)
        except Exception:
            logger.warning("workspace_chat.rag_search_failed request_id=%s", request_id)

        # 4. Build messages
        label = CATEGORY_LABELS.get(category, category)
        system_msg = (
            f"{self.system_prompt}\n\n"
            f"KATEGORI: {label}\n"
            f"ANTAL DOKUMENT: {source_count}\n\n"
            f"EXTRAHERADE FÄLT:\n{fields_table}"
        )
        if rag_context:
            system_msg += f"\n\nRELEVANTA TEXTUTDRAG:\n{rag_context}"

        messages: list[dict[str, str]] = [{"role": "system", "content": system_msg}]

        # Add conversation history (capped)
        for turn in history[-MAX_HISTORY_TURNS * 2 :]:
            messages.append({"role": turn["role"], "content": turn["content"]})

        # Add current user message
        messages.append({"role": "user", "content": message})

        return WorkspaceContext(
            source_count=source_count,
            messages=messages,
            request_id=request_id,
        )

    async def stream_response(
        self, context: WorkspaceContext
    ) -> AsyncIterator[str]:
        async for token in self.ollama_client.chat_text_stream(
            request_id=context.request_id,
            prompt_name="workspace_chat",
            input_modality="text",
            messages=context.messages,
            temperature=self.temperature,
        ):
            yield token

    @staticmethod
    def _build_fields_table(records: list[Any], category: str) -> str:
        if not records:
            return "Inga dokument i denna kategori."

        # Collect all unique field keys across records
        all_keys: list[str] = []
        for record in records:
            extraction = getattr(record, "extraction", None)
            if extraction is not None and hasattr(extraction, "fields"):
                for key in extraction.fields:
                    if key not in all_keys:
                        all_keys.append(key)

        if not all_keys:
            return f"{len(records)} dokument utan extraherade fält."

        # Build markdown table
        header = "| # | Titel | " + " | ".join(all_keys) + " |"
        separator = "| --- | --- | " + " | ".join("---" for _ in all_keys) + " |"
        rows: list[str] = []
        for i, record in enumerate(records, 1):
            extraction = getattr(record, "extraction", None)
            fields = extraction.fields if extraction is not None else {}
            values = [str(fields.get(key, "—")) for key in all_keys]
            title = getattr(record, "title", f"doc-{i}")
            rows.append(f"| {i} | {title} | " + " | ".join(values) + " |")

        return "\n".join([header, separator, *rows])
```

**Step 5: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py -v`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add server/pipelines/workspace_chat.py server/prompts/workspace_system.txt server/tests/test_workspace_chat.py
git commit -m "feat: workspace chat pipeline with structured fields context + filtered RAG"
```

**Verification Gate:**
1. Automated: `PYTHONPATH=. pytest server/tests/test_workspace_chat.py -v` — all pass
2. Manual: N/A
3. Regression: `PYTHONPATH=. pytest server/tests -q` — no existing tests broken
4. Review: Pipeline follows layer rules (imports from search + schemas, never from api/mcp)

---

## Task 4: Backend — Workspace endpoints + wiring

**Chunk estimate:** ~25 min (Sonnet)

**Files:**
- Modify: `server/schemas.py` — add workspace request/response models
- Modify: `server/api/routes.py` — add workspace endpoints
- Modify: `server/main.py` — wire WorkspaceChatPipeline into app
- Test: `server/tests/test_workspace_api.py`

**Step 1: Write failing test**

Create `server/tests/test_workspace_api.py`:

```python
from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from typing import Any

import pytest
from fastapi.testclient import TestClient

from server.main import create_app
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MovePlan,
    MoveResult,
    ProcessResponse,
    SearchResponse,
    SearchResult,
    UiDocumentRecord,
)


class FakePipeline:
    async def process_upload(self, **kwargs: Any) -> ProcessResponse:
        return ProcessResponse(
            request_id="req-1", status="classified", mime_type="application/pdf",
            classification=DocumentClassification(
                document_type="receipt", template="receipt", title="Test",
                summary="Test", tags=[], language="sv", confidence=0.9,
                ocr_text=None, suggested_actions=[],
            ),
            extraction=ExtractionResult(fields={}, field_confidence={}, missing_fields=[]),
            move_plan=MovePlan(destination=None, auto_move=False, rule_name=None),
            move_result=MoveResult(moved=False, destination=None, error=None),
            timings={}, errors=[], record_id=None, source_modality=None, created_at=None,
            transcription=None, ui_kind=None, undo_token=None, move_status="not_requested",
            retryable=False, error_code=None, warnings=[], diagnostics=None, thumbnail_data=None,
        )


class FakeReadinessProbe:
    def __call__(self) -> dict[str, object]:
        return {"ready": True, "checks": {"ollama": True, "model": True, "prompts": True, "whisper": True}}


class FakeSearchService:
    async def search(self, query: str, limit: int = 5, *, mode: str = "full", document_type: str | None = None) -> SearchResponse:
        return SearchResponse(query=query, rewritten_query=query, answer="", results=[])


class FakeWorkspaceChatPipeline:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def prepare_context(self, *, category: str, message: str, history: list[dict[str, str]]) -> Any:
        from server.pipelines.workspace_chat import WorkspaceContext
        self.calls.append({"category": category, "message": message})
        return WorkspaceContext(source_count=3, messages=[{"role": "user", "content": message}], request_id="req-1")

    async def stream_response(self, context: Any) -> AsyncIterator[str]:
        for token in ["Svar", " ", "här"]:
            yield token


def make_app(*, workspace_chat_service: Any = None) -> TestClient:
    app = create_app(
        pipeline=FakePipeline(),
        readiness_probe=FakeReadinessProbe(),
        search_service=FakeSearchService(),
        validation_report_loader=lambda: {"status": "missing"},
        workspace_chat_service=workspace_chat_service,
    )
    return TestClient(app)


def test_workspace_categories_returns_counts() -> None:
    client = make_app(workspace_chat_service=FakeWorkspaceChatPipeline())
    response = client.get("/workspace/categories")
    assert response.status_code == 200
    data = response.json()
    assert "categories" in data


def test_workspace_chat_streams_sse_events() -> None:
    ws_pipeline = FakeWorkspaceChatPipeline()
    client = make_app(workspace_chat_service=ws_pipeline)
    response = client.post(
        "/workspace/chat",
        json={"category": "receipt", "message": "Vad är momsen?", "history": []},
    )
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    body = response.text
    assert "event: token" in body
    assert "event: done" in body
    assert ws_pipeline.calls[0]["category"] == "receipt"


def test_workspace_chat_returns_503_when_not_available() -> None:
    client = make_app(workspace_chat_service=None)
    response = client.post(
        "/workspace/chat",
        json={"category": "receipt", "message": "test", "history": []},
    )
    assert response.status_code == 503
```

**Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_api.py -v`
Expected: FAIL — `create_app()` got unexpected keyword argument `workspace_chat_service`

**Step 3: Add schemas**

Add to `server/schemas.py`:

```python
class ChatTurn(BaseModel):
    role: str
    content: str


class WorkspaceChatRequest(BaseModel):
    category: str
    message: str = Field(min_length=1)
    history: list[ChatTurn] = Field(default_factory=list)


class WorkspaceCategory(BaseModel):
    category: str
    count: int
    label: str


class WorkspaceCategoriesResponse(BaseModel):
    categories: list[WorkspaceCategory]
```

**Step 4: Add endpoints to routes.py**

Add `workspace_chat_service: object | None` parameter to `create_router()`.

Add these endpoints inside `create_router()`:

```python
import json as json_module
from fastapi.responses import StreamingResponse
from server.schemas import WorkspaceChatRequest, WorkspaceCategoriesResponse, WorkspaceCategory

WORKSPACE_CATEGORY_LABELS = {
    "receipt": "Kvitton",
    "contract": "Avtal",
    "invoice": "Fakturor",
    "meeting_notes": "Möten",
    "audio": "Ljud",
    "generic": "Övrigt",
}

@router.get("/workspace/categories", response_model=WorkspaceCategoriesResponse)
async def workspace_categories() -> WorkspaceCategoriesResponse:
    if document_registry is None:
        raise HTTPException(503, "document registry unavailable")
    raw_counts = document_registry.counts()
    categories = []
    for kind, label in WORKSPACE_CATEGORY_LABELS.items():
        count = getattr(raw_counts, kind, 0)
        if count > 0:
            categories.append(WorkspaceCategory(category=kind, count=count, label=label))
    return WorkspaceCategoriesResponse(categories=categories)

@router.post("/workspace/chat")
async def workspace_chat(request: WorkspaceChatRequest) -> StreamingResponse:
    if workspace_chat_service is None:
        raise HTTPException(503, "workspace chat unavailable")
    context = await workspace_chat_service.prepare_context(
        category=request.category,
        message=request.message,
        history=[turn.model_dump() for turn in request.history],
    )

    async def event_stream():
        yield f"event: context\ndata: {json_module.dumps({'source_count': context.source_count})}\n\n"
        try:
            async for token in workspace_chat_service.stream_response(context):
                yield f"event: token\ndata: {json_module.dumps({'text': token})}\n\n"
            yield f"event: done\ndata: {{}}\n\n"
        except Exception as exc:
            yield f"event: error\ndata: {json_module.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

**Step 5: Wire into main.py**

Add `workspace_chat_service: object | None = None` parameter to `create_app()`.

After the `search_service` is created (after line 207), add:

```python
workspace_chat_service = workspace_chat_service
if workspace_chat_service is None and search_service is not None and ollama_client is not None:
    from server.pipelines.workspace_chat import WorkspaceChatPipeline
    workspace_chat_service = WorkspaceChatPipeline(
        ollama_client=ollama_client,
        search_pipeline=search_service,
        document_registry=document_registry,
        system_prompt=read_prompt(config.prompts_dir / "workspace_system.txt"),
    )
```

Add `workspace_chat_service=workspace_chat_service` to the `create_router()` call.

**Step 6: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest server/tests/test_workspace_api.py -v`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add server/schemas.py server/api/routes.py server/main.py server/tests/test_workspace_api.py
git commit -m "feat: workspace chat SSE endpoints + app wiring"
```

**Verification Gate:**
1. Automated: `PYTHONPATH=. pytest server/tests/test_workspace_api.py -v` — all pass
2. Manual: Start server, `curl http://localhost:9000/workspace/categories` returns JSON
3. Regression: `PYTHONPATH=. pytest server/tests -q` — no existing tests broken
4. Review: Endpoints follow existing route patterns, 503 when service unavailable

---

## Task 5: Frontend — Types + state + API

**Chunk estimate:** ~25 min (Sonnet)

**Files:**
- Modify: `src/types/documents.ts` — add workspace types
- Modify: `src/store/documentStore.ts` — add workspace state slice
- Modify: `src/lib/api.ts` — add workspace API calls
- Test: `src/store/documentStore.test.ts` — add workspace state tests

**Step 1: Add types**

Add to `src/types/documents.ts`:

```typescript
export type ViewMode = "activity" | "workspaces";

export type WorkspaceCategory = {
  category: string;
  count: number;
  label: string;
};

export type NotebookEntry = {
  id: string;
  query: string;
  response: string;
  timestamp: string;
  sourceCount: number;
};

export type WorkspaceConversation = {
  entries: NotebookEntry[];
  isStreaming: boolean;
  streamingText: string;
};

export type WorkspaceChatEvent =
  | { type: "context"; data: { source_count: number } }
  | { type: "token"; data: { text: string } }
  | { type: "done"; data: Record<string, never> }
  | { type: "error"; data: { error: string } };
```

**Step 2: Add API calls**

Add to `src/lib/api.ts`:

```typescript
import type { WorkspaceCategory, WorkspaceChatEvent } from "../types/documents";

export async function fetchWorkspaceCategories(): Promise<{ categories: WorkspaceCategory[] }> {
  return fetchJson("/workspace/categories");
}

export async function* streamWorkspaceChat(
  category: string,
  message: string,
  history: Array<{ role: string; content: string }>,
): AsyncGenerator<WorkspaceChatEvent> {
  const baseUrl = await resolveBaseUrl();
  const response = await fetch(`${baseUrl}/workspace/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, message, history }),
  });

  if (!response.ok) {
    throw new Error(`workspace/chat: ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop()!;

    for (const part of parts) {
      let eventType = "";
      let dataStr = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7);
        else if (line.startsWith("data: ")) dataStr = line.slice(6);
      }
      if (eventType && dataStr) {
        yield { type: eventType, data: JSON.parse(dataStr) } as WorkspaceChatEvent;
      }
    }
  }
}
```

**Step 3: Add workspace state to store**

Add to `src/store/documentStore.ts` state type:

```typescript
viewMode: ViewMode;
activeWorkspace: string | null;
workspaceCategories: WorkspaceCategory[];
conversations: Record<string, WorkspaceConversation>;
```

Add initial values:

```typescript
viewMode: "activity",
activeWorkspace: null,
workspaceCategories: [],
conversations: {},
```

Add actions:

```typescript
setViewMode: (mode: ViewMode) => set({ viewMode: mode, activeWorkspace: mode === "activity" ? null : undefined }),

setActiveWorkspace: (category: string | null) => set({ activeWorkspace: category }),

setWorkspaceCategories: (categories: WorkspaceCategory[]) => set({ workspaceCategories: categories }),

appendStreamingToken: (category: string, token: string) =>
  set((state) => {
    const conv = state.conversations[category] ?? { entries: [], isStreaming: true, streamingText: "" };
    return {
      conversations: {
        ...state.conversations,
        [category]: { ...conv, streamingText: conv.streamingText + token, isStreaming: true },
      },
    };
  }),

finalizeStreamingEntry: (category: string, sourceCount: number) =>
  set((state) => {
    const conv = state.conversations[category];
    if (!conv) return state;
    const lastQuery = conv.entries.length > 0
      ? conv.entries[conv.entries.length - 1]
      : null;
    return {
      conversations: {
        ...state.conversations,
        [category]: {
          entries: [
            ...conv.entries,
            {
              id: crypto.randomUUID(),
              query: "",  // set by startWorkspaceQuery
              response: conv.streamingText,
              timestamp: new Date().toISOString(),
              sourceCount,
            },
          ],
          isStreaming: false,
          streamingText: "",
        },
      },
    };
  }),

startWorkspaceQuery: (category: string, query: string) =>
  set((state) => {
    const conv = state.conversations[category] ?? { entries: [], isStreaming: false, streamingText: "" };
    return {
      conversations: {
        ...state.conversations,
        [category]: {
          entries: [
            ...conv.entries,
            {
              id: crypto.randomUUID(),
              query,
              response: "",
              timestamp: new Date().toISOString(),
              sourceCount: 0,
            },
          ],
          isStreaming: true,
          streamingText: "",
        },
      },
    };
  }),
```

**Step 4: Write store tests**

Add to `src/store/documentStore.test.ts`:

```typescript
describe("workspace state", () => {
  it("sets view mode", () => {
    const store = useDocumentStore.getState();
    store.setViewMode("workspaces");
    expect(useDocumentStore.getState().viewMode).toBe("workspaces");
  });

  it("sets active workspace", () => {
    const store = useDocumentStore.getState();
    store.setActiveWorkspace("receipt");
    expect(useDocumentStore.getState().activeWorkspace).toBe("receipt");
  });

  it("appends streaming tokens to conversation", () => {
    const store = useDocumentStore.getState();
    store.startWorkspaceQuery("receipt", "Vad är momsen?");
    store.appendStreamingToken("receipt", "Totalt");
    store.appendStreamingToken("receipt", " 500 kr");
    const conv = useDocumentStore.getState().conversations.receipt;
    expect(conv.streamingText).toBe("Totalt 500 kr");
    expect(conv.isStreaming).toBe(true);
  });

  it("finalizes streaming entry", () => {
    const store = useDocumentStore.getState();
    store.startWorkspaceQuery("receipt", "Vad är momsen?");
    store.appendStreamingToken("receipt", "Svar");
    store.finalizeStreamingEntry("receipt", 5);
    const conv = useDocumentStore.getState().conversations.receipt;
    expect(conv.isStreaming).toBe(false);
    expect(conv.streamingText).toBe("");
    expect(conv.entries).toHaveLength(2); // query entry + finalized entry
  });
});
```

**Step 5: Run tests**

Run: `npm test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/types/documents.ts src/store/documentStore.ts src/store/documentStore.test.ts src/lib/api.ts
git commit -m "feat(frontend): workspace types, state slice, and SSE API client"
```

**Verification Gate:**
1. Automated: `npm test` — all pass
2. Manual: N/A (state only)
3. Regression: `npm test` — no existing tests broken
4. Review: Types are minimal, store follows existing Zustand patterns

---

## Task 6: Frontend — ModeToggle + WorkspaceGrid + Sidebar/App wiring

**Chunk estimate:** ~30 min (Sonnet)

**Files:**
- Create: `src/components/ModeToggle.tsx`
- Create: `src/components/WorkspaceCard.tsx`
- Create: `src/components/WorkspaceGrid.tsx`
- Modify: `src/components/Sidebar.tsx` — add ModeToggle, conditional content
- Modify: `src/App.tsx` — conditional main area rendering
- Modify: `src/index.css` — workspace CSS

**Step 1: Create ModeToggle component**

Create `src/components/ModeToggle.tsx`:

```tsx
import { useDocumentStore } from "../store/documentStore";
import type { ViewMode } from "../types/documents";

const MODES: Array<{ id: ViewMode; label: string }> = [
  { id: "activity", label: "Aktivitet" },
  { id: "workspaces", label: "Analys" },
];

export function ModeToggle() {
  const viewMode = useDocumentStore((s) => s.viewMode);
  const setViewMode = useDocumentStore((s) => s.setViewMode);

  return (
    <div className="mode-toggle">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          className={`mode-toggle__option ${viewMode === mode.id ? "is-active" : ""}`}
          onClick={() => setViewMode(mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Create WorkspaceCard component**

Create `src/components/WorkspaceCard.tsx`:

```tsx
import { kindColor, kindRgbVar } from "../lib/document-colors";
import type { WorkspaceCategory } from "../types/documents";
import type { UiDocumentKind } from "../types/documents";

type Props = {
  category: WorkspaceCategory;
  onClick: () => void;
};

const KIND_ICONS: Record<string, string> = {
  receipt: "🧾",
  contract: "📑",
  invoice: "📄",
  meeting_notes: "📋",
  audio: "🎙",
  generic: "📁",
};

export function WorkspaceCard({ category, onClick }: Props) {
  const kind = category.category as UiDocumentKind;
  const rgbVar = kindRgbVar(kind);

  return (
    <button
      className="workspace-card glass-panel hover-lift"
      style={{ "--type-color-rgb": `var(${rgbVar})` } as React.CSSProperties}
      onClick={onClick}
    >
      <div className="workspace-card__icon">
        {KIND_ICONS[category.category] ?? "📁"}
      </div>
      <div className="workspace-card__info">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">
          {category.label}
        </h3>
        <p className="font-mono text-xs text-[var(--text-muted)]">
          {category.count} dokument
        </p>
      </div>
      <div
        className="workspace-card__accent"
        style={{ background: kindColor(kind) }}
      />
    </button>
  );
}
```

**Step 3: Create WorkspaceGrid component**

Create `src/components/WorkspaceGrid.tsx`:

```tsx
import { useEffect } from "react";
import { useDocumentStore } from "../store/documentStore";
import { fetchWorkspaceCategories } from "../lib/api";
import { WorkspaceCard } from "./WorkspaceCard";

export function WorkspaceGrid() {
  const categories = useDocumentStore((s) => s.workspaceCategories);
  const setCategories = useDocumentStore((s) => s.setWorkspaceCategories);
  const setActiveWorkspace = useDocumentStore((s) => s.setActiveWorkspace);

  useEffect(() => {
    fetchWorkspaceCategories()
      .then((data) => setCategories(data.categories))
      .catch(() => {});
  }, [setCategories]);

  if (categories.length === 0) {
    return (
      <div className="glass-panel flex min-h-[400px] flex-col items-center justify-center p-10 text-center animate-fade-in-up">
        <h3 className="text-lg font-bold text-[var(--text-primary)]">Inga kategorier ännu</h3>
        <p className="mt-2 max-w-sm text-sm text-[var(--text-secondary)]">
          Bearbeta dokument i Aktivitets-läget för att skapa workspace-kategorier.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4 animate-fade-in-up">
      <div className="px-1">
        <p className="section-kicker">Workspaces</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Välj en kategori för att börja analysera
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => (
          <WorkspaceCard
            key={cat.category}
            category={cat}
            onClick={() => setActiveWorkspace(cat.category)}
          />
        ))}
      </div>
    </section>
  );
}
```

**Step 4: Add CSS for workspace components**

Add to `src/index.css`:

```css
/* ── Mode Toggle ────────────────────────────────────── */
.mode-toggle {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
}

.mode-toggle__option {
  flex: 1;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  transition: color var(--transition-fast), background var(--transition-fast);
}

.mode-toggle__option:hover {
  color: var(--text-secondary);
}

.mode-toggle__option.is-active {
  background: rgba(255, 255, 255, 0.10);
  color: var(--text-primary);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

/* ── Workspace Card ─────────────────────────────────── */
.workspace-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}

.workspace-card:hover {
  background: linear-gradient(160deg, rgba(var(--type-color-rgb), 0.08), transparent 60%);
  border-color: rgba(var(--type-color-rgb), 0.15);
}

.workspace-card__icon {
  font-size: 24px;
  line-height: 1;
}

.workspace-card__info {
  flex: 1;
  min-width: 0;
}

.workspace-card__accent {
  position: absolute;
  bottom: 0;
  left: 20%;
  right: 20%;
  height: 2px;
  border-radius: 1px;
  opacity: 0;
  transition: opacity var(--transition-normal);
}

.workspace-card:hover .workspace-card__accent {
  opacity: 0.6;
}
```

**Step 5: Modify Sidebar — add ModeToggle**

In `src/components/Sidebar.tsx`, add the ModeToggle below the status card and conditionally show sidebar filter pills only in activity mode. In workspaces mode, the sidebar shows the ModeToggle and status only (the main area handles workspace navigation).

Add import: `import { ModeToggle } from "./ModeToggle";`
Add store selector: `const viewMode = useDocumentStore((state) => state.viewMode);`

Insert `<ModeToggle />` after the status card div. Wrap the `<nav>` in `{viewMode === "activity" && (...)}`.

**Step 6: Modify App.tsx — conditional main content**

In `src/App.tsx`, add imports and conditionally render workspace content:

```tsx
import { WorkspaceGrid } from "./WorkspaceGrid";
import { WorkspaceNotebook } from "./WorkspaceNotebook"; // will exist in Task 7
```

Add store selectors:
```tsx
const viewMode = useDocumentStore((s) => s.viewMode);
const activeWorkspace = useDocumentStore((s) => s.activeWorkspace);
```

Replace the `<main>` content with conditional rendering:

```tsx
<main className="glass-panel flex min-h-0 flex-1 flex-col gap-4 p-4">
  {viewMode === "activity" ? (
    <>
      <SearchBar activeFilterLabel={getSidebarFilterLabel(sidebarFilter)} onOpenFilters={() => setFilterSheetOpen(true)} />
      <DropZone />
      <ProcessingRail />
      <ActivityFeed />
    </>
  ) : activeWorkspace ? (
    <WorkspaceNotebook />
  ) : (
    <>
      <ProcessingRail />
      <WorkspaceGrid />
    </>
  )}
</main>
```

Note: `WorkspaceNotebook` doesn't exist yet — create a placeholder that renders `<div>Notebook placeholder</div>` for now. Task 7 will implement it fully.

**Step 7: Run tests**

Run: `npm test && npm run build`
Expected: ALL PASS (build verifies TypeScript compiles)

**Step 8: Commit**

```bash
git add src/components/ModeToggle.tsx src/components/WorkspaceCard.tsx src/components/WorkspaceGrid.tsx src/components/Sidebar.tsx src/App.tsx src/index.css
git commit -m "feat(frontend): mode toggle, workspace grid, and sidebar/app wiring"
```

**Verification Gate:**
1. Automated: `npm test` — all pass
2. Manual: `npm run dev`, toggle to Analys mode, verify grid renders (empty state if no backend)
3. Regression: `npm test && npm run build` — no existing tests or build broken
4. Review: Components use existing glass-panel/design tokens, no new dependencies

---

## Task 7: Frontend — Notebook view with streaming

**Chunk estimate:** ~30 min (Sonnet)

**Files:**
- Create: `src/components/NotebookInput.tsx`
- Create: `src/components/NotebookEntry.tsx`
- Create: `src/components/WorkspaceNotebook.tsx`
- Create: `src/hooks/useWorkspaceChat.ts`
- Modify: `src/index.css` — notebook CSS

**Step 1: Create useWorkspaceChat hook**

Create `src/hooks/useWorkspaceChat.ts`:

```tsx
import { useCallback } from "react";
import { useDocumentStore } from "../store/documentStore";
import { streamWorkspaceChat } from "../lib/api";

export function useWorkspaceChat() {
  const activeWorkspace = useDocumentStore((s) => s.activeWorkspace);
  const conversations = useDocumentStore((s) => s.conversations);
  const startQuery = useDocumentStore((s) => s.startWorkspaceQuery);
  const appendToken = useDocumentStore((s) => s.appendStreamingToken);
  const finalize = useDocumentStore((s) => s.finalizeStreamingEntry);

  const conversation = activeWorkspace ? conversations[activeWorkspace] : undefined;
  const isStreaming = conversation?.isStreaming ?? false;

  const sendMessage = useCallback(
    async (message: string) => {
      if (!activeWorkspace || isStreaming) return;

      startQuery(activeWorkspace, message);

      // Build history from previous entries
      const conv = useDocumentStore.getState().conversations[activeWorkspace];
      const history: Array<{ role: string; content: string }> = [];
      for (const entry of conv?.entries.slice(0, -1) ?? []) {
        if (entry.query) history.push({ role: "user", content: entry.query });
        if (entry.response) history.push({ role: "assistant", content: entry.response });
      }

      let sourceCount = 0;
      try {
        for await (const event of streamWorkspaceChat(activeWorkspace, message, history)) {
          if (event.type === "context") {
            sourceCount = event.data.source_count;
          } else if (event.type === "token") {
            appendToken(activeWorkspace, event.data.text);
          } else if (event.type === "error") {
            appendToken(activeWorkspace, `\n\n⚠ ${event.data.error}`);
          }
        }
      } catch (error) {
        appendToken(activeWorkspace, `\n\n⚠ ${error instanceof Error ? error.message : "Anslutningsfel"}`);
      }
      finalize(activeWorkspace, sourceCount);
    },
    [activeWorkspace, isStreaming, startQuery, appendToken, finalize],
  );

  return { conversation, isStreaming, sendMessage };
}
```

**Step 2: Create NotebookEntry component**

Create `src/components/NotebookEntry.tsx`:

```tsx
type Props = {
  query: string;
  response: string;
  sourceCount: number;
  isStreaming?: boolean;
  streamingText?: string;
};

export function NotebookEntry({ query, response, sourceCount, isStreaming, streamingText }: Props) {
  const displayText = isStreaming ? streamingText ?? "" : response;

  return (
    <div className="notebook-entry">
      {query && (
        <p className="notebook-entry__query">
          <span className="text-[var(--text-muted)]">▸</span> {query}
        </p>
      )}
      {displayText && (
        <div className="notebook-entry__response">
          <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)] leading-relaxed">
            {displayText}
            {isStreaming && <span className="notebook-cursor">█</span>}
          </p>
        </div>
      )}
      {!isStreaming && response && sourceCount > 0 && (
        <p className="notebook-entry__sources">
          Källa: {sourceCount} dokument analyserade
        </p>
      )}
    </div>
  );
}
```

**Step 3: Create NotebookInput component**

Create `src/components/NotebookInput.tsx`:

```tsx
import { useState, useRef, useCallback } from "react";

type Props = {
  placeholder: string;
  disabled: boolean;
  onSubmit: (message: string) => void;
};

export function NotebookInput({ placeholder, disabled, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }, [value, disabled, onSubmit]);

  return (
    <div className="notebook-input">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="notebook-input__field"
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="notebook-input__submit"
      >
        ↵
      </button>
    </div>
  );
}
```

**Step 4: Create WorkspaceNotebook component**

Create `src/components/WorkspaceNotebook.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceChat } from "../hooks/useWorkspaceChat";
import { NotebookEntry } from "./NotebookEntry";
import { NotebookInput } from "./NotebookInput";
import { kindColor } from "../lib/document-colors";
import type { UiDocumentKind } from "../types/documents";

const CATEGORY_LABELS: Record<string, string> = {
  receipt: "Kvitton",
  contract: "Avtal",
  invoice: "Fakturor",
  meeting_notes: "Möten",
  audio: "Ljud",
  generic: "Övrigt",
};

export function WorkspaceNotebook() {
  const activeWorkspace = useDocumentStore((s) => s.activeWorkspace);
  const setActiveWorkspace = useDocumentStore((s) => s.setActiveWorkspace);
  const counts = useDocumentStore((s) => s.counts);
  const { conversation, isStreaming, sendMessage } = useWorkspaceChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new tokens
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.streamingText, conversation?.entries.length]);

  if (!activeWorkspace) return null;

  const label = CATEGORY_LABELS[activeWorkspace] ?? activeWorkspace;
  const count = counts[activeWorkspace as keyof typeof counts] ?? 0;
  const color = kindColor(activeWorkspace as UiDocumentKind);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3">
        <button
          className="action-secondary px-2.5 py-1 text-xs"
          onClick={() => setActiveWorkspace(null)}
        >
          ←
        </button>
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
          />
          <h2 className="text-base font-bold text-[var(--text-primary)]">
            {label}
          </h2>
          <span className="font-mono text-xs text-[var(--text-muted)]">
            ({count})
          </span>
        </div>
      </div>

      {/* Notebook entries */}
      <div ref={scrollRef} className="flex-1 space-y-0 overflow-y-auto">
        {conversation?.entries.map((entry, index) => {
          const isLast = index === conversation.entries.length - 1;
          return (
            <NotebookEntry
              key={entry.id}
              query={entry.query}
              response={entry.response}
              sourceCount={entry.sourceCount}
              isStreaming={isLast && isStreaming}
              streamingText={isLast && isStreaming ? conversation.streamingText : undefined}
            />
          );
        })}

        {/* Empty state */}
        {(!conversation || conversation.entries.length === 0) && (
          <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
            <p className="text-sm text-[var(--text-secondary)]">
              Fråga dina {label.toLowerCase()} vad som helst
            </p>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="mt-3">
        <NotebookInput
          placeholder={`Fråga dina ${label.toLowerCase()}...`}
          disabled={isStreaming}
          onSubmit={sendMessage}
        />
      </div>
    </div>
  );
}
```

**Step 5: Add notebook CSS**

Add to `src/index.css`:

```css
/* ── Notebook ───────────────────────────────────────── */
.notebook-entry {
  padding: 12px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
}

.notebook-entry:last-child {
  border-bottom: none;
}

.notebook-entry__query {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.notebook-entry__response {
  padding-left: 16px;
}

.notebook-entry__sources {
  margin-top: 8px;
  padding-left: 16px;
  font-size: 11px;
  color: var(--text-muted);
}

.notebook-cursor {
  display: inline-block;
  animation: cursor-blink 1s steps(1) infinite;
  color: var(--accent-primary);
  margin-left: 1px;
}

@keyframes cursor-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* ── Notebook Input ─────────────────────────────────── */
.notebook-input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  transition: border-color var(--transition-fast);
}

.notebook-input:focus-within {
  border-color: rgba(255, 255, 255, 0.18);
}

.notebook-input__field {
  flex: 1;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
}

.notebook-input__field::placeholder {
  color: var(--text-muted);
}

.notebook-input__field:disabled {
  opacity: 0.5;
}

.notebook-input__submit {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-muted);
  transition: color var(--transition-fast), background var(--transition-fast);
}

.notebook-input__submit:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.notebook-input__submit:disabled {
  opacity: 0.3;
}
```

**Step 6: Remove WorkspaceNotebook placeholder from App.tsx**

Replace the placeholder created in Task 6 with the real import.

**Step 7: Run tests + build**

Run: `npm test && npm run build`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add src/hooks/useWorkspaceChat.ts src/components/NotebookEntry.tsx src/components/NotebookInput.tsx src/components/WorkspaceNotebook.tsx src/index.css
git commit -m "feat(frontend): workspace notebook with SSE streaming and analyst UX"
```

**Verification Gate:**
1. Automated: `npm test` — all pass
2. Manual: `npm run dev` with backend running — toggle to Analys, select a category, type a question, verify streaming
3. Regression: `npm test && npm run build` — no existing tests or build broken
4. Review: Notebook uses existing design tokens, no chat bubbles, analyst aesthetic

---

## Full Verification

After all 7 tasks are complete:

```bash
# Full backend
PYTHONPATH=. pytest server/tests -q

# Full frontend
npm test

# TypeScript + build
npm run build

# Rust check (no Tauri changes, but verify nothing broke)
cargo check --manifest-path src-tauri/Cargo.toml

# Manual smoke test with backend running:
# 1. Start backend: uvicorn server.main:app --host 0.0.0.0 --port 9000
# 2. curl http://localhost:9000/workspace/categories
# 3. curl -N -X POST http://localhost:9000/workspace/chat \
#      -H "Content-Type: application/json" \
#      -d '{"category":"receipt","message":"Vad är totala momsen?","history":[]}'
# 4. npm run dev — toggle to Analys, select category, ask question
```
