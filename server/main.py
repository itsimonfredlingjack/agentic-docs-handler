from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from server.api.routes import create_router
from server.clients.ollama_client import AsyncOllamaClient
from server.config import AppConfig, get_config
from server.logging_config import LLMLogWriter, configure_logging
from server.mcp.app import mount_mcp_server
from server.mcp.services import build_app_services
from server.pipelines.classifier import DocumentClassifier
from server.pipelines.extractor import DocumentExtractor
from server.pipelines.file_organizer import FileOrganizer
from server.pipelines.process_pipeline import DocumentProcessPipeline
from server.pipelines.search import (
    IndexedDocument,
    LLMAnswerGenerator,
    LLMQueryPlanner,
    SearchPipeline,
    SentenceTransformerEmbedder,
)


class ReadinessProbe:
    def __init__(self, config: AppConfig, ollama_client: AsyncOllamaClient) -> None:
        self.config = config
        self.ollama_client = ollama_client
        self.prompt_paths = [
            config.prompts_dir / "classifier_system.txt",
            config.prompts_dir / "image_classifier_system.txt",
            config.prompts_dir / "extractors" / "receipt.txt",
            config.prompts_dir / "extractors" / "contract.txt",
            config.prompts_dir / "extractors" / "invoice.txt",
            config.prompts_dir / "extractors" / "meeting_notes.txt",
            config.prompts_dir / "extractors" / "generic.txt",
            config.prompts_dir / "search_rewrite_system.txt",
            config.prompts_dir / "search_answer_system.txt",
        ]

    def __call__(self) -> dict[str, object]:
        ollama_checks = self.ollama_client.readiness()
        prompts_ready = all(path.exists() for path in self.prompt_paths)
        ready = ollama_checks["ollama"] and ollama_checks["model"] and prompts_ready
        return {
            "ready": ready,
            "checks": {
                "ollama": ollama_checks["ollama"],
                "model": ollama_checks["model"],
                "prompts": prompts_ready,
            },
        }


def read_prompt(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def load_validation_report(path: Path) -> dict[str, object]:
    if not path.exists():
        return {"status": "missing"}
    return json.loads(path.read_text(encoding="utf-8"))


def create_app(
    *,
    config: AppConfig | None = None,
    pipeline: object | None = None,
    search_service: object | None = None,
    readiness_probe: Callable[[], dict[str, object]] | None = None,
    validation_report_loader: Callable[[], dict[str, object]] | None = None,
    mcp_enabled: bool | None = None,
) -> FastAPI:
    configure_logging()
    config = config or get_config()
    config.llm_log_dir.mkdir(parents=True, exist_ok=True)
    config.validation_log_dir.mkdir(parents=True, exist_ok=True)

    ollama_client: AsyncOllamaClient | None = None
    if pipeline is None or readiness_probe is None:
        log_writer = LLMLogWriter(config.llm_log_dir)
        ollama_client = AsyncOllamaClient(
            base_url=config.ollama_base_url,
            api_key=config.ollama_api_key,
            model=config.ollama_model,
            timeout_seconds=config.request_timeout_seconds,
            log_writer=log_writer,
        )
        classifier = DocumentClassifier(
            ollama_client=ollama_client,
            classifier_prompt=read_prompt(config.prompts_dir / "classifier_system.txt"),
            image_classifier_prompt=read_prompt(config.prompts_dir / "image_classifier_system.txt"),
            temperature=config.classifier_temperature,
        )
        extractor = DocumentExtractor(
            ollama_client=ollama_client,
            prompts={
                "receipt": read_prompt(config.prompts_dir / "extractors" / "receipt.txt"),
                "contract": read_prompt(config.prompts_dir / "extractors" / "contract.txt"),
                "invoice": read_prompt(config.prompts_dir / "extractors" / "invoice.txt"),
                "meeting_notes": read_prompt(config.prompts_dir / "extractors" / "meeting_notes.txt"),
                "generic": read_prompt(config.prompts_dir / "extractors" / "generic.txt"),
            },
            temperature=config.extract_temperature,
        )
        organizer = FileOrganizer(config.file_rules_path)
        pipeline = DocumentProcessPipeline(
            classifier=classifier,
            extractor=extractor,
            organizer=organizer,
            max_text_characters=config.max_text_characters,
        )
        readiness_probe = readiness_probe or ReadinessProbe(config, ollama_client)

    default_documents = build_app_services(
        config=config,
        pipeline=pipeline,
        search_service=search_service,
        readiness_probe=readiness_probe,
        validation_report_loader=validation_report_loader,
    ).documents

    if search_service is None and ollama_client is not None:
        search_service = SearchPipeline(
            db_path=config.lancedb_path,
            embedder=SentenceTransformerEmbedder(
                model_name=config.embedding_model_name,
                revision=config.embedding_model_revision,
                device=config.embedding_device,
                batch_size=config.embedding_batch_size,
                trust_remote_code=config.embedding_trust_remote_code,
            ),
            table_name=config.lancedb_table_name,
            query_planner=LLMQueryPlanner(
                ollama_client=ollama_client,
                system_prompt=read_prompt(config.prompts_dir / "search_rewrite_system.txt"),
            ),
            answer_generator=LLMAnswerGenerator(
                ollama_client=ollama_client,
                system_prompt=read_prompt(config.prompts_dir / "search_answer_system.txt"),
            ),
            chunk_size=config.search_chunk_size,
            chunk_overlap=config.search_chunk_overlap,
            default_limit=config.search_default_limit,
            candidate_limit=config.search_candidate_limit,
            bootstrap_documents=[
                IndexedDocument(
                    doc_id=document.doc_id,
                    title=document.title,
                    source_path=document.url,
                    text=document.text,
                    metadata=document.metadata,
                )
                for document in default_documents.values()
            ],
        )

    if search_service is not None and hasattr(pipeline, "search_pipeline"):
        setattr(pipeline, "search_pipeline", search_service)

    validation_report_loader = validation_report_loader or (
        lambda: load_validation_report(config.validation_report_path)
    )
    services = build_app_services(
        config=config,
        pipeline=pipeline,
        search_service=search_service,
        readiness_probe=readiness_probe,
        validation_report_loader=validation_report_loader,
    )

    app = FastAPI(title="Agentic Docs Handler Phase 2")
    app.include_router(
        create_router(
            pipeline=services.pipeline,
            search_service=services.search_service,
            readiness_probe=services.readiness_probe,
            validation_report_loader=services.validation_report_loader,
        )
    )
    app.state.services = services
    if mcp_enabled if mcp_enabled is not None else config.mcp_enabled:
        mount_mcp_server(app, services, config.mcp_mount_path)

    @app.get("/", include_in_schema=False)
    async def root() -> JSONResponse:
        return JSONResponse({"name": "agentic-docs-handler", "status": "ok", "phase": 2})

    return app


app = create_app()
