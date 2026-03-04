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


class FakeQueryPlanner:
    async def rewrite(self, query: str, request_id: str) -> str:
        return f"{query} rewritten"


class FakeAnswerGenerator:
    async def answer(self, query: str, rewritten_query: str, results: list[dict[str, object]], request_id: str) -> str:
        top_title = results[0]["title"] if results else "none"
        return f"Top match for {rewritten_query}: {top_title}"


@pytest.mark.asyncio
async def test_search_pipeline_rewrites_query_and_returns_ranked_results(tmp_path) -> None:
    pipeline = SearchPipeline(
        db_path=tmp_path / "lancedb",
        embedder=FakeEmbedder(),
        query_planner=FakeQueryPlanner(),
        answer_generator=FakeAnswerGenerator(),
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
    assert result.rewritten_query == "invoice amount rewritten"
    assert result.results[0].doc_id == "invoice-1"
    assert result.results[0].keyword_score > 0
    assert "Top match" in result.answer


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
