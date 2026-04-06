from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import uuid4

from server.pipelines.search import SearchPipeline

logger = logging.getLogger(__name__)

from server.locale import category_labels as _get_category_labels, msg as _msg

def _category_labels() -> dict[str, str]:
    return _get_category_labels()

MAX_HISTORY_TURNS = 10
MAX_CONTEXT_DOCUMENTS = 200
RAG_SEARCH_LIMIT = 12
FALLBACK_DOCUMENT_LIMIT = 20
MAX_AGGREGATE_FIELDS = 5

# Token budget proportions
BUDGET_SYSTEM = 0.10
BUDGET_FIELDS = 0.40
BUDGET_MEMORY = 0.10
BUDGET_RAG = 0.15
BUDGET_HISTORY = 0.15
BUDGET_MARGIN = 0.10

DEFAULT_NUM_CTX = 16384

_CURRENCY_SUFFIX_RE = re.compile(r"\s*(kr|sek)\s*$", re.IGNORECASE)


def estimate_tokens(text: str) -> int:
    """Estimate token count: ~4 characters per token (conservative for Swedish)."""
    return len(text) // 4


def compute_token_budget(num_ctx: int) -> dict[str, int]:
    """Compute token budgets per section from the total context window size."""
    allocated = (
        int(num_ctx * BUDGET_SYSTEM)
        + int(num_ctx * BUDGET_FIELDS)
        + int(num_ctx * BUDGET_MEMORY)
        + int(num_ctx * BUDGET_RAG)
        + int(num_ctx * BUDGET_HISTORY)
    )
    return {
        "system": int(num_ctx * BUDGET_SYSTEM),
        "fields": int(num_ctx * BUDGET_FIELDS),
        "memory": int(num_ctx * BUDGET_MEMORY),
        "rag": int(num_ctx * BUDGET_RAG),
        "history": int(num_ctx * BUDGET_HISTORY),
        "margin": num_ctx - allocated,
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

    def list_documents_by_workspace(
        self, *, workspace_id: str, limit: int = 200
    ) -> list[Any]: ...

    def get_document(self, *, record_id: str) -> Any | None: ...


@dataclass(slots=True)
class WorkspaceContext:
    source_count: int
    messages: list[dict[str, str]]
    request_id: str
    sources: list[dict[str, str]]


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
        conversation_registry: Any | None = None,
    ) -> None:
        self.ollama_client = ollama_client
        self.search_pipeline = search_pipeline
        self.document_registry = document_registry
        self.system_prompt = system_prompt
        self.temperature = temperature
        self.num_ctx = num_ctx
        self.conversation_registry = conversation_registry

    def _prepare_memory_block(
        self,
        *,
        conversation_key: str,
        token_budget: int,
        current_entry_ids: set[str] | None = None,
    ) -> str:
        """Build a condensed summary of past conversations for this workspace."""
        if self.conversation_registry is None:
            return ""
        if not hasattr(self.conversation_registry, "list_recent_entries"):
            return ""

        entries = self.conversation_registry.list_recent_entries(
            conversation_key=conversation_key,
            limit=20,
            exclude_ids=current_entry_ids,
        )
        if not entries:
            return ""

        lines: list[str] = []
        budget_chars = token_budget * 4  # ~4 chars per token
        used = 0
        for entry in entries:
            date_part = entry["timestamp"][:10] if entry.get("timestamp") else "?"
            line = f"- {date_part}: F: \"{entry['query']}\" S: \"{entry['response']}\""
            line_len = len(line)
            if used + line_len > budget_chars:
                break
            lines.append(line)
            used += line_len

        if not lines:
            return ""

        header = _msg("memory.header")
        return f"{header}\n" + "\n".join(lines)

    async def prepare_context(
        self,
        *,
        workspace_id: str | None = None,
        category: str | None = None,
        message: str,
        history: list[dict[str, str]],
        document_id: str | None = None,
    ) -> WorkspaceContext:
        request_id = str(uuid4())

        if document_id and workspace_id is not None:
            # Focused-document mode: workspace RAG + focused document as primary context
            return await self._prepare_focused_workspace_context(
                workspace_id=workspace_id,
                document_id=document_id,
                message=message,
                history=history,
                request_id=request_id,
            )

        if document_id:
            return self._prepare_document_context(
                document_id=document_id,
                category=category,
                workspace_id=workspace_id,
                message=message,
                history=history,
                request_id=request_id,
            )

        if workspace_id is not None:
            return await self._prepare_workspace_context(
                workspace_id=workspace_id,
                message=message,
                history=history,
                request_id=request_id,
            )

        resolved_category = category or "all"
        is_global = resolved_category == "all"
        budget = compute_token_budget(self.num_ctx)

        # 1. Fetch all documents for aggregate stats + source_count
        listing = self.document_registry.list_documents(
            kind=None if is_global else resolved_category, limit=MAX_CONTEXT_DOCUMENTS,
        )
        all_records = listing.documents
        source_count = len(all_records)

        # 2. RAG search
        enriched_records: list[Any] = []
        rag_snippets: list[str] = []
        try:
            search_result = await self.search_pipeline.search(
                message, limit=RAG_SEARCH_LIMIT, mode="fast",
                document_type=None if is_global else resolved_category,
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
        aggregate = self._build_aggregate_summary(all_records, resolved_category)
        fields_table = self._build_fields_table(enriched_records, resolved_category)
        rag_context = "\n".join(rag_snippets)

        # 5. Token-budgeted assembly
        label = _category_labels().get(resolved_category, _msg("chat.all_documents")) if not is_global else _msg("chat.all_documents")
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
            sources=[{"id": getattr(r, "id", ""), "title": getattr(r, "title", "")} for r in enriched_records],
        )

    async def _prepare_workspace_context(
        self,
        *,
        workspace_id: str,
        message: str,
        history: list[dict[str, str]],
        request_id: str,
    ) -> WorkspaceContext:
        budget = compute_token_budget(self.num_ctx)
        all_records = self.document_registry.list_documents_by_workspace(
            workspace_id=workspace_id,
            limit=MAX_CONTEXT_DOCUMENTS,
        )
        source_count = len(all_records)
        allowed_doc_ids = {getattr(record, "id", "") for record in all_records if getattr(record, "id", "")}

        enriched_records: list[Any] = []
        rag_snippets: list[str] = []
        try:
            search_result = await self.search_pipeline.search(
                message,
                limit=RAG_SEARCH_LIMIT,
                mode="fast",
                allowed_doc_ids=allowed_doc_ids,
            )
            if search_result.results:
                rag_snippets = [
                    f"[{r.title}]: {r.snippet}" for r in search_result.results
                ]
                seen_ids: set[str] = set()
                for result in search_result.results:
                    if result.doc_id in seen_ids:
                        continue
                    seen_ids.add(result.doc_id)
                    record = self.document_registry.get_document(record_id=result.doc_id)
                    if record is not None:
                        enriched_records.append(record)
        except Exception:
            logger.warning(
                "workspace_chat.workspace_rag_search_failed workspace_id=%s request_id=%s",
                workspace_id,
                request_id,
                exc_info=True,
            )

        if not enriched_records:
            enriched_records = all_records[:FALLBACK_DOCUMENT_LIMIT]

        aggregate = self._build_aggregate_summary(all_records, None)
        fields_table = self._build_fields_table(enriched_records, None)
        rag_context = "\n".join(rag_snippets)

        if estimate_tokens(fields_table) > budget["fields"]:
            rows = fields_table.split("\n")
            while len(rows) > 3 and estimate_tokens("\n".join(rows)) > budget["fields"]:
                rows.pop(-1)
            fields_table = "\n".join(rows)

        system_msg = (
            f"{self.system_prompt}\n\n"
            f"WORKSPACE_ID: {workspace_id}\n"
            f"ANTAL DOKUMENT: {source_count}\n"
            f"Referera alltid till filer med deras titel inom hakparenteser när du använder dem som källa.\n\n"
            f"{aggregate}\n\n"
            f"EXTRAHERADE FÄLT:\n{fields_table}"
        )

        if rag_context and estimate_tokens(rag_context) > budget["rag"]:
            lines = rag_context.split("\n")
            while len(lines) > 1 and estimate_tokens("\n".join(lines)) > budget["rag"]:
                lines.pop(-1)
            rag_context = "\n".join(lines)

        if rag_context:
            system_msg += f"\n\nRELEVANTA TEXTUTDRAG:\n{rag_context}"

        memory_block = self._prepare_memory_block(
            conversation_key=workspace_id,
            token_budget=budget["memory"],
        )
        if memory_block:
            system_msg += f"\n\n{memory_block}"

        messages: list[dict[str, str]] = [{"role": "system", "content": system_msg}]
        history_turns = history[-MAX_HISTORY_TURNS * 2:]
        history_budget_chars = budget["history"] * 4
        while history_turns and sum(len(t["content"]) for t in history_turns) > history_budget_chars:
            history_turns.pop(0)
        if history_turns and history_turns[0]["role"] == "assistant":
            history_turns.pop(0)
        for turn in history_turns:
            messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": message})

        return WorkspaceContext(
            source_count=source_count,
            messages=messages,
            request_id=request_id,
            sources=[{"id": getattr(r, "id", ""), "title": getattr(r, "title", "")} for r in enriched_records],
        )

    async def _prepare_focused_workspace_context(
        self,
        *,
        workspace_id: str,
        document_id: str,
        message: str,
        history: list[dict[str, str]],
        request_id: str,
    ) -> WorkspaceContext:
        """Workspace context with a focused document prepended as primary context."""
        # Fetch the focused document
        focused_record = self.document_registry.get_document(record_id=document_id)
        if focused_record is None:
            raise ValueError(f"Document {document_id} not found")

        # Build focused-document block
        focused_title = getattr(focused_record, "title", _msg("chat.unknown_document"))
        focused_summary = getattr(focused_record, "summary", "") or ""
        focused_extraction = getattr(focused_record, "extraction", None)
        focused_fields = focused_extraction.fields if focused_extraction is not None else {}

        focus_parts: list[str] = [f"FOKUSERAT DOKUMENT: {focused_title}"]
        if focused_summary:
            focus_parts.append(f"SAMMANFATTNING: {focused_summary}")
        if focused_fields:
            fields_str = "\n".join(f"  {k}: {v}" for k, v in focused_fields.items() if v)
            focus_parts.append(f"EXTRAHERADE FÄLT:\n{fields_str}")
        transcription = getattr(focused_record, "transcription", None)
        if transcription is not None:
            text = getattr(transcription, "text", None)
            if text:
                focus_parts.append(f"TRANSKRIBERING:\n{text}")
        focus_block = "\n\n".join(focus_parts)

        # Now build regular workspace context (same as _prepare_workspace_context)
        budget = compute_token_budget(self.num_ctx)
        all_records = self.document_registry.list_documents_by_workspace(
            workspace_id=workspace_id,
            limit=MAX_CONTEXT_DOCUMENTS,
        )
        source_count = len(all_records)
        allowed_doc_ids = {getattr(record, "id", "") for record in all_records if getattr(record, "id", "")}

        enriched_records: list[Any] = []
        rag_snippets: list[str] = []
        try:
            search_result = await self.search_pipeline.search(
                message,
                limit=RAG_SEARCH_LIMIT,
                mode="fast",
                allowed_doc_ids=allowed_doc_ids,
            )
            if search_result.results:
                rag_snippets = [
                    f"[{r.title}]: {r.snippet}" for r in search_result.results
                ]
                seen_ids: set[str] = set()
                for result in search_result.results:
                    if result.doc_id in seen_ids:
                        continue
                    seen_ids.add(result.doc_id)
                    record = self.document_registry.get_document(record_id=result.doc_id)
                    if record is not None:
                        enriched_records.append(record)
        except Exception:
            logger.warning(
                "workspace_chat.focused_workspace_rag_failed workspace_id=%s document_id=%s request_id=%s",
                workspace_id,
                document_id,
                request_id,
                exc_info=True,
            )

        if not enriched_records:
            enriched_records = all_records[:FALLBACK_DOCUMENT_LIMIT]

        # Ensure the focused document is in sources list
        focused_in_enriched = any(getattr(r, "id", "") == document_id for r in enriched_records)
        if not focused_in_enriched:
            enriched_records.insert(0, focused_record)

        aggregate = self._build_aggregate_summary(all_records, None)
        fields_table = self._build_fields_table(enriched_records, None)
        rag_context = "\n".join(rag_snippets)

        if estimate_tokens(fields_table) > budget["fields"]:
            rows = fields_table.split("\n")
            while len(rows) > 3 and estimate_tokens("\n".join(rows)) > budget["fields"]:
                rows.pop(-1)
            fields_table = "\n".join(rows)

        system_msg = (
            f"{self.system_prompt}\n\n"
            f"WORKSPACE_ID: {workspace_id}\n"
            f"ANTAL DOKUMENT: {source_count}\n"
            f"Användaren tittar just nu på ett specifikt dokument. "
            f"Prioritera det i dina svar, men du har tillgång till hela workspacens kontext.\n"
            f"Referera alltid till filer med deras titel inom hakparenteser när du använder dem som källa.\n\n"
            f"{focus_block}\n\n"
            f"{aggregate}\n\n"
            f"EXTRAHERADE FÄLT:\n{fields_table}"
        )

        if rag_context and estimate_tokens(rag_context) > budget["rag"]:
            lines = rag_context.split("\n")
            while len(lines) > 1 and estimate_tokens("\n".join(lines)) > budget["rag"]:
                lines.pop(-1)
            rag_context = "\n".join(lines)

        if rag_context:
            system_msg += f"\n\nRELEVANTA TEXTUTDRAG:\n{rag_context}"

        memory_block = self._prepare_memory_block(
            conversation_key=workspace_id,
            token_budget=budget["memory"],
        )
        if memory_block:
            system_msg += f"\n\n{memory_block}"

        messages: list[dict[str, str]] = [{"role": "system", "content": system_msg}]
        history_turns = history[-MAX_HISTORY_TURNS * 2:]
        history_budget_chars = budget["history"] * 4
        while history_turns and sum(len(t["content"]) for t in history_turns) > history_budget_chars:
            history_turns.pop(0)
        if history_turns and history_turns[0]["role"] == "assistant":
            history_turns.pop(0)
        for turn in history_turns:
            messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": message})

        return WorkspaceContext(
            source_count=source_count,
            messages=messages,
            request_id=request_id,
            sources=[{"id": getattr(r, "id", ""), "title": getattr(r, "title", "")} for r in enriched_records],
        )

    def _prepare_document_context(
        self,
        *,
        document_id: str,
        category: str | None,
        workspace_id: str | None,
        message: str,
        history: list[dict[str, str]],
        request_id: str,
    ) -> WorkspaceContext:
        record = self.document_registry.get_document(record_id=document_id)
        if record is None:
            raise ValueError(f"Document {document_id} not found")
        if workspace_id is not None and getattr(record, "workspace_id", None) != workspace_id:
            raise ValueError(f"Document {document_id} is not in workspace {workspace_id}")

        # Build rich context from the single document
        title = getattr(record, "title", _msg("chat.unknown_document"))
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

        resolved_category = category or getattr(record, "kind", "dokument")
        label = _category_labels().get(resolved_category, resolved_category)
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
            sources=[{"id": document_id, "title": title}],
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
    def _build_aggregate_summary(records: list[Any], category: str | None) -> str:
        """Build a compact one-line summary with aggregate statistics."""
        count = len(records)
        label = _category_labels().get(category, _msg("chat.documents_fallback")) if category else _msg("chat.documents_fallback")
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
    def _build_fields_table(records: list[Any], category: str | None) -> str:
        if not records:
            return "Inga dokument i denna vy."

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
