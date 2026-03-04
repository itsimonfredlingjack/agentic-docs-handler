from __future__ import annotations

import json
from pathlib import Path

from server.main import load_validation_report


def test_load_validation_report_reads_latest_json(tmp_path: Path) -> None:
    report_path = tmp_path / "latest.json"
    report_path.write_text(json.dumps({"status": "ok", "parse_rate": 0.98}), encoding="utf-8")

    report = load_validation_report(report_path)

    assert report["status"] == "ok"
    assert report["parse_rate"] == 0.98


def test_load_validation_report_returns_missing_status_for_absent_file(tmp_path: Path) -> None:
    report = load_validation_report(tmp_path / "missing.json")

    assert report["status"] == "missing"
