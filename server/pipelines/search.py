from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

import lancedb

from server.clients.ollama_client import OllamaServiceError
from server.schemas import SearchResponse, SearchResult

TOKEN_PATTERN = re.compile(r"[\wÅÄÖåäö]+", re.UNICODE)
logger = logging.getLogger(__name__)


def tokenize(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(text.casefold())


def reciprocal_rank(rank: int | None, constant: int = 60) -> float:
    if rank is None:
        return 0.0
    return 1.0 / (constant + rank)


@dataclass(slots=True)
class IndexedDocument:
    doc_id: str
    title: str
    source_path: str
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


class SearchPipelineError(RuntimeError):
    """Raised when the search pipeline cannot serve a request."""


class Embedder(Protocol):
    def encode_documents(self, texts: list[str]) -> list[list[float]]: ...

    def encode_query(self, text: str) -> list[float]: ...


class QueryPlanner(Protocol):
    async def rewrite(self, query: str, request_id: str) -> str: ...


class AnswerGenerator(Protocol):
    async def answer(
        self,
        query: str,
        rewritten_query: str,
        results: list[dict[str, object]],
        request_id: str,
    ) -> str: ...


class SentenceTransformerEmbedder:
    def __init__(
        self,
        *,
        model_name: str,
        revision: str | None = None,
        device: str = "cpu",
        batch_size: int = 16,
        trust_remote_code: bool = True,
    ) -> None:
        self.model_name = model_name
        self.revision = revision
        self.device = device
        self.batch_size = batch_size
        self.trust_remote_code = trust_remote_code
        self._model: Any | None = None

    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        model = self._load_model()
        prefixed = [f"search_document: {text}" for text in texts]
        vectors = model.encode(
            prefixed,
            batch_size=self.batch_size,
            show_progress_bar=False,
            normalize_embeddings=True,
        )
        return [vector.tolist() for vector in vectors]

    def encode_query(self, text: str) -> list[float]:
        model = self._load_model()
        vector = model.encode(
            f"search_query: {text}",
            show_progress_bar=False,
            normalize_embeddings=True,
        )
        return vector.tolist()

    def _load_model(self) -> Any:
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(
                self.model_name,
                revision=self.revision,
                device=self.device,
                trust_remote_code=self.trust_remote_code,
            )
        return self._model


class LLMQueryPlanner:
    def __init__(self, *, ollama_client: Any, system_prompt: str, temperature: float = 0.1) -> None:
        self.ollama_client = ollama_client
        self.system_prompt = system_prompt
        self.temperature = temperature

    async def rewrite(self, query: str, request_id: str) -> str:
        response = await self.ollama_client.chat_text(
            request_id=request_id,
            prompt_name="search_query_rewrite",
            input_modality="text",
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": query},
            ],
            temperature=self.temperature,
        )
        rewritten = response.strip()
        return rewritten or query


class LLMAnswerGenerator:
    def __init__(self, *, ollama_client: Any, system_prompt: str, temperature: float = 0.2) -> None:
        self.ollama_client = ollama_client
        self.system_prompt = system_prompt
        self.temperature = temperature

    async def answer(
        self,
        query: str,
        rewritten_query: str,
        results: list[dict[str, object]],
        request_id: str,
    ) -> str:
        response = await self.ollama_client.chat_text(
            request_id=request_id,
            prompt_name="search_answer",
            input_modality="text",
            messages=[
                {"role": "system", "content": self.system_prompt},
                {
                    "role": "user",
                    "content": (
                        f"Fråga: {query}\n"
                        f"Rewritten query: {rewritten_query}\n"
                        f"Search results: {results}"
                    ),
                },
            ],
            temperature=self.temperature,
        )
        return response.strip()


class SearchPipeline:
    def __init__(
        self,
        *,
        db_path: Path,
        embedder: Embedder,
        table_name: str = "document_chunks",
        query_planner: QueryPlanner | None = None,
        answer_generator: AnswerGenerator | None = None,
        chunk_size: int = 900,
        chunk_overlap: int = 120,
        default_limit: int = 5,
        candidate_limit: int = 20,
        bootstrap_documents: Iterable[IndexedDocument] | None = None,
    ) -> None:
        self.db_path = Path(db_path)
        self.db_path.mkdir(parents=True, exist_ok=True)
        self.db = lancedb.connect(str(self.db_path))
        self.embedder = embedder
        self.table_name = table_name
        self.query_planner = query_planner
        self.answer_generator = answer_generator
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.default_limit = default_limit
        self.candidate_limit = candidate_limit
        self.bootstrap_documents = list(bootstrap_documents or [])
        self._documents: dict[str, IndexedDocument] = {
            document.doc_id: document for document in self.bootstrap_documents
        }
        self._rows: list[dict[str, Any]] = []
        self._table: Any | None = None
        self._bootstrapped = False
        self._mutation_lock = asyncio.Lock()

    def index_documents(self, documents: list[IndexedDocument]) -> None:
        self._documents = {document.doc_id: document for document in documents}
        rows = self._rebuild_rows(list(self._documents.values()))
        self._swap_snapshot(rows)

    async def upsert_document(self, document: IndexedDocument) -> None:
        async with self._mutation_lock:
            started = asyncio.get_running_loop().time()
            self._documents[document.doc_id] = document
            doc_rows = self._build_document_rows(document)
            next_rows = [row for row in self._rows if row["doc_id"] != document.doc_id]
            next_rows.extend(doc_rows)
            self._swap_snapshot(next_rows)
            elapsed_ms = round((asyncio.get_running_loop().time() - started) * 1000, 2)
            logger.info(
                "search.upsert.done doc_id=%s rows=%s elapsed_ms=%s",
                document.doc_id,
                len(doc_rows),
                elapsed_ms,
            )

    async def search(self, query: str, limit: int | None = None) -> SearchResponse:
        await self._ensure_bootstrapped()
        request_id = str(uuid4())
        rewritten_query = query
        if self.query_planner is not None:
            try:
                rewritten_query = await self.query_planner.rewrite(query, request_id)
            except OllamaServiceError:
                rewritten_query = query

        rows = list(self._rows)
        table = self._table
        if not rows or table is None:
            return SearchResponse(
                query=query,
                rewritten_query=rewritten_query,
                answer="Inga indexerade dokument finns tillgängliga ännu.",
                results=[],
            )

        top_limit = limit or self.default_limit
        query_vector = self.embedder.encode_query(rewritten_query)
        vector_rows = table.search(query_vector).limit(max(top_limit, self.candidate_limit)).to_list()
        vector_rank = {row["chunk_id"]: index + 1 for index, row in enumerate(vector_rows)}

        keyword_ranked = sorted(
            ((self._keyword_score(rewritten_query, row["content"]), row) for row in rows),
            key=lambda item: item[0],
            reverse=True,
        )
        keyword_rank = {
            row["chunk_id"]: index + 1
            for index, (score, row) in enumerate(keyword_ranked)
            if score > 0
        }
        keyword_scores = {row["chunk_id"]: score for score, row in keyword_ranked}

        all_chunk_ids = set(vector_rank) | set(keyword_rank)
        scored_rows: list[SearchResult] = []
        row_by_id = {row["chunk_id"]: row for row in rows}
        for chunk_id in all_chunk_ids:
            row = row_by_id[chunk_id]
            vector_score = reciprocal_rank(vector_rank.get(chunk_id))
            keyword_score = keyword_scores.get(chunk_id, 0.0)
            score = vector_score + keyword_score
            scored_rows.append(
                SearchResult(
                    doc_id=row["doc_id"],
                    title=row["title"],
                    source_path=row["source_path"],
                    snippet=row["content"][:240],
                    score=round(score, 6),
                    vector_score=round(vector_score, 6),
                    keyword_score=round(keyword_score, 6),
                    metadata=row["metadata"],
                )
            )
        scored_rows.sort(key=lambda item: item.score, reverse=True)
        top_results = scored_rows[:top_limit]

        answer = self._fallback_answer(rewritten_query, top_results)
        if self.answer_generator is not None and top_results:
            try:
                answer = await self.answer_generator.answer(
                    query,
                    rewritten_query,
                    [result.model_dump(mode="json") for result in top_results],
                    request_id,
                )
            except OllamaServiceError:
                answer = self._fallback_answer(rewritten_query, top_results)

        return SearchResponse(
            query=query,
            rewritten_query=rewritten_query,
            answer=answer,
            results=top_results,
        )

    async def _ensure_bootstrapped(self) -> None:
        if self._bootstrapped:
            return
        async with self._mutation_lock:
            if self._bootstrapped:
                return
            rows = self._rebuild_rows(list(self._documents.values()))
            self._swap_snapshot(rows)

    def _rebuild_rows(self, documents: list[IndexedDocument]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for document in documents:
            rows.extend(self._build_document_rows(document))
        return rows

    def _build_document_rows(self, document: IndexedDocument) -> list[dict[str, Any]]:
        chunks = self._chunk_text(document.text)
        if not chunks:
            return []
        vectors = self.embedder.encode_documents(chunks)
        return [
            {
                "chunk_id": f"{document.doc_id}:{index}",
                "doc_id": document.doc_id,
                "title": document.title,
                "source_path": document.source_path,
                "content": chunk_text,
                "metadata": document.metadata,
                "vector": vector,
            }
            for index, (chunk_text, vector) in enumerate(zip(chunks, vectors, strict=True))
        ]

    def _swap_snapshot(self, rows: list[dict[str, Any]]) -> None:
        self._rows = list(rows)
        self._bootstrapped = True
        if not rows:
            self._table = None
            return
        self._table = self.db.create_table(self.table_name, rows, mode="overwrite")

    def _chunk_text(self, text: str) -> list[str]:
        stripped = text.strip()
        if not stripped:
            return []
        if len(stripped) <= self.chunk_size:
            return [stripped]
        chunks: list[str] = []
        start = 0
        while start < len(stripped):
            end = min(start + self.chunk_size, len(stripped))
            chunks.append(stripped[start:end])
            if end >= len(stripped):
                break
            start = max(end - self.chunk_overlap, start + 1)
        return chunks

    def _keyword_score(self, query: str, text: str) -> float:
        query_tokens = set(tokenize(query))
        if not query_tokens:
            return 0.0
        text_tokens = tokenize(text)
        if not text_tokens:
            return 0.0
        matches = sum(1 for token in text_tokens if token in query_tokens)
        density = matches / max(len(text_tokens), 1)
        coverage = matches / max(len(query_tokens), 1)
        return round(density + coverage, 6)

    @staticmethod
    def _fallback_answer(rewritten_query: str, results: list[SearchResult]) -> str:
        if not results:
            return "Jag hittade inga dokument som matchar frågan."
        top = results[0]
        return f"Top match for '{rewritten_query}' is {top.title}. {top.snippet}"
