"""Workspace brief generation pipeline.

Generates ai_brief (LLM narrative), ai_entities (aggregated from entity tables),
and ai_topics (collected from classification tags) for a workspace.
"""
from __future__ import annotations

import logging
from collections import Counter
from typing import Any

from server.document_registry import DocumentRegistry
from server.schemas import UiDocumentRecord
from server.workspace_registry import WorkspaceRegistry

logger = logging.getLogger(__name__)

_MAX_FILES_FOR_BRIEF = 100
_MAX_ENTITIES_ON_WORKSPACE = 50
_MAX_TOPICS_ON_WORKSPACE = 20


class WorkspaceBriefPipeline:
    def __init__(
        self,
        *,
        ollama_client: Any,
        system_prompt: str,
        document_registry: DocumentRegistry,
        workspace_registry: WorkspaceRegistry,
    ) -> None:
        self.ollama_client = ollama_client
        self.system_prompt = system_prompt
        self.document_registry = document_registry
        self.workspace_registry = workspace_registry

    async def generate(self, *, workspace_id: str) -> dict[str, Any]:
        """Generate and persist workspace brief, entities, and topics.

        Returns dict with ai_brief, ai_entities, ai_topics.
        """
        workspace = self.workspace_registry.get_workspace(workspace_id=workspace_id)
        if workspace is None:
            raise KeyError("unknown_workspace_id")

        documents = self.document_registry.list_documents_by_workspace(
            workspace_id=workspace_id,
            limit=_MAX_FILES_FOR_BRIEF,
        )

        # Aggregate entities from the entity tables (no LLM needed)
        ai_entities = _aggregate_entities(self.document_registry, documents)

        # Collect topics from classification tags (no LLM needed)
        ai_topics = _collect_topics(documents)

        # Generate narrative brief (LLM call)
        ai_brief = ""
        if documents:
            context = _build_brief_context(documents, ai_entities)
            ai_brief = await self._generate_brief_text(context, workspace.name)

        # Persist
        self.workspace_registry.update_workspace(
            workspace_id=workspace_id,
            ai_brief=ai_brief,
            ai_entities=ai_entities,
            ai_topics=ai_topics,
        )

        logger.info(
            "Generated brief for workspace %s: %d chars, %d entities, %d topics",
            workspace_id, len(ai_brief), len(ai_entities), len(ai_topics),
        )

        return {
            "ai_brief": ai_brief,
            "ai_entities": ai_entities,
            "ai_topics": ai_topics,
        }

    async def _generate_brief_text(self, context: str, workspace_name: str) -> str:
        """Call LLM to produce a narrative summary."""
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": f"Workspace: {workspace_name}\n\n{context}"},
        ]
        try:
            text = await self.ollama_client.chat_text(
                request_id=f"brief_{workspace_name}",
                prompt_name="workspace_brief",
                input_modality="text",
                messages=messages,
                temperature=0.3,
            )
            return text.strip()
        except Exception:
            logger.warning("Brief generation LLM call failed for %s", workspace_name, exc_info=True)
            return ""


def _aggregate_entities(
    registry: DocumentRegistry,
    documents: list[UiDocumentRecord],
) -> list[dict[str, str]]:
    """Collect and deduplicate entities across all documents in a workspace."""
    seen: dict[tuple[str, str], dict[str, str]] = {}
    for doc in documents:
        doc_entities = registry.get_entities_for_document(record_id=doc.id)
        for entity in doc_entities:
            key = (entity["name"].lower(), entity["entity_type"])
            if key not in seen:
                seen[key] = entity
            elif len(entity.get("context", "")) > len(seen[key].get("context", "")):
                seen[key] = entity

    # Sort: people and companies first, then by name
    type_order = {"person": 0, "company": 1, "amount": 2, "date": 3, "place": 4, "topic": 5}
    sorted_entities = sorted(
        seen.values(),
        key=lambda e: (type_order.get(e["entity_type"], 9), e["name"]),
    )
    return sorted_entities[:_MAX_ENTITIES_ON_WORKSPACE]


def _collect_topics(documents: list[UiDocumentRecord]) -> list[str]:
    """Collect and count topic tags from all document classifications."""
    counter: Counter[str] = Counter()
    for doc in documents:
        for tag in doc.classification.tags:
            normalized = tag.strip().lower()
            if normalized and len(normalized) >= 2:
                counter[normalized] += 1

    # Return most common topics, preserving original casing from first occurrence
    first_occurrence: dict[str, str] = {}
    for doc in documents:
        for tag in doc.classification.tags:
            normalized = tag.strip().lower()
            if normalized not in first_occurrence:
                first_occurrence[normalized] = tag.strip()

    return [
        first_occurrence.get(topic, topic)
        for topic, _ in counter.most_common(_MAX_TOPICS_ON_WORKSPACE)
    ]


def _build_brief_context(
    documents: list[UiDocumentRecord],
    entities: list[dict[str, str]],
) -> str:
    """Build the LLM context from documents and entities."""
    lines: list[str] = []

    # File list
    lines.append(f"FILER ({len(documents)} st):")
    for doc in documents[:50]:  # Cap to keep prompt manageable
        doc_type = doc.document_type or doc.kind
        lines.append(f"- [{doc_type}] {doc.title}: {doc.summary[:150]}")

    # Entities
    if entities:
        lines.append("")
        lines.append("ENTITETER:")
        for entity in entities[:30]:
            lines.append(f"- [{entity['entity_type']}] {entity['name']}")

    # Basic stats
    type_counts: Counter[str] = Counter()
    for doc in documents:
        type_counts[doc.document_type or doc.kind] += 1

    lines.append("")
    lines.append("STATISTIK:")
    for doc_type, count in type_counts.most_common():
        lines.append(f"- {doc_type}: {count} filer")

    return "\n".join(lines)
