from __future__ import annotations

import hashlib
from pathlib import Path

from server.document_registry import DocumentRegistry
from server.migrations.jsonl_to_sqlite import create_inbox_workspace, create_schema
from server.pipelines.discovery import WorkspaceDiscoveryPipeline
from server.schemas import (
    DocumentClassification,
    ExtractedEntity,
    ExtractionResult,
    UiDocumentRecord,
)
from server.workspace_registry import WorkspaceRegistry


class FakeEmbedder:
    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vectorize(text) for text in texts]

    def encode_query(self, text: str) -> list[float]:
        return self._vectorize(text)

    @staticmethod
    def _vectorize(text: str) -> list[float]:
        lowered = text.casefold()
        tokens = lowered.split()
        return [
            float(lowered.count("budget")),
            float(lowered.count("version") + lowered.count("v1") + lowered.count("v2")),
            float(lowered.count("acme")),
            float(lowered.count("stockholm")),
            float(lowered.count("mötesanteckningar") + lowered.count("diskussion")),
            float(lowered.count("kontrakt")),
            float(lowered.count("faktura")),
            float(lowered.count("samma")),
            float(len(tokens)),
        ]


class FakeSearchPipeline:
    def __init__(self) -> None:
        self.embedder = FakeEmbedder()


def build_record(
    *,
    record_id: str,
    title: str,
    summary: str,
    source_path: str,
    kind: str = "generic",
) -> UiDocumentRecord:
    return UiDocumentRecord(
        id=record_id,
        request_id=f"req-{record_id}",
        title=title,
        summary=summary,
        mime_type="application/pdf",
        source_modality="text",
        kind=kind,
        document_type=kind,
        template=kind,
        source_path=source_path,
        created_at="2026-03-28T09:00:00Z",
        updated_at="2026-03-28T09:00:00Z",
        classification=DocumentClassification(
            document_type=kind,
            template=kind,
            title=title,
            summary=summary,
            tags=[],
            language="sv",
            confidence=0.9,
            ocr_text=None,
            suggested_actions=[],
        ),
        extraction=ExtractionResult(fields={}, field_confidence={}, missing_fields=[]),
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


def write_file(path: Path, content: bytes) -> str:
    path.write_bytes(content)
    return str(path)


def test_discovery_generates_and_caches_workspace_relations(tmp_path: Path) -> None:
    db_path = tmp_path / "registry.sqlite"
    registry = DocumentRegistry(db_path=db_path)
    create_schema(registry.conn)
    inbox_id = create_inbox_workspace(registry.conn)
    workspace_registry = WorkspaceRegistry(conn=registry.conn)
    workspace = workspace_registry.create_workspace(name="Projekt Acme")

    duplicate_a = write_file(tmp_path / "duplicate-a.pdf", b"same-bytes")
    duplicate_b = write_file(tmp_path / "duplicate-b.pdf", b"same-bytes")
    related_a = write_file(tmp_path / "related-a.pdf", b"related-a")
    related_b = write_file(tmp_path / "related-b.pdf", b"related-b")
    version_a = write_file(tmp_path / "version-a.pdf", b"version-a")
    version_b = write_file(tmp_path / "version-b.pdf", b"version-b")

    registry.upsert_document(
        build_record(
            record_id="dup-a",
            title="Acme faktura kopia 1",
            summary="Exakt samma underlag",
            source_path=duplicate_a,
        ),
        workspace_id=workspace.id,
    )
    registry.upsert_document(
        build_record(
            record_id="dup-b",
            title="Acme faktura kopia 2",
            summary="Exakt samma underlag",
            source_path=duplicate_b,
        ),
        workspace_id=workspace.id,
    )
    registry.upsert_document(
        build_record(
            record_id="rel-a",
            title="Mötesanteckningar Acme",
            summary="Diskussion om Acme i Stockholm",
            source_path=related_a,
        ),
        workspace_id=workspace.id,
    )
    registry.upsert_document(
        build_record(
            record_id="rel-b",
            title="Kontrakt Acme",
            summary="Kontrakt för Acme i Stockholm",
            source_path=related_b,
        ),
        workspace_id=workspace.id,
    )
    registry.upsert_document(
        build_record(
            record_id="ver-a",
            title="Budget 2026 v1",
            summary="Budget version 1 för Acme",
            source_path=version_a,
        ),
        workspace_id=workspace.id,
    )
    registry.upsert_document(
        build_record(
            record_id="ver-b",
            title="Budget 2026 v2",
            summary="Budget version 2 för Acme",
            source_path=version_b,
        ),
        workspace_id=workspace.id,
    )

    registry.upsert_entities(
        file_id="rel-a",
        entities=[
            ExtractedEntity(name="Acme AB", entity_type="company", context="Bolaget Acme AB"),
            ExtractedEntity(name="Stockholm", entity_type="place", context="Plats Stockholm"),
        ],
    )
    registry.upsert_entities(
        file_id="rel-b",
        entities=[
            ExtractedEntity(name="Acme AB", entity_type="company", context="Bolaget Acme AB"),
            ExtractedEntity(name="Stockholm", entity_type="place", context="Plats Stockholm"),
        ],
    )

    pipeline = WorkspaceDiscoveryPipeline(
        document_registry=registry,
        search_pipeline=FakeSearchPipeline(),
    )

    first = pipeline.generate(workspace_id=workspace.id)
    relation_types = {card.relation_type for card in first}

    assert relation_types == {"duplicate", "related", "version"}

    duplicate = next(card for card in first if card.relation_type == "duplicate")
    related = next(card for card in first if card.relation_type == "related")
    version = next(card for card in first if card.relation_type == "version")

    assert {file.id for file in duplicate.files} == {"dup-a", "dup-b"}
    assert "Acme AB" in related.explanation
    assert {file.id for file in version.files} == {"ver-a", "ver-b"}

    rows_before = registry.conn.execute("SELECT COUNT(*) FROM file_relation").fetchone()[0]
    second = pipeline.generate(workspace_id=workspace.id)
    rows_after = registry.conn.execute("SELECT COUNT(*) FROM file_relation").fetchone()[0]

    assert [card.id for card in second] == [card.id for card in first]
    assert rows_after == rows_before

    pipeline.dismiss_relation(relation_id=duplicate.id)
    visible = pipeline.list_cards(workspace_id=workspace.id)

    assert all(card.id != duplicate.id for card in visible)
    assert any(card.id == related.id for card in visible)

    exact_hash = hashlib.sha256(Path(duplicate_a).read_bytes()).hexdigest()
    assert exact_hash
    assert inbox_id
