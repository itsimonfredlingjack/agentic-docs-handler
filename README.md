# Agentic Docs Handler

Fas 3 av `Agentic Docs Handler` enligt `agentic-docs-handler-blueprint-v4.md`, med ChatGPT MCP live, search-pipeline i samma FastAPI-runtime och en separat Whisper-nod på `ai-server2`.

Aktiv runtime i den här fasen är en Python-baserad `FastAPI`-orchestrator på port `9000` som:

- klassificerar text och bilder via `Ministral 3 14B` genom `Ollama`
- extraherar typ-specifika fält till validerad JSON
- planerar regelbaserad filsortering via `server/file_rules.yaml`
- indexerar dokument i `LanceDB` med embeddings från `sentence-transformers`
- exponerar hybrid search med query rewrite + smart answer via `Ministral`
- loggar alla LLM-anrop till fil med prompt, response, latency och valideringsstatus
- exponerar health, readiness, process och benchmark-rapport över HTTP
- mountar en `tool-only` MCP-server på `/mcp` för ChatGPT Developer Mode

## Fas 2 Scope

Ingår:

- `FastAPI`-server under `server/`
- MCP-tools mountade i samma Python-runtime under `/mcp`
- `LanceDB`-baserad search-pipeline under `server/pipelines/search.py`
- `GET /search` för smart document search
- `POST /transcribe` som proxar till dedikerad Whisper-node på `ai-server2:8090`
- `search_documents` MCP-tool som wrappar search-pipelinen
- `transcribe_audio` MCP-tool som wrappar Whisper-proxyn
- promptfiler versionerade i repo
- benchmark-runner och valideringsrapport
- deploy-skript för `ai-server`
- separat deploy-skript för `whisper-server/` på `ai-server2`

Ingår inte:

- `Tauri`-app
- React-shell
- `Whisper`
- UI-templates och desktop-actions

## Repo-layout

```text
.
├── .env.example
├── README.md
├── agentic-docs-design-spec.md
├── agentic-docs-handler-blueprint-v4.md
├── docs/
│   ├── plans/
│   └── validation/
├── legacy/
│   └── mcp-docs-scaffold/
├── scripts/
│   ├── collect_phase1_report.py
│   ├── deploy_ai_server.sh
│   └── run_phase1_benchmarks.py
├── server/
│   ├── api/
│   ├── clients/
│   ├── mcp/
│   ├── pipelines/
│   ├── prompts/
│   ├── tests/
│   ├── config.py
│   ├── file_rules.yaml
│   ├── logging_config.py
│   ├── main.py
│   ├── requirements.txt
│   └── schemas.py
└── whisper-server/
    └── README.md
```

## Lokal utveckling

Installera beroenden:

```bash
python3.14 -m venv .venv
. .venv/bin/activate
pip install -r server/requirements.txt
```

Kör tester:

```bash
.venv/bin/python -m pytest server/tests -q
```

Starta servern:

```bash
.venv/bin/python -m uvicorn server.main:app --host 0.0.0.0 --port 9000
```

Kontrollera endpoints:

```bash
curl http://127.0.0.1:9000/healthz
curl http://127.0.0.1:9000/readyz
curl 'http://127.0.0.1:9000/search?query=invoice'
curl -F file=@/path/to/audio.wav http://127.0.0.1:9000/transcribe
curl http://127.0.0.1:9000/mcp
```

## MCP tool surface

Nuvarande ChatGPT/MCP-tools:

- `search`
- `search_documents`
- `transcribe_audio`
- `fetch`
- `get_system_status`
- `get_validation_report`
- `classify_text`
- `classify_image`
- `extract_fields`
- `preview_document_processing`
- `list_file_rules`
- `get_activity_log`
- `organize_file`

Read-only standard för knowledge-flöden:

- `search` söker i `agentic-docs-design-spec.md`, `agentic-docs-handler-blueprint-v4.md` och `docs/validation/phase1-validation-report.md`
- `fetch` hämtar fulltext för ett dokument-id från `search`
- `search_documents` kör den riktiga hybrid search-pipelinen mot indexerade dokument i LanceDB
- `transcribe_audio` skickar lokal ljudfil till FastAPI-proxyn som i sin tur routar till `ai-server2:8090`

ChatGPT-anslutning:

- lokal MCP URL: `http://127.0.0.1:9000/mcp`
- publik MCP URL efter tunnel/reverse proxy: `https://<din-domän>/mcp`

## Search Pipeline

Search-pipelinen finns i [server/pipelines/search.py](/Users/coffeedev/Projects/02_AUTOMATION-PIPELINES/agentic-docs-handler/server/pipelines/search.py) och gör följande:

- chunkar dokumenttext
- genererar embeddings med `nomic-ai/nomic-embed-text-v1.5`
- lagrar chunkar i `LanceDB`
- kombinerar vector-ranking och keyword-score i en hybrid rankning
- rewritar query och skriver svar via `Ministral`

Konfigurerbara värden finns i `.env.example` med prefix `ADH_LANCEDB_*`, `ADH_EMBEDDING_*` och `ADH_SEARCH_*`.

## Benchmark och rapport

Kör benchmark mot en redan startad server:

```bash
python3 scripts/run_phase1_benchmarks.py --base-url http://127.0.0.1:9000
python3 scripts/collect_phase1_report.py
```

Rapporter skrivs till:

- `server/logs/validation/latest.json`
- `docs/validation/phase1-validation-report.md`

LLM-loggar skrivs till:

- `server/logs/llm/index.jsonl`
- `server/logs/llm/prompts/`
- `server/logs/llm/responses/`

## Deploy till ai-server

`ai-server` är den enda runtime-värden i Fas 2.

Deploy:

```bash
bash scripts/deploy_ai_server.sh
bash scripts/deploy_whisper_server.sh
```

Skriptet:

- synkar repot till `/home/ai-server/01_PROJECTS/agentic-docs-handler`
- skapar `.venv`
- förinstallerar CPU-byggd `torch` eftersom embedding körs på CPU i Fas 2
- installerar `server/requirements.txt`
- säkerställer `.env`
- startar `uvicorn server.main:app` på port `9000` i `tmux`-sessionen `adh-phase3`

Whisper-deploy:

- synkar samma repo till `ai-server2`
- skapar `.venv-whisper`
- installerar `whisper-server/requirements.txt`
- startar `python whisper-server/whisper_server.py` på port `8090` i `tmux`-sessionen `adh-whisper`

## Status

Nuvarande repo-status efter re-baseline:

- aktiv runtime: Python/FastAPI
- gammalt MCP/TypeScript-skelett: flyttat till `legacy/mcp-docs-scaffold/`
- ChatGPT MCP live på `/mcp`
- search-pipeline live i samma backend
- dedikerad Whisper-node live på `ai-server2`

## Nästa fas

När Fas 2 är verifierad är nästa planerade steg:

1. mata in verkliga ljudfiler och dokument i större valideringssviter
2. bygga `Tauri`-skalet ovanpå den nuvarande backend- och MCP-ytan
3. lägga till widget-UI som senare fas ovanpå MCP
