from __future__ import annotations

import sys
import types

import pytest

from server.pipelines.search import IndexedDocument, SearchPipeline, SearchResponse, SentenceTransformerEmbedder


class FakeEmbedder:
    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            lowered = text.casefold()
            vectors.append(
                [
                    1.0 if "invoice" in lowered else 0.0,
                    1.0 if "contract" in lowered else 0.0,
                    float(len(lowered.split())),
                ]
            )
        return vectors

    def encode_query(self, text: str) -> list[float]:
        lowered = text.casefold()
        return [
            1.0 if "invoice" in lowered else 0.0,
            1.0 if "contract" in lowered else 0.0,
            float(len(lowered.split())),
        ]


@pytest.mark.asyncio
async def test_search_pipeline_returns_ranked_results(tmp_path) -> None:
    pipeline = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
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

    result = await pipeline.search("invoice amount")

    assert isinstance(result, SearchResponse)
    assert result.rewritten_query == "invoice amount"
    assert result.results[0].doc_id == "invoice-1"
    assert result.results[0].keyword_score > 0
    assert "Top match" in result.answer


@pytest.mark.asyncio
async def test_search_pipeline_filters_results_to_allowed_doc_ids(tmp_path) -> None:
    pipeline = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
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
                doc_id="invoice-2",
                title="Invoice April",
                source_path="docs/invoice-april.txt",
                text="Invoice for April 2026. Amount 1200 SEK.",
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

    result = await pipeline.search("invoice amount", allowed_doc_ids={"invoice-2"})

    assert [entry.doc_id for entry in result.results] == ["invoice-2"]


@pytest.mark.asyncio
async def test_search_pipeline_upsert_replaces_stale_chunks_and_token_indexes(tmp_path) -> None:
    pipeline = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
        chunk_size=32,
        chunk_overlap=0,
    )
    pipeline.index_documents(
        [
            IndexedDocument(
                doc_id="doc-1",
                title="Quarterly Invoice",
                source_path="docs/invoice.txt",
                text="invoice alpha beta " * 6,
                metadata={"document_type": "invoice"},
            )
        ]
    )

    initial_chunk_ids = set(pipeline._chunk_ids_by_doc_id["doc-1"])
    initial_search = await pipeline.search("invoice", limit=5)
    assert initial_search.results

    await pipeline.upsert_document(
        IndexedDocument(
            doc_id="doc-1",
            title="Quarterly Contract",
            source_path="docs/contract.txt",
            text="contract gamma delta " * 6,
            metadata={"document_type": "contract"},
        )
    )

    updated_chunk_ids = set(pipeline._chunk_ids_by_doc_id["doc-1"])
    assert updated_chunk_ids == initial_chunk_ids
    assert "invoice" not in pipeline._chunk_ids_by_token
    assert pipeline._chunk_ids_by_token["contract"] == updated_chunk_ids
    assert all(
        "contract" in pipeline._rows_by_chunk_id[chunk_id]["content"].casefold()
        for chunk_id in updated_chunk_ids
    )

    refreshed_search = await pipeline.search("invoice", limit=5)
    assert all(entry.keyword_score == 0 for entry in refreshed_search.results)
    assert all("invoice" not in entry.snippet.casefold() for entry in refreshed_search.results)
    contract_search = await pipeline.search("contract", limit=5)
    assert contract_search.results
    assert contract_search.results[0].doc_id == "doc-1"


@pytest.mark.asyncio
async def test_search_pipeline_uses_create_table_only_for_initial_build(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    pipeline = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
    )
    create_table_calls: list[str] = []
    original_create_table = pipeline.db.create_table

    def tracked_create_table(name: str, rows: list[dict[str, object]], *, mode: str):
        create_table_calls.append(mode)
        return original_create_table(name, rows, mode=mode)

    monkeypatch.setattr(pipeline.db, "create_table", tracked_create_table)

    pipeline.index_documents(
        [
            IndexedDocument(
                doc_id="invoice-1",
                title="Invoice March",
                source_path="docs/invoice.txt",
                text="Invoice for March 2026. Amount 900 SEK.",
                metadata={"document_type": "invoice"},
            )
        ]
    )

    await pipeline.upsert_document(
        IndexedDocument(
            doc_id="invoice-1",
            title="Invoice March Updated",
            source_path="docs/invoice.txt",
            text="Invoice for March 2026. Amount 1200 SEK.",
            metadata={"document_type": "invoice"},
        )
    )

    assert create_table_calls == ["overwrite"]


@pytest.mark.asyncio
async def test_search_pipeline_preserves_ranking_with_mixed_keyword_and_vector_matches(tmp_path) -> None:
    pipeline = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
    )
    pipeline.index_documents(
        [
            IndexedDocument(
                doc_id="invoice-1",
                title="Invoice Summary",
                source_path="docs/invoice.txt",
                text="invoice amount total due amount",
                metadata={"document_type": "invoice"},
            ),
            IndexedDocument(
                doc_id="contract-1",
                title="Contract Summary",
                source_path="docs/contract.txt",
                text="contract obligations clauses renewal",
                metadata={"document_type": "contract"},
            ),
            IndexedDocument(
                doc_id="invoice-2",
                title="Invoice Archive",
                source_path="docs/invoice-archive.txt",
                text="invoice archive balance",
                metadata={"document_type": "invoice"},
            ),
        ]
    )

    result = await pipeline.search("invoice amount", limit=3)

    assert [entry.doc_id for entry in result.results] == ["invoice-1", "invoice-2", "contract-1"]
    assert result.results[0].keyword_score >= result.results[1].keyword_score
    assert result.results[0].vector_score > 0
    assert result.results[1].vector_score > 0
    assert "Top match" in result.answer


@pytest.mark.asyncio
async def test_search_pipeline_limits_keyword_scoring_to_posting_list_candidates(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    pipeline = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
        chunk_size=24,
        chunk_overlap=0,
    )
    pipeline.index_documents(
        [
            IndexedDocument(
                doc_id="invoice-1",
                title="Invoice Match",
                source_path="docs/invoice.txt",
                text="invoice token unique " * 6,
                metadata={"document_type": "invoice"},
            ),
            IndexedDocument(
                doc_id="contract-1",
                title="Contract Mismatch",
                source_path="docs/contract.txt",
                text="contract clause renewal " * 8,
                metadata={"document_type": "contract"},
            ),
            IndexedDocument(
                doc_id="generic-1",
                title="Generic Mismatch",
                source_path="docs/generic.txt",
                text="notes memo planning " * 8,
                metadata={"document_type": "generic"},
            ),
        ]
    )

    observed_texts: list[str] = []
    original_keyword_score = pipeline._keyword_score

    def tracked_keyword_score(query: str, text: str) -> float:
        observed_texts.append(text)
        return original_keyword_score(query, text)

    monkeypatch.setattr(pipeline, "_keyword_score", tracked_keyword_score)

    await pipeline.search("invoice", limit=5)

    matched_chunk_ids = pipeline._chunk_ids_by_token["invoice"]
    assert len(observed_texts) == len(matched_chunk_ids)
    assert len(observed_texts) < len(pipeline._rows_by_chunk_id)
    assert all("invoice" in text.casefold() for text in observed_texts)


@pytest.mark.asyncio
async def test_search_snippet_centers_on_query_match(tmp_path) -> None:
    pipeline = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
    )
    # Build a long text where "invoice" appears far from the start
    padding = "unrelated text about nothing " * 20
    target = "Invoice for March 2026. Amount 900 SEK."
    pipeline.index_documents(
        [
            IndexedDocument(
                doc_id="invoice-1",
                title="Invoice March",
                source_path="docs/invoice.txt",
                text=padding + target,
                metadata={"document_type": "invoice"},
            ),
        ]
    )

    result = await pipeline.search("invoice")

    assert result.results
    snippet = result.results[0].snippet
    # Snippet should contain the matching term, not just the document start
    assert "invoice" in snippet.casefold()
    assert len(snippet) <= 244  # 240 + possible ellipsis chars


@pytest.mark.asyncio
async def test_search_with_document_type_filter_returns_only_matching_category(tmp_path) -> None:
    pipeline = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
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
    assert len(doc_types) > 1


def test_sentence_transformer_embedder_passes_trust_remote_code(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class FakeSentenceTransformer:
        def __init__(
            self,
            model_name: str,
            *,
            revision: str | None = None,
            device: str,
            trust_remote_code: bool,
        ) -> None:
            captured["model_name"] = model_name
            captured["revision"] = revision
            captured["device"] = device
            captured["trust_remote_code"] = trust_remote_code

    fake_module = types.SimpleNamespace(SentenceTransformer=FakeSentenceTransformer)
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_module)

    embedder = SentenceTransformerEmbedder(
        model_name="nomic-ai/nomic-embed-text-v1.5",
        revision="rev-123",
        device="cpu",
        trust_remote_code=True,
    )

    embedder._load_model()

    assert captured == {
        "model_name": "nomic-ai/nomic-embed-text-v1.5",
        "revision": "rev-123",
        "device": "cpu",
        "trust_remote_code": True,
    }
