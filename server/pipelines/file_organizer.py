from __future__ import annotations

import re
import shutil
from datetime import UTC, datetime
from pathlib import Path

import yaml
from pydantic import BaseModel, Field, ValidationError

from server.schemas import DocumentClassification, MovePlan, MoveResult

DATE_PATTERN = re.compile(r"(?P<year>20\d{2})[-/](?P<month>\d{2})[-/](?P<day>\d{2})")


class RuleWhen(BaseModel):
    document_type: str
    min_confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class RuleEntry(BaseModel):
    name: str
    when: RuleWhen
    destination: str
    auto_move: bool = False


class RuleSet(BaseModel):
    version: int
    default_mode: str = "confirm"
    rules: list[RuleEntry]


class FileOrganizer:
    def __init__(self, rules_path: Path) -> None:
        self.rules_path = Path(rules_path)
        self.rule_set = self._load_rules(self.rules_path)

    @staticmethod
    def _load_rules(rules_path: Path) -> RuleSet:
        try:
            payload = yaml.safe_load(rules_path.read_text(encoding="utf-8")) or {}
            return RuleSet.model_validate(payload)
        except (OSError, yaml.YAMLError, ValidationError) as error:
            raise ValueError(f"invalid file organizer rules: {rules_path}") from error

    def plan_move(self, filename: str, classification: DocumentClassification) -> MovePlan:
        matching_rule = next(
            (
                rule
                for rule in self.rule_set.rules
                if rule.when.document_type == classification.document_type
            ),
            None,
        )

        if matching_rule is None:
            return MovePlan(
                rule_name=None,
                destination=None,
                auto_move_allowed=False,
                reason="no_matching_rule",
            )

        destination = self._render_destination(matching_rule.destination, filename, classification)
        if classification.confidence < matching_rule.when.min_confidence:
            return MovePlan(
                rule_name=matching_rule.name,
                destination=destination,
                auto_move_allowed=False,
                reason="confidence_below_threshold",
            )

        if self.rule_set.default_mode == "confirm" and not matching_rule.auto_move:
            return MovePlan(
                rule_name=matching_rule.name,
                destination=destination,
                auto_move_allowed=False,
                reason="confirmation_required_by_rule",
            )

        return MovePlan(
            rule_name=matching_rule.name,
            destination=destination,
            auto_move_allowed=matching_rule.auto_move,
            reason="rule_matched",
        )

    def execute_move(self, move_plan: MovePlan, source_path: Path) -> MoveResult:
        if not move_plan.destination:
            return MoveResult(
                attempted=False,
                success=False,
                from_path=str(source_path),
                to_path=None,
                error="missing_destination",
            )

        destination_dir = Path(move_plan.destination).expanduser()
        destination_dir.mkdir(parents=True, exist_ok=True)
        destination_path = destination_dir / source_path.name
        shutil.move(str(source_path), destination_path)
        return MoveResult(
            attempted=True,
            success=True,
            from_path=str(source_path),
            to_path=str(destination_path),
            error=None,
        )

    def _render_destination(
        self,
        destination_template: str,
        filename: str,
        classification: DocumentClassification,
    ) -> str:
        document_date = self._infer_document_date(classification)
        tokens = {
            "year": document_date.strftime("%Y"),
            "month": document_date.strftime("%m"),
            "filename": filename,
            "stem": Path(filename).stem,
            "document_type": classification.document_type,
        }
        rendered = destination_template.format(**tokens)
        return str(Path(rendered).expanduser())

    @staticmethod
    def _infer_document_date(classification: DocumentClassification) -> datetime:
        candidates = [classification.ocr_text or "", classification.summary, classification.title]
        for candidate in candidates:
            match = DATE_PATTERN.search(candidate)
            if match:
                return datetime(
                    int(match.group("year")),
                    int(match.group("month")),
                    int(match.group("day")),
                    tzinfo=UTC,
                )
        return datetime.now(UTC)
