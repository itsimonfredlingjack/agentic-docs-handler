from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
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
            values = [str(fields.get(key, "\u2014")) for key in all_keys]
            title = getattr(record, "title", f"doc-{i}")
            rows.append(f"| {i} | {title} | " + " | ".join(values) + " |")

        return "\n".join([header, separator, *rows])
