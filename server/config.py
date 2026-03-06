from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent
LLM_MODEL = "qwen3.5:9b"


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ADH_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = "development"
    host: str = "0.0.0.0"
    port: int = 9000
    ollama_base_url: str = "http://localhost:11434/v1"
    ollama_api_key: str = "ollama"
    ollama_model: str = LLM_MODEL
    request_timeout_seconds: float = 300.0
    ollama_max_concurrency: int = 1
    classifier_temperature: float = 0.1
    extract_temperature: float = 0.1
    max_text_characters: int = 12000
    classifier_max_text_characters: int = 4000
    classifier_max_image_dimension: int = 1280
    prompts_dir: Path = Path("server/prompts")
    file_rules_path: Path = Path("server/file_rules.yaml")
    llm_log_dir: Path = Path("server/logs/llm")
    validation_log_dir: Path = Path("server/logs/validation")
    validation_report_path: Path = Path("server/logs/validation/latest.json")
    lancedb_path: Path = Path("server/data/lancedb")
    lancedb_table_name: str = "document_chunks"
    ui_documents_path: Path = Path("server/data/ui_documents.jsonl")
    move_history_path: Path = Path("server/data/move_history.jsonl")
    embedding_model_name: str = "nomic-ai/nomic-embed-text-v1.5"
    embedding_model_revision: str = "e5cf08aadaa33385f5990def41f7a23405aec398"
    embedding_device: str = "cpu"
    embedding_batch_size: int = 16
    embedding_trust_remote_code: bool = True
    search_chunk_size: int = 900
    search_chunk_overlap: int = 120
    search_default_limit: int = 5
    search_candidate_limit: int = 20
    cors_allowed_origins: list[str] = Field(default_factory=lambda: ["*"])
    mcp_enabled: bool = True
    mcp_mount_path: str = "/mcp"
    mcp_allowed_roots: list[Path] = Field(default_factory=lambda: [REPO_ROOT])
    mcp_max_image_bytes: int = 4 * 1024 * 1024
    chatgpt_upload_staging_dir: Path = Path("server/data/chatgpt_uploads")
    chatgpt_upload_max_bytes: int = 25 * 1024 * 1024
    chatgpt_allowed_download_hosts: list[str] = Field(
        default_factory=lambda: [
            "files.oaiusercontent.com",
            "persistent.oaistatic.com",
            "docsgpt.fredlingautomation.dev",
            "localhost",
            "127.0.0.1",
        ]
    )
    chatgpt_staging_ttl_hours: int = 24
    chatgpt_write_guard_enabled: bool = True
    chatgpt_widget_enabled: bool = True
    staging_dir: Path = Path("/tmp/agentic-docs/server-staging")
    whisper_base_url: str = "http://ai-server2:8090"
    whisper_timeout_seconds: float = 300.0


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    return AppConfig()
