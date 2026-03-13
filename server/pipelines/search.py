from __future__ import annotations

import asyncio
import logging
import re
from collections import Counter, defaultdict
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
        self._rows_by_chunk_id: dict[str, dict[str, Any]] = {}
        self._chunk_ids_by_doc_id: dict[str, set[str]] = {}
        self._token_counts_by_chunk_id: dict[str, Counter[str]] = {}
        self._chunk_ids_by_token: dict[str, set[str]] = defaultdict(set)
        self._table: Any | None = None
        self._bootstrapped = False
        self._mutation_lock = asyncio.Lock()

    def index_documents(self, documents: list[IndexedDocument]) -> None:
        self._documents = {document.doc_id: document for document in documents}
        rows = self._rebuild_rows(list(self._documents.values()))
        self._replace_snapshot(rows)

    async def upsert_document(self, document: IndexedDocument) -> None:
        async with self._mutation_lock:
            started = asyncio.get_running_loop().time()
            self._documents[document.doc_id] = document
            doc_rows = self._build_document_rows(document)
            previous_chunk_ids = self._chunk_ids_by_doc_id.get(document.doc_id, set()).copy()

            if self._table is None:
                if doc_rows:
                    self._table = self.db.create_table(self.table_name, doc_rows, mode="overwrite")
            else:
                self._delete_document_rows(document.doc_id)
                if doc_rows:
                    self._table.add(doc_rows)

            self._remove_chunk_ids(previous_chunk_ids)
            self._add_rows(doc_rows)
            self._bootstrapped = True
            elapsed_ms = round((asyncio.get_running_loop().time() - started) * 1000, 2)
            logger.info(
                "search.upsert.done doc_id=%s rows=%s elapsed_ms=%s",
                document.doc_id,
                len(doc_rows),
                elapsed_ms,
            )

    async def search(self, query: str, limit: int | None = None, *, mode: str = "full", document_type: str | None = None) -> SearchResponse:
        await self._ensure_bootstrapped()
        request_id = str(uuid4())
        rewritten_query = query
        if mode != "fast" and self.query_planner is not None:
            try:
                rewritten_query = await self.query_planner.rewrite(query, request_id)
            except OllamaServiceError:
                rewritten_query = query

        rows_by_chunk_id = self._rows_by_chunk_id
        table = self._table
        if not rows_by_chunk_id or table is None:
            return SearchResponse(
                query=query,
                rewritten_query=rewritten_query,
                answer="Inga indexerade dokument finns tillgängliga ännu.",
                results=[],
            )

        top_limit = limit or self.default_limit
        query_vector = self.embedder.encode_query(rewritten_query)
        vector_rows = table.search(query_vector).limit(max(top_limit, self.candidate_limit)).to_list()
        if document_type is not None:
            vector_rows = [
                row for row in vector_rows
                if isinstance(row.get("metadata"), dict)
                and row["metadata"].get("document_type") == document_type
            ]
        vector_rank = {row["chunk_id"]: index + 1 for index, row in enumerate(vector_rows)}

        keyword_ranked = self._rank_keyword_candidates(
            rewritten_query,
            top_limit=top_limit,
            document_type=document_type,
        )
        keyword_rank = {
            chunk_id: index + 1
            for index, (chunk_id, score, _) in enumerate(keyword_ranked)
            if score > 0
        }
        keyword_scores = {chunk_id: score for chunk_id, score, _ in keyword_ranked}

        all_chunk_ids = set(vector_rank) | set(keyword_rank)
        scored_rows: list[SearchResult] = []
        for chunk_id in all_chunk_ids:
            row = rows_by_chunk_id.get(chunk_id)
            if row is None:
                continue
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
        if mode != "fast" and self.answer_generator is not None and top_results:
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
            self._replace_snapshot(rows)

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

    def _replace_snapshot(self, rows: list[dict[str, Any]]) -> None:
        self._rows = list(rows)
        self._rows_by_chunk_id = {}
        self._chunk_ids_by_doc_id = {}
        self._token_counts_by_chunk_id = {}
        self._chunk_ids_by_token = defaultdict(set)
        self._add_rows(rows)
        self._bootstrapped = True
        if not rows:
            self._table = None
            return
        self._table = self.db.create_table(self.table_name, rows, mode="overwrite")

    def _delete_document_rows(self, doc_id: str) -> None:
        if self._table is None:
            return
        escaped_doc_id = doc_id.replace("'", "''")
        self._table.delete(f"doc_id = '{escaped_doc_id}'")

    def _remove_chunk_ids(self, chunk_ids: set[str]) -> None:
        for chunk_id in chunk_ids:
            row = self._rows_by_chunk_id.pop(chunk_id, None)
            token_counts = self._token_counts_by_chunk_id.pop(chunk_id, None)
            if row is not None:
                doc_chunk_ids = self._chunk_ids_by_doc_id.get(row["doc_id"])
                if doc_chunk_ids is not None:
                    doc_chunk_ids.discard(chunk_id)
                    if not doc_chunk_ids:
                        del self._chunk_ids_by_doc_id[row["doc_id"]]
            for token in token_counts or ():
                token_chunk_ids = self._chunk_ids_by_token.get(token)
                if token_chunk_ids is None:
                    continue
                token_chunk_ids.discard(chunk_id)
                if not token_chunk_ids:
                    del self._chunk_ids_by_token[token]
        self._rows = list(self._rows_by_chunk_id.values())

    def _add_rows(self, rows: list[dict[str, Any]]) -> None:
        for row in rows:
            chunk_id = row["chunk_id"]
            doc_id = row["doc_id"]
            self._rows_by_chunk_id[chunk_id] = row
            self._chunk_ids_by_doc_id.setdefault(doc_id, set()).add(chunk_id)
            token_counts = Counter(tokenize(row["content"]))
            self._token_counts_by_chunk_id[chunk_id] = token_counts
            for token in token_counts:
                self._chunk_ids_by_token[token].add(chunk_id)
        self._rows = list(self._rows_by_chunk_id.values())

    def _rank_keyword_candidates(
        self,
        query: str,
        *,
        top_limit: int,
        document_type: str | None = None,
    ) -> list[tuple[str, float, dict[str, Any]]]:
        query_tokens = set(tokenize(query))
        if not query_tokens:
            return []

        lexical_candidate_limit = max(self.candidate_limit * 10, top_limit * 10)
        raw_hits_by_chunk_id: dict[str, int] = {}
        for token in query_tokens:
            for chunk_id in self._chunk_ids_by_token.get(token, set()):
                token_counts = self._token_counts_by_chunk_id.get(chunk_id)
                if token_counts is None:
                    continue
                raw_hits_by_chunk_id[chunk_id] = raw_hits_by_chunk_id.get(chunk_id, 0) + token_counts.get(token, 0)

        if document_type is not None:
            raw_hits_by_chunk_id = {
                chunk_id: hits
                for chunk_id, hits in raw_hits_by_chunk_id.items()
                if isinstance(self._rows_by_chunk_id.get(chunk_id, {}).get("metadata"), dict)
                and self._rows_by_chunk_id[chunk_id]["metadata"].get("document_type") == document_type
            }

        ranked_candidates = sorted(
            raw_hits_by_chunk_id.items(),
            key=lambda item: (-item[1], item[0]),
        )[:lexical_candidate_limit]

        scored_candidates: list[tuple[str, float, dict[str, Any]]] = []
        for chunk_id, _ in ranked_candidates:
            row = self._rows_by_chunk_id.get(chunk_id)
            if row is None:
                continue
            score = self._keyword_score(query, row["content"])
            if score > 0:
                scored_candidates.append((chunk_id, score, row))

        scored_candidates.sort(key=lambda item: (-item[1], item[0]))
        return scored_candidates

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
