from __future__ import annotations

import logging
import re
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
RAG_SEARCH_LIMIT = 12
FALLBACK_DOCUMENT_LIMIT = 20
MAX_AGGREGATE_FIELDS = 5

# Token budget proportions
BUDGET_SYSTEM = 0.10
BUDGET_FIELDS = 0.40
BUDGET_RAG = 0.20
BUDGET_HISTORY = 0.20
BUDGET_MARGIN = 0.10

DEFAULT_NUM_CTX = 16384

_CURRENCY_SUFFIX_RE = re.compile(r"\s*(kr|sek)\s*$", re.IGNORECASE)


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

    def get_document(self, *, record_id: str) -> Any | None: ...


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
        num_ctx: int = DEFAULT_NUM_CTX,
    ) -> None:
        self.ollama_client = ollama_client
        self.search_pipeline = search_pipeline
        self.document_registry = document_registry
        self.system_prompt = system_prompt
        self.temperature = temperature
        self.num_ctx = num_ctx

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
            logger.warning("workspace_chat.rag_search_failed request_id=%s", request_id, exc_info=True)

        # 3. Fallback: if RAG returned nothing, reuse all_records slice
        if not enriched_records:
            enriched_records = all_records[:FALLBACK_DOCUMENT_LIMIT]

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
        # Don't start history with an orphaned assistant message
        if history_turns and history_turns[0]["role"] == "assistant":
            history_turns.pop(0)

        for turn in history_turns:
            messages.append({"role": turn["role"], "content": turn["content"]})

        messages.append({"role": "user", "content": message})

        return WorkspaceContext(
            source_count=source_count,
            messages=messages,
            request_id=request_id,
        )

    def _prepare_document_context(
        self,
        *,
        document_id: str,
        category: str,
        message: str,
        history: list[dict[str, str]],
        request_id: str,
    ) -> WorkspaceContext:
        record = self.document_registry.get_document(record_id=document_id)
        if record is None:
            raise ValueError(f"Document {document_id} not found")

        # Build rich context from the single document
        title = getattr(record, "title", "Okänt dokument")
        summary = getattr(record, "summary", "") or ""
        extraction = getattr(record, "extraction", None)
        fields = extraction.fields if extraction is not None else {}

        parts = [f"DOKUMENTTITEL: {title}"]
        if summary:
            parts.append(f"SAMMANFATTNING: {summary}")
        if fields:
            fields_str = "\n".join(f"  {k}: {v}" for k, v in fields.items() if v)
            parts.append(f"EXTRAHERADE FÄLT:\n{fields_str}")

        # Include transcription if available
        transcription = getattr(record, "transcription", None)
        if transcription is not None:
            text = getattr(transcription, "text", None)
            if text:
                parts.append(f"TRANSKRIBERING:\n{text}")

        doc_context = "\n\n".join(parts)

        label = CATEGORY_LABELS.get(category, category)
        system_msg = (
            f"{self.system_prompt}\n\n"
            f"Du svarar på frågor om ett specifikt dokument av typen {label}.\n\n"
            f"{doc_context}"
        )

        messages: list[dict[str, str]] = [{"role": "system", "content": system_msg}]
        for turn in history[-MAX_HISTORY_TURNS * 2 :]:
            messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": message})

        return WorkspaceContext(
            source_count=1,
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
    def _parse_numeric(value: str) -> float | None:
        """Parse a Swedish-formatted numeric string to float, or return None."""
        text = value.strip()
        if not text:
            return None
        # Strip currency suffix
        text = _CURRENCY_SUFFIX_RE.sub("", text).strip()
        if not text:
            return None
        # Remove internal spaces and non-breaking spaces (thousands separators)
        text = text.replace(" ", "").replace("\u00a0", "")
        # Swedish comma decimal → dot decimal
        text = text.replace(",", ".")
        try:
            return float(text)
        except ValueError:
            return None

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
