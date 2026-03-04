from __future__ import annotations

import argparse
import json
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx


@dataclass(slots=True)
class FixtureCase:
    category: str
    document_path: Path
    expectation_path: Path | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Phase 1 benchmarks against the FastAPI server.")
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    parser.add_argument("--fixtures-root", default="server/tests/fixtures")
    parser.add_argument("--llm-index", default="server/logs/llm/index.jsonl")
    parser.add_argument("--report-path", default="server/logs/validation/latest.json")
    parser.add_argument("--timeout-seconds", type=float, default=300.0)
    parser.add_argument("--limit", type=int, default=0)
    return parser.parse_args()


def discover_cases(fixtures_root: Path) -> list[FixtureCase]:
    cases: list[FixtureCase] = []
    for category in ("texts", "images", "mixed"):
        category_root = fixtures_root / category
        if not category_root.exists():
            continue
        for document_path in sorted(path for path in category_root.iterdir() if path.is_file()):
            if document_path.name.startswith(".") or document_path.suffix == ".json":
                continue
            expectation_path = document_path.with_suffix(".json")
            cases.append(
                FixtureCase(
                    category=category,
                    document_path=document_path,
                    expectation_path=expectation_path if expectation_path.exists() else None,
                )
            )
    return cases


def read_new_log_entries(index_path: Path, start_offset: int) -> list[dict[str, Any]]:
    if not index_path.exists():
        return []
    entries: list[dict[str, Any]] = []
    with index_path.open("r", encoding="utf-8") as handle:
        handle.seek(start_offset)
        for line in handle:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


def compare_expectations(payload: dict[str, Any], expectation: dict[str, Any]) -> dict[str, bool]:
    classification = payload.get("classification", {})
    extraction_fields = payload.get("extraction", {}).get("fields", {})
    move_plan = payload.get("move_plan", {})

    expected_fields = expectation.get("expected_fields", [])
    expected_destination_pattern = expectation.get("expected_destination_pattern")
    auto_move_expected = expectation.get("allow_auto_move")

    field_match = all(field in extraction_fields for field in expected_fields)
    title_match = expectation.get("expected_title_contains", "").lower() in classification.get("title", "").lower()
    destination_match = True
    if expected_destination_pattern:
        destination = move_plan.get("destination") or ""
        destination_match = expected_destination_pattern in destination
    auto_move_match = True
    if auto_move_expected is not None:
        auto_move_match = move_plan.get("auto_move_allowed") is auto_move_expected

    return {
        "document_type_match": classification.get("document_type") == expectation.get("expected_document_type"),
        "title_match": title_match,
        "field_match": field_match,
        "destination_match": destination_match,
        "auto_move_match": auto_move_match,
    }


def run() -> int:
    args = parse_args()
    fixtures_root = Path(args.fixtures_root)
    llm_index = Path(args.llm_index)
    report_path = Path(args.report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    start_offset = llm_index.stat().st_size if llm_index.exists() else 0
    cases = discover_cases(fixtures_root)
    if args.limit > 0:
        cases = cases[: args.limit]

    results: list[dict[str, Any]] = []
    with httpx.Client(base_url=args.base_url, timeout=args.timeout_seconds) as client:
        for case in cases:
            expectation = (
                json.loads(case.expectation_path.read_text(encoding="utf-8"))
                if case.expectation_path
                else {}
            )
            content_type = mimetypes.guess_type(case.document_path.name)[0] or "application/octet-stream"
            item: dict[str, Any] = {
                "category": case.category,
                "document": case.document_path.name,
            }
            try:
                with case.document_path.open("rb") as handle:
                    response = client.post(
                        "/process",
                        data={"execute_move": "false"},
                        files={"file": (case.document_path.name, handle.read(), content_type)},
                    )
                item["status_code"] = response.status_code
                if response.status_code == 200:
                    payload = response.json()
                    item["request_id"] = payload.get("request_id")
                    item["checks"] = compare_expectations(payload, expectation)
                else:
                    item["error"] = response.text
            except httpx.TimeoutException as error:
                item["status_code"] = 0
                item["error"] = f"timeout: {error}"
            except httpx.HTTPError as error:
                item["status_code"] = 0
                item["error"] = f"http_error: {error}"
            results.append(item)

    new_entries = read_new_log_entries(llm_index, start_offset)
    parse_rate = (
        sum(1 for entry in new_entries if entry.get("json_parse_ok")) / len(new_entries)
        if new_entries
        else 0.0
    )
    schema_rate = (
        sum(1 for entry in new_entries if entry.get("schema_validation_ok")) / len(new_entries)
        if new_entries
        else 0.0
    )
    successful_docs = [result for result in results if result["status_code"] == 200]
    checks = [
        check
        for result in successful_docs
        for check in result.get("checks", {}).values()
    ]
    critical_field_rate = (
        sum(1 for result in successful_docs if result.get("checks", {}).get("field_match")) / len(successful_docs)
        if successful_docs
        else 0.0
    )
    report = {
        "status": "ok" if results else "no-fixtures",
        "fixture_count": len(cases),
        "successful_documents": len(successful_docs),
        "parse_rate": round(parse_rate, 4),
        "schema_rate": round(schema_rate, 4),
        "critical_field_rate": round(critical_field_rate, 4),
        "all_checks_passed": all(checks) if checks else False,
        "results": results,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
