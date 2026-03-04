from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from server.config import AppConfig, REPO_ROOT


@dataclass(frozen=True)
class KnowledgeDocument:
    doc_id: str
    title: str
    url: str
    text: str
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass
class AppServices:
    config: AppConfig
    pipeline: object
    readiness_probe: Any
    validation_report_loader: Any
    documents: dict[str, KnowledgeDocument]
    repo_root: Path = field(default_factory=lambda: REPO_ROOT)
    classifier: object | None = None
    extractor: object | None = None
    organizer: object | None = None
    search_service: object | None = None
    whisper_service: object | None = None
    activity_log_loader: Any | None = None
    root_status: dict[str, object] = field(
        default_factory=lambda: {"name": "agentic-docs-handler", "status": "ok", "phase": 3}
    )

    def prompt_paths(self) -> list[Path]:
        return [
            self.config.prompts_dir / "classifier_system.txt",
            self.config.prompts_dir / "image_classifier_system.txt",
            self.config.prompts_dir / "extractors" / "receipt.txt",
            self.config.prompts_dir / "extractors" / "contract.txt",
            self.config.prompts_dir / "extractors" / "invoice.txt",
            self.config.prompts_dir / "extractors" / "meeting_notes.txt",
            self.config.prompts_dir / "extractors" / "generic.txt",
        ]

    def allowed_roots(self) -> list[Path]:
        return [root.expanduser().resolve() for root in self.config.mcp_allowed_roots]

    def resolve_path(self, raw_path: str) -> Path:
        candidate = Path(raw_path).expanduser()
        if not candidate.is_absolute():
            candidate = (self.repo_root / candidate).resolve()
        else:
            candidate = candidate.resolve()
        allowed = self.allowed_roots()
        if not any(candidate == root or root in candidate.parents for root in allowed):
            raise ValueError("path_outside_allowed_roots")
        return candidate

    def load_activity_events(self, limit: int) -> list[dict[str, object]]:
        if self.activity_log_loader is not None:
            return list(self.activity_log_loader(limit))
        events: list[dict[str, object]] = []
        for path in sorted(self.config.validation_log_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            events.append(
                {
                    "timestamp": path.stat().st_mtime,
                    "type": "validation_report",
                    "status": payload.get("status", "unknown"),
                    "request_id": payload.get("request_id"),
                    "source": path.name,
                }
            )
            if len(events) >= limit:
                break
        return events

    def load_file_rules(self) -> dict[str, object]:
        if self.organizer is not None and hasattr(self.organizer, "rule_set"):
            rule_set = getattr(self.organizer, "rule_set")
            if hasattr(rule_set, "model_dump"):
                return rule_set.model_dump(mode="json")
            if isinstance(rule_set, dict):
                return rule_set
        return yaml.safe_load(self.config.file_rules_path.read_text(encoding="utf-8")) or {}


def load_default_documents(repo_root: Path) -> dict[str, KnowledgeDocument]:
    candidates = (
        ("design-spec", "Design Spec", repo_root / "agentic-docs-design-spec.md"),
        ("blueprint-v4", "Blueprint v4", repo_root / "agentic-docs-handler-blueprint-v4.md"),
        (
            "phase1-validation-report",
            "Phase 1 Validation Report",
            repo_root / "docs" / "validation" / "phase1-validation-report.md",
        ),
    )
    documents: dict[str, KnowledgeDocument] = {}
    for doc_id, title, path in candidates:
        if not path.exists():
            continue
        relative_url = path.relative_to(repo_root).as_posix()
        documents[doc_id] = KnowledgeDocument(
            doc_id=doc_id,
            title=title,
            url=relative_url,
            text=path.read_text(encoding="utf-8"),
            metadata={"source_path": relative_url},
        )
    return documents


def build_app_services(
    *,
    config: AppConfig,
    pipeline: object,
    readiness_probe: Any,
    validation_report_loader: Any,
    search_service: object | None = None,
    whisper_service: object | None = None,
) -> AppServices:
    classifier = getattr(pipeline, "classifier", None)
    extractor = getattr(pipeline, "extractor", None)
    organizer = getattr(pipeline, "organizer", None)
    return AppServices(
        config=config,
        pipeline=pipeline,
        search_service=search_service,
        whisper_service=whisper_service,
        classifier=classifier,
        extractor=extractor,
        organizer=organizer,
        readiness_probe=readiness_probe,
        validation_report_loader=validation_report_loader,
        documents=load_default_documents(REPO_ROOT),
    )
