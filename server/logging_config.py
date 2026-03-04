from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from server.schemas import LLMCallLogEntry


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


class LLMLogWriter:
    def __init__(self, log_dir: Path) -> None:
        self.log_dir = log_dir
        self.prompts_dir = log_dir / "prompts"
        self.responses_dir = log_dir / "responses"
        self.index_path = log_dir / "index.jsonl"
        self.prompts_dir.mkdir(parents=True, exist_ok=True)
        self.responses_dir.mkdir(parents=True, exist_ok=True)

    def write_call(
        self,
        *,
        request_id: str,
        prompt_name: str,
        model: str,
        input_modality: str,
        latency_ms: float,
        prompt_payload: dict[str, Any],
        response_payload: Any,
        json_parse_ok: bool,
        schema_validation_ok: bool,
    ) -> LLMCallLogEntry:
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        prompt_path = self.prompts_dir / f"{timestamp}-{request_id}-{prompt_name}.json"
        response_path = self.responses_dir / f"{timestamp}-{request_id}-{prompt_name}.json"

        prompt_path.write_text(
            json.dumps(prompt_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        response_path.write_text(
            json.dumps(response_payload, ensure_ascii=False, indent=2)
            if not isinstance(response_payload, str)
            else response_payload,
            encoding="utf-8",
        )

        entry = LLMCallLogEntry(
            request_id=request_id,
            prompt_name=prompt_name,
            model=model,
            input_modality=input_modality,
            latency_ms=latency_ms,
            raw_prompt_path=str(prompt_path),
            raw_response_path=str(response_path),
            json_parse_ok=json_parse_ok,
            schema_validation_ok=schema_validation_ok,
        )
        with self.index_path.open("a", encoding="utf-8") as handle:
            handle.write(entry.model_dump_json() + "\n")
        return entry
