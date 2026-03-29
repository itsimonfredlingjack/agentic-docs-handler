from __future__ import annotations

from collections import Counter
from collections.abc import AsyncIterator, Sequence
from typing import Any

import pytest

from server.pipelines.search import IndexedDocument, SearchPipeline
from server.pipelines.workspace_chat import WorkspaceChatPipeline, estimate_tokens, compute_token_budget
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
    workspace_id: str | None = None,
) -> UiDocumentRecord:
    return UiDocumentRecord(
        id=record_id,
        request_id=f"req-{record_id}",
        workspace_id=workspace_id,
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

    def get_document(self, *, record_id: str):
        for r in self._records:
            if r.id == record_id:
                return r
        return None

    def list_documents_by_workspace(self, *, workspace_id: str, limit: int = 200):
        filtered = [r for r in self._records if r.workspace_id == workspace_id]
        return filtered[:limit]

    def counts(self):
        c = Counter(r.kind for r in self._records)
        return type("Counts", (), {
            "all": len(self._records), "processing": 0,
            "receipt": c.get("receipt", 0), "contract": c.get("contract", 0),
            "invoice": c.get("invoice", 0), "meeting_notes": c.get("meeting_notes", 0),
            "audio": c.get("audio", 0), "generic": c.get("generic", 0), "moved": 0,
        })()


@pytest.mark.asyncio
async def test_workspace_chat_streams_response_with_context(tmp_path) -> None:
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
    assert "Vad är momsen?" in user_msg
    # Check system message has the fields table
    system_msg = ollama.calls[0]["messages"][0]["content"]
    assert "ICA Maxi" in system_msg
    assert "100" in system_msg  # vat_amount


@pytest.mark.asyncio
async def test_workspace_chat_includes_conversation_history(tmp_path) -> None:
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
    # System + history (2 turns) + user message = 4 messages
    assert len(messages) == 4
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    assert messages[1]["content"] == "Vad är momsen?"
    assert messages[2]["role"] == "assistant"
    assert messages[3]["role"] == "user"
    assert "Visa detaljer" in messages[3]["content"]


@pytest.mark.asyncio
async def test_workspace_chat_builds_fields_table(tmp_path) -> None:
    ollama = FakeOllamaClient()
    search = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
    )
    search.index_documents([
        IndexedDocument(doc_id="r1", title="K1", source_path="/r1.pdf",
                        text="data", metadata={"document_type": "receipt"}),
        IndexedDocument(doc_id="r2", title="K2", source_path="/r2.pdf",
                        text="data", metadata={"document_type": "receipt"}),
    ])
    registry = FakeDocumentRegistry([
        build_test_record(record_id="r1", title="Kvitto ICA", kind="receipt",
                          fields={"vendor": "ICA", "amount": "500"}),
        build_test_record(record_id="r2", title="Kvitto Coop", kind="receipt",
                          fields={"vendor": "Coop", "amount": "300"}),
    ])

    pipeline = WorkspaceChatPipeline(
        ollama_client=ollama,
        search_pipeline=search,
        document_registry=registry,
        system_prompt="Test.",
    )

    context = await pipeline.prepare_context(
        category="receipt", message="test", history=[],
    )

    system_msg = context.messages[0]["content"]
    assert "ICA" in system_msg
    assert "Coop" in system_msg
    assert "500" in system_msg
    assert "300" in system_msg
    assert "ANTAL DOKUMENT: 2" in system_msg


@pytest.mark.asyncio
async def test_workspace_chat_scopes_context_to_workspace_id(tmp_path) -> None:
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
            text="ICA Maxi kvitto moms 100",
            metadata={"document_type": "receipt"},
        ),
        IndexedDocument(
            doc_id="r2",
            title="Kvitto Coop",
            source_path="/docs/r2.pdf",
            text="Coop kvitto moms 50",
            metadata={"document_type": "receipt"},
        ),
    ])
    registry = FakeDocumentRegistry([
        build_test_record(
            record_id="r1",
            title="Kvitto ICA",
            kind="receipt",
            workspace_id="ws-a",
            fields={"vendor": "ICA Maxi", "vat_amount": "100"},
        ),
        build_test_record(
            record_id="r2",
            title="Kvitto Coop",
            kind="receipt",
            workspace_id="ws-b",
            fields={"vendor": "Coop", "vat_amount": "50"},
        ),
    ])

    pipeline = WorkspaceChatPipeline(
        ollama_client=ollama,
        search_pipeline=search,
        document_registry=registry,
        system_prompt="Du analyserar dokument.",
    )

    context = await pipeline.prepare_context(
        workspace_id="ws-a",
        message="Vad är momsen?",
        history=[],
    )

    system_msg = context.messages[0]["content"]
    assert context.source_count == 1
    assert "ICA Maxi" in system_msg
    assert "Coop" not in system_msg
    assert "WORKSPACE_ID: ws-a" in system_msg


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


def test_parse_numeric_comma_decimal() -> None:
    assert WorkspaceChatPipeline._parse_numeric("99,50") == 99.5
    assert WorkspaceChatPipeline._parse_numeric("1 299,00 kr") == 1299.0


def test_parse_numeric_returns_none_for_non_numeric() -> None:
    assert WorkspaceChatPipeline._parse_numeric("ICA Maxi") is None
    assert WorkspaceChatPipeline._parse_numeric("ca 500") is None
    assert WorkspaceChatPipeline._parse_numeric("") is None
    assert WorkspaceChatPipeline._parse_numeric("N/A") is None


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
    # Ghost has no registry record — it must not appear in the enriched fields table
    assert "EXTRAHERADE" in system_msg
    fields_section = system_msg.split("EXTRAHERADE")[1].split("RELEVANTA")[0] if "RELEVANTA" in system_msg else system_msg.split("EXTRAHERADE")[1]
    assert "Ghost" not in fields_section  # stale entry skipped from fields table
    assert "ICA" in fields_section  # real entry present in fields table


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
    # History should never start with an orphaned assistant message
    if history_msgs:
        assert history_msgs[0]["role"] == "user"
