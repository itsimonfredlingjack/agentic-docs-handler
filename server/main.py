from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from server.api.routes import create_router
from server.api.ws import create_ws_router
from server.clients.ollama_client import AsyncOllamaClient
from server.config import AppConfig, REPO_ROOT, get_config
from server.document_registry import DocumentRegistry
from server.engagement_tracker import EngagementTracker
from server.logging_config import LLMLogWriter, configure_logging
from server.migrations.jsonl_to_sqlite import create_inbox_workspace, is_migrated, run_migration
from server.migrations.migrate import ensure_schema, get_schema_version
from server.pipelines.entity_extractor import EntityExtractor
from server.pipelines.discovery import WorkspaceDiscoveryPipeline
from server.pipelines.workspace_brief import WorkspaceBriefPipeline
from server.pipelines.workspace_suggester import WorkspaceSuggester
from server.pipelines.noop_organizer import NoOpOrganizer
from server.services import build_app_services, load_default_documents
from server.pipelines.classifier import DocumentClassifier
from server.pipelines.extractor import DocumentExtractor
from server.pipelines.process_pipeline import DocumentProcessPipeline
from server.pipelines.search import (
    IndexedDocument,
    SearchPipeline,
    SentenceTransformerEmbedder,
)
from server.pipelines.whisper_proxy import WhisperProxy
from server.realtime import ConnectionManager
from server.workspace_registry import WorkspaceRegistry

logger = logging.getLogger(__name__)


class ReadinessProbe:
    def __init__(
        self,
        config: AppConfig,
        ollama_client: AsyncOllamaClient,
        whisper_service: WhisperProxy | None = None,
    ) -> None:
        self.config = config
        self.ollama_client = ollama_client
        self.whisper_service = whisper_service
        self.prompt_paths = config.required_prompt_paths()

    def __call__(self) -> dict[str, object]:
        ollama_checks = self.ollama_client.readiness()
        prompts_ready = all(path.exists() for path in self.prompt_paths)
        whisper_ready = True
        if self.whisper_service is not None:
            whisper_ready = self.whisper_service.healthcheck()["ready"] is True
        ready = ollama_checks["ollama"] and ollama_checks["model"] and prompts_ready and whisper_ready
        return {
            "ready": ready,
            "checks": {
                "ollama": ollama_checks["ollama"],
                "model": ollama_checks["model"],
                "prompts": prompts_ready,
                "whisper": whisper_ready,
            },
        }


def read_prompt(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def _make_llm(config: AppConfig, log_writer: LLMLogWriter, pipeline: str) -> AsyncOllamaClient:
    """Create an AsyncOllamaClient configured for a specific pipeline."""
    return AsyncOllamaClient(
        base_url=config.ollama_base_url,
        api_key=config.ollama_api_key,
        model=config.resolve_model(pipeline),
        timeout_seconds=config.request_timeout_seconds,
        log_writer=log_writer,
        max_concurrency=config.ollama_max_concurrency,
        num_ctx=config.resolve_num_ctx(pipeline),
    )


def load_validation_report(path: Path) -> dict[str, object]:
    if not path.exists():
        return {"status": "missing"}
    return json.loads(path.read_text(encoding="utf-8"))


def _setup_database(config: AppConfig) -> DocumentRegistry:
    """Initialize SQLite database, run migrations, return DocumentRegistry."""
    config.sqlite_db_path.parent.mkdir(parents=True, exist_ok=True)

    document_registry = DocumentRegistry(db_path=config.sqlite_db_path)
    conn = document_registry.conn

    pre_version = get_schema_version(conn)

    # Apply all pending schema migrations (v1 = base DDL, v2+ = incremental)
    ensure_schema(conn)

    # If this is a fresh v0→v1 migration, create inbox and migrate JSONL data
    if pre_version == 0:
        if not is_migrated(conn):
            create_inbox_workspace(conn)

        if config.ui_documents_path.exists() or config.move_history_path.exists():
            logger.info("Migrating JSONL data to SQLite")
            run_migration(
                db_path=config.sqlite_db_path,
                documents_path=config.ui_documents_path,
                move_history_path=config.move_history_path,
                events_path=config.engagement_events_path,
            )
            document_registry.close()
            document_registry = DocumentRegistry(db_path=config.sqlite_db_path)

    return document_registry


def create_app(
    *,
    config: AppConfig | None = None,
    pipeline: object | None = None,
    search_service: object | None = None,
    whisper_service: object | None = None,
    document_registry: object | None = None,
    realtime_manager: object | None = None,
    readiness_probe: Callable[[], dict[str, object]] | None = None,
    validation_report_loader: Callable[[], dict[str, object]] | None = None,
    workspace_chat_service: object | None = None,
    workspace_registry: object | None = None,
    discovery_service: object | None = None,
) -> FastAPI:
    configure_logging()
    config = config or get_config()

    from server.locale import set_locale
    set_locale(config.locale)
    config.llm_log_dir.mkdir(parents=True, exist_ok=True)
    config.validation_log_dir.mkdir(parents=True, exist_ok=True)
    config.staging_dir.mkdir(parents=True, exist_ok=True)

    classifier_llm: AsyncOllamaClient | None = None
    realtime_manager = realtime_manager or ConnectionManager()

    # Database setup
    _owns_db = document_registry is None
    if document_registry is None:
        document_registry = _setup_database(config)

    engagement_tracker = EngagementTracker(conn=document_registry.conn)

    from server.conversation_registry import ConversationRegistry
    conversation_registry = ConversationRegistry(conn=document_registry.conn)

    from server.workspace_event_log import WorkspaceEventLog
    workspace_event_log = WorkspaceEventLog(conn=document_registry.conn)

    if workspace_registry is None:
        workspace_registry = WorkspaceRegistry(conn=document_registry.conn)

    if pipeline is None or readiness_probe is None:
        log_writer = LLMLogWriter(config.llm_log_dir)
        classifier_llm = _make_llm(config, log_writer, "classifier")
        extractor_llm = _make_llm(config, log_writer, "extractor")
        whisper_service = whisper_service or WhisperProxy(
            base_url=config.whisper_base_url,
            timeout_seconds=config.whisper_timeout_seconds,
        )
        classifier = DocumentClassifier(
            ollama_client=classifier_llm,
            classifier_prompt=read_prompt(config.resolve_prompt_path("classifier_system.txt")),
            image_classifier_prompt=read_prompt(config.resolve_prompt_path("image_classifier_system.txt")),
            temperature=config.classifier_temperature,
            max_image_dimension=config.classifier_max_image_dimension,
        )
        extractor = DocumentExtractor(
            ollama_client=extractor_llm,
            prompts={
                "receipt": read_prompt(config.resolve_prompt_path("extractors/receipt.txt")),
                "contract": read_prompt(config.resolve_prompt_path("extractors/contract.txt")),
                "invoice": read_prompt(config.resolve_prompt_path("extractors/invoice.txt")),
                "meeting_notes": read_prompt(config.resolve_prompt_path("extractors/meeting_notes.txt")),
                "report": read_prompt(config.resolve_prompt_path("extractors/report.txt")),
                "letter": read_prompt(config.resolve_prompt_path("extractors/letter.txt")),
                "tax_document": read_prompt(config.resolve_prompt_path("extractors/tax_document.txt")),
                "generic": read_prompt(config.resolve_prompt_path("extractors/generic.txt")),
            },
            temperature=config.extract_temperature,
        )
        entity_extractor_llm = _make_llm(config, log_writer, "entity_extractor")
        entity_extractor = EntityExtractor(
            ollama_client=entity_extractor_llm,
            system_prompt=read_prompt(config.resolve_prompt_path("entity_system.txt")),
            temperature=config.extract_temperature,
        )
        workspace_suggester_instance = WorkspaceSuggester(
            ollama_client=_make_llm(config, log_writer, "workspace_suggester"),
            system_prompt=read_prompt(config.resolve_prompt_path("workspace_suggest_system.txt")),
            temperature=config.extract_temperature,
        )
        organizer = NoOpOrganizer()
        pipeline = DocumentProcessPipeline(
            classifier=classifier,
            extractor=extractor,
            organizer=organizer,
            whisper_service=whisper_service,
            document_registry=document_registry,
            realtime_manager=realtime_manager,
            entity_extractor=entity_extractor,
            workspace_suggester=workspace_suggester_instance,
            workspace_registry=workspace_registry,
            workspace_event_log=workspace_event_log,
            max_text_characters=config.max_text_characters,
            classifier_max_text_characters=config.classifier_max_text_characters,
        )
        readiness_probe = readiness_probe or ReadinessProbe(config, classifier_llm, whisper_service)
    else:
        if hasattr(pipeline, "document_registry"):
            setattr(pipeline, "document_registry", document_registry)
        if hasattr(pipeline, "realtime_manager"):
            setattr(pipeline, "realtime_manager", realtime_manager)
        if hasattr(pipeline, "whisper_service") and whisper_service is not None:
            setattr(pipeline, "whisper_service", whisper_service)

    default_documents = load_default_documents(REPO_ROOT)

    if search_service is None:
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

    if discovery_service is None and search_service is not None:
        discovery_service = WorkspaceDiscoveryPipeline(
            document_registry=document_registry,
            search_pipeline=search_service,
        )

    workspace_brief_service: WorkspaceBriefPipeline | None = None
    if workspace_chat_service is None and search_service is not None and classifier_llm is not None:
        log_writer = classifier_llm.log_writer
        workspace_llm = _make_llm(config, log_writer, "workspace_chat")
        from server.pipelines.workspace_chat import WorkspaceChatPipeline, DEFAULT_NUM_CTX
        workspace_chat_service = WorkspaceChatPipeline(
            ollama_client=workspace_llm,
            search_pipeline=search_service,
            document_registry=document_registry,
            system_prompt=read_prompt(config.resolve_prompt_path("workspace_system.txt")),
            num_ctx=config.resolve_num_ctx("workspace_chat") or DEFAULT_NUM_CTX,
            conversation_registry=conversation_registry,
        )
        workspace_brief_service = WorkspaceBriefPipeline(
            ollama_client=workspace_llm,
            system_prompt=read_prompt(config.resolve_prompt_path("workspace_brief_system.txt")),
            document_registry=document_registry,
            workspace_registry=workspace_registry,
        )

    validation_report_loader = validation_report_loader or (
        lambda: load_validation_report(config.validation_report_path)
    )
    services = build_app_services(
        config=config,
        pipeline=pipeline,
        search_service=search_service,
        whisper_service=whisper_service,
        document_registry=document_registry,
        realtime_manager=realtime_manager,
        readiness_probe=readiness_probe,
        validation_report_loader=validation_report_loader,
    )

    async def _retry_pending_documents() -> None:
        """Startup sweep: retry pending_classification documents if Ollama is healthy."""
        try:
            if not callable(readiness_probe):
                return
            health = readiness_probe()
            if not health.get("ready"):
                logger.info("startup_retry: Ollama not ready — skipping pending document sweep")
                return

            pending = document_registry.list_pending_retryable()
            if not pending:
                logger.info("startup_retry: no pending documents to retry")
                return

            logger.info("startup_retry: found %d pending documents — beginning retry sweep", len(pending))
            retried = 0
            skipped = 0
            still_pending = 0
            for record in pending:
                source_path = record.source_path
                if not source_path or not os.path.exists(source_path):
                    logger.warning(
                        "startup_retry: skipping %s — source file not available at %s",
                        record.id, source_path,
                    )
                    skipped += 1
                    continue

                try:
                    content = Path(source_path).read_bytes()
                    filename = Path(source_path).name
                    parts = filename.split("-", 1)
                    if len(parts) == 2 and len(parts[0]) >= 32:
                        filename = parts[1]

                    result = await pipeline.reprocess_pending(
                        record_id=record.id,
                        content=content,
                        filename=filename,
                        content_type=record.mime_type,
                        source_path=source_path,
                        client_id=None,
                    )
                    if result.status == "pending_classification":
                        still_pending += 1
                        logger.warning("startup_retry: %s still pending after retry", record.id)
                    else:
                        retried += 1
                        logger.info("startup_retry: %s recovered → %s", record.id, result.status)
                except Exception:
                    still_pending += 1
                    logger.warning("startup_retry: %s retry failed", record.id, exc_info=True)

            logger.info(
                "startup_retry: sweep complete — retried=%d skipped=%d still_pending=%d",
                retried, skipped, still_pending,
            )
        except Exception:
            logger.error("startup_retry: sweep failed", exc_info=True)

    async def _health_recovery_monitor() -> None:
        """Background monitor: detect Ollama unhealthy→healthy and trigger one retry sweep."""
        poll_interval = 30  # seconds
        last_healthy = True  # assume healthy at startup (startup sweep handles the unhealthy case)
        try:
            # Wait before first poll to let the startup sweep finish
            await asyncio.sleep(poll_interval)
            while True:
                try:
                    if callable(readiness_probe):
                        health = readiness_probe()
                        is_healthy = bool(health.get("ready"))
                    else:
                        is_healthy = False

                    if is_healthy and not last_healthy:
                        logger.info("health_recovery: Ollama recovered — triggering pending document sweep")
                        await _retry_pending_documents()

                    last_healthy = is_healthy
                except Exception:
                    logger.debug("health_recovery: probe failed", exc_info=True)
                    last_healthy = False

                await asyncio.sleep(poll_interval)
        except asyncio.CancelledError:
            return

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Startup: launch pending-document retry sweep + health recovery monitor
        retry_task = asyncio.create_task(_retry_pending_documents())
        monitor_task = asyncio.create_task(_health_recovery_monitor())
        yield
        # Shutdown
        monitor_task.cancel()
        retry_task.cancel()
        if _owns_db and hasattr(document_registry, "close"):
            document_registry.close()

    app = FastAPI(title="Brainfileing", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_allowed_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(
        create_router(
            pipeline=services.pipeline,
            model_name=config.ollama_model,
            search_service=services.search_service,
            whisper_service=services.whisper_service,
            document_registry=services.document_registry,
            realtime_manager=services.realtime_manager,
            readiness_probe=services.readiness_probe,
            validation_report_loader=services.validation_report_loader,
            staging_dir=config.staging_dir,
            workspace_chat_service=workspace_chat_service,
            engagement_tracker=engagement_tracker,
            workspace_registry=workspace_registry,
            workspace_brief_service=workspace_brief_service,
            discovery_service=discovery_service,
            conversation_registry=conversation_registry,
            workspace_event_log=workspace_event_log,
        )
    )
    app.include_router(create_ws_router(realtime_manager=services.realtime_manager))
    app.state.services = services

    @app.get("/", include_in_schema=False)
    async def root() -> JSONResponse:
        return JSONResponse({"name": "brainfileing", "status": "ok", "phase": 5})

    return app


app = create_app()
