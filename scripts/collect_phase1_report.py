from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a markdown summary from the latest Phase 1 benchmark report.")
    parser.add_argument("--report-path", default="server/logs/validation/latest.json")
    parser.add_argument("--output-path", default="docs/validation/phase1-validation-report.md")
    return parser.parse_args()


def run() -> int:
    args = parse_args()
    report_path = Path(args.report_path)
    output_path = Path(args.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not report_path.exists():
        payload = {"status": "missing"}
    else:
        payload = json.loads(report_path.read_text(encoding="utf-8"))

    lines = [
        "# Phase 1 Validation Report",
        "",
        f"- Status: `{payload.get('status', 'unknown')}`",
        f"- Fixture count: `{payload.get('fixture_count', 0)}`",
        f"- Successful documents: `{payload.get('successful_documents', 0)}`",
        f"- Raw JSON parse rate: `{payload.get('parse_rate', 0.0)}`",
        f"- Schema validation rate: `{payload.get('schema_rate', 0.0)}`",
        f"- Critical field rate: `{payload.get('critical_field_rate', 0.0)}`",
        f"- All checks passed: `{payload.get('all_checks_passed', False)}`",
        "",
        "## Document Results",
        "",
    ]

    for item in payload.get("results", []):
        lines.append(
            f"- `{item.get('document')}` [{item.get('category')}] -> status `{item.get('status_code')}`"
        )
        if item.get("checks"):
            lines.append(f"  checks: `{json.dumps(item['checks'], ensure_ascii=False)}`")
        if item.get("error"):
            lines.append(f"  error: `{item['error']}`")

    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
