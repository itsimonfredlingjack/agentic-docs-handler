from __future__ import annotations

import shutil
from pathlib import Path

from server.document_registry import DocumentRegistry
from server.migrations.jsonl_to_sqlite import create_schema, create_inbox_workspace
from server.schemas import (
    DocumentClassification,
    ExtractionResult,
    MovePlan,
    MoveResult,
    UiDocumentRecord,
)


def _make_registry(tmp_path: Path) -> DocumentRegistry:
    """Create a fresh registry with schema initialized."""
    db_path = tmp_path / "test.db"
    registry = DocumentRegistry(db_path=db_path)
    create_schema(registry.conn)
    create_inbox_workspace(registry.conn)
    return registry


def build_record(*, record_id: str, source_path: str) -> UiDocumentRecord:
    return UiDocumentRecord(
        id=record_id,
        request_id=f"req-{record_id}",
        title="ICA receipt",
        summary="Receipt summary",
        mime_type="image/png",
        source_modality="image",
        kind="receipt",
        document_type="receipt",
        template="receipt",
        source_path=source_path,
        created_at="2026-03-04T10:00:00+00:00",
        updated_at="2026-03-04T10:00:00+00:00",
        classification=DocumentClassification(
            document_type="receipt",
            template="receipt",
            title="ICA receipt",
            summary="Receipt summary",
            tags=["receipt"],
            language="sv",
            confidence=0.95,
            ocr_text=None,
            suggested_actions=[],
        ),
        extraction=ExtractionResult(fields={"amount": "100 SEK"}, field_confidence={"amount": 0.9}, missing_fields=[]),
        move_plan=MovePlan(
            rule_name="receipts",
            destination="/tmp/Documents/Kvitton/2026/03",
            auto_move_allowed=True,
            reason="rule_matched",
        ),
        move_result=MoveResult(
            attempted=True,
            success=True,
            from_path="/tmp/incoming/receipt.png",
            to_path=source_path,
            error=None,
        ),
        tags=["receipt"],
        status="completed",
        undo_token=None,
    )


def test_registry_persists_documents_and_counts(tmp_path: Path) -> None:
    registry = _make_registry(tmp_path)
    registry.upsert_document(build_record(record_id="doc-1", source_path="/tmp/sorted/receipt.png"))

    # Re-read from the same DB (verifies SQLite persistence, not just in-memory)
    registry2 = DocumentRegistry(db_path=tmp_path / "test.db")

    payload = registry2.list_documents(limit=10)
    assert payload.total == 1
    assert payload.documents[0].id == "doc-1"
    counts = registry2.counts()
    assert counts.all == 1
    assert counts.receipt == 1
    assert counts.moved == 1


def test_registry_undo_move_restores_file_and_document_path(tmp_path: Path) -> None:
    registry = _make_registry(tmp_path)
    incoming_dir = tmp_path / "incoming"
    sorted_dir = tmp_path / "sorted"
    incoming_dir.mkdir()
    sorted_dir.mkdir()
    source_file = incoming_dir / "receipt.png"
    source_file.write_bytes(b"image")
    moved_file = sorted_dir / "receipt.png"
    shutil.move(source_file, moved_file)
    registry.upsert_document(build_record(record_id="doc-1", source_path=str(moved_file)))
    move_entry = registry.record_move(
        request_id="req-doc-1",
        record_id="doc-1",
        from_path=str(source_file),
        to_path=str(moved_file),
        client_id="client-1",
    )

    result = registry.undo_move(move_entry.undo_token)

    assert result.response.success is True
    assert source_file.exists()
    assert not moved_file.exists()
    reloaded = registry.list_documents(limit=10)
    assert reloaded.documents[0].source_path == str(source_file)
    assert reloaded.documents[0].undo_token is None
