from __future__ import annotations

from pathlib import Path

import pytest

from server.pipelines.file_organizer import FileOrganizer
from server.schemas import DocumentClassification


def build_classification(
    *,
    document_type: str = "receipt",
    confidence: float = 0.91,
) -> DocumentClassification:
    return DocumentClassification(
        document_type=document_type,
        template=document_type,
        title="ICA Maxi kvitto",
        summary="Matvarukvitto 342 kr",
        tags=["receipt", "ica"],
        language="sv",
        confidence=confidence,
        ocr_text="ICA Maxi 2026-03-01 342 kr",
        suggested_actions=["archive"],
    )


def test_plan_move_renders_destination_from_rule(tmp_path: Path) -> None:
    rules_path = tmp_path / "file_rules.yaml"
    rules_path.write_text(
        "\n".join(
            [
                "version: 1",
                "default_mode: confirm",
                "rules:",
                "  - name: receipts",
                "    when:",
                "      document_type: receipt",
                "      min_confidence: 0.85",
                "    destination: ~/Documents/Kvitton/{year}/{month}/",
                "    auto_move: true",
            ]
        ),
        encoding="utf-8",
    )

    organizer = FileOrganizer(rules_path)

    move_plan = organizer.plan_move("kvitto_ica.jpg", build_classification())

    assert move_plan.rule_name == "receipts"
    assert move_plan.auto_move_allowed is True
    assert move_plan.destination is not None
    assert move_plan.destination.endswith("/Documents/Kvitton/2026/03")


def test_plan_move_requires_confirmation_when_confidence_is_low(tmp_path: Path) -> None:
    rules_path = tmp_path / "file_rules.yaml"
    rules_path.write_text(
        "\n".join(
            [
                "version: 1",
                "default_mode: confirm",
                "rules:",
                "  - name: receipts",
                "    when:",
                "      document_type: receipt",
                "      min_confidence: 0.85",
                "    destination: ~/Documents/Kvitton/{year}/{month}/",
                "    auto_move: true",
            ]
        ),
        encoding="utf-8",
    )

    organizer = FileOrganizer(rules_path)

    move_plan = organizer.plan_move(
        "kvitto_ica.jpg",
        build_classification(confidence=0.42),
    )

    assert move_plan.auto_move_allowed is False
    assert move_plan.reason == "confidence_below_threshold"


def test_execute_move_moves_file_into_planned_directory(tmp_path: Path) -> None:
    rules_path = tmp_path / "file_rules.yaml"
    destination_root = tmp_path / "sorted"
    rules_path.write_text(
        "\n".join(
            [
                "version: 1",
                "default_mode: confirm",
                "rules:",
                "  - name: receipts",
                "    when:",
                "      document_type: receipt",
                "      min_confidence: 0.85",
                f"    destination: {destination_root.as_posix()}" + "/{year}/{month}/",
                "    auto_move: true",
            ]
        ),
        encoding="utf-8",
    )

    source_file = tmp_path / "receipt.txt"
    source_file.write_text("content", encoding="utf-8")

    organizer = FileOrganizer(rules_path)
    move_plan = organizer.plan_move("receipt.txt", build_classification())

    move_result = organizer.execute_move(move_plan, source_file)

    assert move_result.attempted is True
    assert move_result.success is True
    assert move_result.to_path is not None
    assert Path(move_result.to_path).exists()
    assert not source_file.exists()


def test_invalid_rules_raise_on_load(tmp_path: Path) -> None:
    rules_path = tmp_path / "file_rules.yaml"
    rules_path.write_text(
        "\n".join(
            [
                "version: 1",
                "rules:",
                "  - name: broken",
                "    when:",
                "      min_confidence: 0.85",
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError):
        FileOrganizer(rules_path)
