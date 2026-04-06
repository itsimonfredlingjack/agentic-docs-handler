from __future__ import annotations

import hashlib
import math
import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime

from server.locale import msg
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Protocol

from server.schemas import DiscoveryCard, DiscoveryFileRef

_TOKEN_RE = re.compile(r"[\wÅÄÖåäö]+", re.UNICODE)

EXACT_DUPLICATE_CONFIDENCE = 1.0
NEAR_DUPLICATE_THRESHOLD = 0.92
VERSION_THRESHOLD = 0.85
TITLE_SIMILARITY_THRESHOLD = 0.6
RELATED_ENTITY_MIN = 2


def utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


class Embedder(Protocol):
    def encode_documents(self, texts: list[str]) -> list[list[float]]: ...


class SearchPipelineLike(Protocol):
    embedder: Embedder


class DocumentRegistryLike(Protocol):
    conn: sqlite3.Connection

    def list_documents_by_workspace(self, *, workspace_id: str, limit: int = 200) -> list[Any]: ...

    def get_entities_for_document(self, *, record_id: str) -> list[dict[str, str]]: ...


@dataclass(slots=True)
class _CandidateRelation:
    id: str
    file_a_id: str
    file_b_id: str
    relation_type: str
    confidence: float
    explanation: str
    created_at: str


class WorkspaceDiscoveryPipeline:
    def __init__(
        self,
        *,
        document_registry: DocumentRegistryLike,
        search_pipeline: SearchPipelineLike,
    ) -> None:
        self.document_registry = document_registry
        self.search_pipeline = search_pipeline
        self._ensure_schema()

    def generate(self, *, workspace_id: str, force: bool = False) -> list[DiscoveryCard]:
        records = self.document_registry.list_documents_by_workspace(
            workspace_id=workspace_id,
            limit=500,
        )
        signature = self._compute_signature(records)
        state_row = self.document_registry.conn.execute(
            "SELECT content_signature FROM workspace_discovery_state WHERE workspace_id = ?",
            (workspace_id,),
        ).fetchone()
        if not force and state_row is not None and state_row["content_signature"] == signature:
            return self.list_cards(workspace_id=workspace_id)

        relations = self._build_relations(records)
        self._replace_workspace_relations(workspace_id=workspace_id, relations=relations)
        with self.document_registry.conn:
            self.document_registry.conn.execute(
                """
                INSERT OR REPLACE INTO workspace_discovery_state
                (workspace_id, content_signature, generated_at)
                VALUES (?, ?, ?)
                """,
                (workspace_id, signature, utcnow_iso()),
            )
        return self.list_cards(workspace_id=workspace_id)

    def list_cards(self, *, workspace_id: str) -> list[DiscoveryCard]:
        rows = self.document_registry.conn.execute(
            """
            SELECT
                fr.id,
                fr.relation_type,
                fr.confidence,
                fr.explanation,
                fr.created_at,
                a.id AS file_a_id,
                a.title AS file_a_title,
                a.source_path AS file_a_source_path,
                a.kind AS file_a_kind,
                b.id AS file_b_id,
                b.title AS file_b_title,
                b.source_path AS file_b_source_path,
                b.kind AS file_b_kind
            FROM file_relation fr
            JOIN document a ON a.id = fr.file_a_id
            JOIN document b ON b.id = fr.file_b_id
            LEFT JOIN file_relation_dismissed fd ON fd.relation_id = fr.id
            WHERE a.workspace_id = ? AND b.workspace_id = ? AND fd.relation_id IS NULL
            ORDER BY fr.confidence DESC, fr.created_at DESC, fr.id ASC
            """,
            (workspace_id, workspace_id),
        ).fetchall()
        return [
            DiscoveryCard(
                id=row["id"],
                relation_type=row["relation_type"],
                confidence=float(row["confidence"]),
                explanation=row["explanation"],
                files=[
                    DiscoveryFileRef(
                        id=row["file_a_id"],
                        title=row["file_a_title"],
                        source_path=row["file_a_source_path"],
                        kind=row["file_a_kind"],
                    ),
                    DiscoveryFileRef(
                        id=row["file_b_id"],
                        title=row["file_b_title"],
                        source_path=row["file_b_source_path"],
                        kind=row["file_b_kind"],
                    ),
                ],
                created_at=row["created_at"],
                metadata=self._build_metadata(row),
            )
            for row in rows
        ]

    @staticmethod
    def _build_metadata(row: sqlite3.Row) -> dict[str, Any]:
        relation_type = row["relation_type"]
        confidence = float(row["confidence"])
        if relation_type == "duplicate":
            return {"is_exact_hash": confidence >= EXACT_DUPLICATE_CONFIDENCE}
        if relation_type == "version":
            return {"similarity_pct": round(confidence * 100)}
        if relation_type == "related":
            explanation = row["explanation"]
            # Extract entity names from the localized explanation string
            # Pattern: "... entiteter: X, Y" or "... entities: X, Y"
            match = re.search(r"(?:entiteter|entities):\s*(.+)", explanation)
            if match:
                entities = [e.strip() for e in match.group(1).split(",") if e.strip()]
                return {"shared_entities": entities}
        return {}

    def dismiss_relation(self, *, relation_id: str) -> None:
        with self.document_registry.conn:
            self.document_registry.conn.execute(
                """
                INSERT OR REPLACE INTO file_relation_dismissed (relation_id, dismissed_at)
                VALUES (?, ?)
                """,
                (relation_id, utcnow_iso()),
            )

    def _build_relations(self, records: list[Any]) -> list[_CandidateRelation]:
        if len(records) < 2:
            return []

        created_at = utcnow_iso()
        pair_claims: set[tuple[str, str]] = set()
        relations: list[_CandidateRelation] = []
        hashes = self._compute_hashes(records)
        similarities = self._compute_similarities(records)
        entity_names = {
            getattr(record, "id"): {
                entity["name"]
                for entity in self.document_registry.get_entities_for_document(record_id=getattr(record, "id"))
                if entity.get("name")
            }
            for record in records
        }

        by_hash: dict[str, list[Any]] = {}
        for record in records:
            digest = hashes.get(getattr(record, "id"))
            if digest:
                by_hash.setdefault(digest, []).append(record)

        for duplicates in by_hash.values():
            if len(duplicates) < 2:
                continue
            for index, left in enumerate(duplicates):
                for right in duplicates[index + 1 :]:
                    pair = self._pair_key(getattr(left, "id"), getattr(right, "id"))
                    pair_claims.add(pair)
                    relations.append(
                        self._make_relation(
                            file_a_id=pair[0],
                            file_b_id=pair[1],
                            relation_type="duplicate",
                            confidence=EXACT_DUPLICATE_CONFIDENCE,
                            explanation=msg("discovery.exact_duplicate"),
                            created_at=created_at,
                        )
                    )

        for left, right, similarity in similarities:
            pair = self._pair_key(getattr(left, "id"), getattr(right, "id"))
            if pair in pair_claims:
                continue
            if self._looks_like_near_duplicate(left=left, right=right, similarity=similarity):
                pair_claims.add(pair)
                relations.append(
                    self._make_relation(
                        file_a_id=pair[0],
                        file_b_id=pair[1],
                        relation_type="duplicate",
                        confidence=similarity,
                        explanation=msg("discovery.near_duplicate", similarity=f"{similarity:.2f}"),
                        created_at=created_at,
                    )
                )

        for left, right, similarity in similarities:
            pair = self._pair_key(getattr(left, "id"), getattr(right, "id"))
            if pair in pair_claims:
                continue
            shared = sorted(entity_names.get(pair[0], set()) & entity_names.get(pair[1], set()))
            if len(shared) >= RELATED_ENTITY_MIN:
                pair_claims.add(pair)
                explanation = msg("discovery.related_entities", entities=", ".join(shared[:4]))
                relations.append(
                    self._make_relation(
                        file_a_id=pair[0],
                        file_b_id=pair[1],
                        relation_type="related",
                        confidence=min(0.99, 0.6 + 0.08 * len(shared)),
                        explanation=explanation,
                        created_at=created_at,
                    )
                )

        for left, right, similarity in similarities:
            pair = self._pair_key(getattr(left, "id"), getattr(right, "id"))
            if pair in pair_claims:
                continue
            if not self._looks_like_version(
                left=left,
                right=right,
                similarity=similarity,
                hashes=hashes,
            ):
                continue
            pair_claims.add(pair)
            relations.append(
                self._make_relation(
                    file_a_id=pair[0],
                    file_b_id=pair[1],
                    relation_type="version",
                    confidence=similarity,
                    explanation=msg("discovery.version_relation"),
                    created_at=created_at,
                )
            )

        relations.sort(key=lambda relation: (-relation.confidence, relation.id))
        return relations

    def _replace_workspace_relations(
        self,
        *,
        workspace_id: str,
        relations: list[_CandidateRelation],
    ) -> None:
        with self.document_registry.conn:
            self.document_registry.conn.execute(
                """
                DELETE FROM file_relation
                WHERE file_a_id IN (SELECT id FROM document WHERE workspace_id = ?)
                  AND file_b_id IN (SELECT id FROM document WHERE workspace_id = ?)
                """,
                (workspace_id, workspace_id),
            )
            for relation in relations:
                self.document_registry.conn.execute(
                    """
                    INSERT INTO file_relation
                    (id, file_a_id, file_b_id, relation_type, confidence, explanation, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        relation.id,
                        relation.file_a_id,
                        relation.file_b_id,
                        relation.relation_type,
                        relation.confidence,
                        relation.explanation,
                        relation.created_at,
                    ),
                )

    def _compute_signature(self, records: list[Any]) -> str:
        pieces = [
            f"{getattr(record, 'id')}:{getattr(record, 'updated_at', '')}:{getattr(record, 'title', '')}"
            for record in sorted(records, key=lambda item: getattr(item, "id", ""))
        ]
        digest = hashlib.sha1("|".join(pieces).encode("utf-8")).hexdigest()
        return f"{len(records)}:{digest}"

    def _compute_hashes(self, records: list[Any]) -> dict[str, str]:
        hashes: dict[str, str] = {}
        for record in records:
            source_path = getattr(record, "source_path", None)
            if not source_path:
                continue
            path = Path(source_path)
            if not path.is_file():
                continue
            hashes[getattr(record, "id")] = hashlib.sha256(path.read_bytes()).hexdigest()
        return hashes

    def _compute_similarities(self, records: list[Any]) -> list[tuple[Any, Any, float]]:
        texts = [self._canonical_text(record) for record in records]
        vectors = self.search_pipeline.embedder.encode_documents(texts)
        similarities: list[tuple[Any, Any, float]] = []
        for index, left in enumerate(records):
            for offset, right in enumerate(records[index + 1 :], start=index + 1):
                similarities.append((left, right, self._cosine(vectors[index], vectors[offset])))
        similarities.sort(key=lambda item: item[2], reverse=True)
        return similarities

    def _looks_like_version(
        self,
        *,
        left: Any,
        right: Any,
        similarity: float,
        hashes: dict[str, str],
    ) -> bool:
        if similarity < VERSION_THRESHOLD:
            return False
        if hashes.get(getattr(left, "id")) and hashes.get(getattr(left, "id")) == hashes.get(getattr(right, "id")):
            return False
        if getattr(left, "kind", None) != getattr(right, "kind", None):
            return False
        title_similarity = SequenceMatcher(
            None,
            self._normalize_title(getattr(left, "title", "")),
            self._normalize_title(getattr(right, "title", "")),
        ).ratio()
        return title_similarity >= TITLE_SIMILARITY_THRESHOLD

    def _looks_like_near_duplicate(
        self,
        *,
        left: Any,
        right: Any,
        similarity: float,
    ) -> bool:
        if similarity < NEAR_DUPLICATE_THRESHOLD:
            return False
        if getattr(left, "kind", None) != getattr(right, "kind", None):
            return False
        left_title = self._normalize_title(getattr(left, "title", ""))
        right_title = self._normalize_title(getattr(right, "title", ""))
        if self._contains_version_marker(left_title) or self._contains_version_marker(right_title):
            return False
        title_similarity = SequenceMatcher(None, left_title, right_title).ratio()
        return title_similarity >= 0.88

    def _canonical_text(self, record: Any) -> str:
        parts = [
            getattr(record, "title", "") or "",
            getattr(record, "summary", "") or "",
            getattr(record, "document_type", "") or "",
        ]
        extraction = getattr(record, "extraction", None)
        fields = getattr(extraction, "fields", {}) if extraction is not None else {}
        for key in sorted(fields):
            value = fields.get(key)
            if value:
                parts.append(f"{key}: {value}")
        transcription = getattr(record, "transcription", None)
        if transcription is not None and getattr(transcription, "text", None):
            parts.append(getattr(transcription, "text"))
        return "\n".join(part for part in parts if part).strip()

    @staticmethod
    def _normalize_title(title: str) -> str:
        return " ".join(_TOKEN_RE.findall(title.casefold()))

    @staticmethod
    def _contains_version_marker(title: str) -> bool:
        return bool(re.search(r"\b(v\d+|version|rev|utkast)\b", title))

    @staticmethod
    def _cosine(left: list[float], right: list[float]) -> float:
        if not left or not right or len(left) != len(right):
            return 0.0
        numerator = sum(a * b for a, b in zip(left, right, strict=True))
        left_norm = math.sqrt(sum(a * a for a in left))
        right_norm = math.sqrt(sum(b * b for b in right))
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return numerator / (left_norm * right_norm)

    @staticmethod
    def _pair_key(file_a_id: str, file_b_id: str) -> tuple[str, str]:
        return tuple(sorted((file_a_id, file_b_id)))

    def _make_relation(
        self,
        *,
        file_a_id: str,
        file_b_id: str,
        relation_type: str,
        confidence: float,
        explanation: str,
        created_at: str,
    ) -> _CandidateRelation:
        pair = self._pair_key(file_a_id, file_b_id)
        relation_id = hashlib.sha1(
            f"{pair[0]}:{pair[1]}:{relation_type}".encode("utf-8")
        ).hexdigest()
        return _CandidateRelation(
            id=relation_id,
            file_a_id=pair[0],
            file_b_id=pair[1],
            relation_type=relation_type,
            confidence=round(confidence, 4),
            explanation=explanation,
            created_at=created_at,
        )

    def _ensure_schema(self) -> None:
        self.document_registry.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS workspace_discovery_state (
                workspace_id TEXT PRIMARY KEY,
                content_signature TEXT NOT NULL,
                generated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS file_relation_dismissed (
                relation_id TEXT PRIMARY KEY REFERENCES file_relation(id) ON DELETE CASCADE,
                dismissed_at TEXT NOT NULL
            );
            """
        )
