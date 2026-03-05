# Agentic Docs Handler

Fas 4 av `Agentic Docs Handler` enligt [agentic-docs-handler-blueprint-v4.md](/Users/coffeedev/Projects/02_AUTOMATION-PIPELINES/agentic-docs-handler/agentic-docs-handler-blueprint-v4.md): samma FastAPI-orchestrator driver nu både MCP-ytan för ChatGPT och en lokal Tauri-desktopapp för Mac.

Aktiv runtime i den här fasen:

- `FastAPI` på port `9000` för process, search, activity, undo och WebSocket-events
- `Qwen 3.5 9B` via `Ollama` för klassificering, extraktion och search-query-rewrite
- `sentence-transformers` + `LanceDB` för hybrid search
- separat `Whisper`-nod på `ai-server2:8090`
- `Tauri 2 + React 19 + Tailwind + Zustand` för desktop-shellen
- `MCP` mountad under `/mcp` för ChatGPT Developer Mode

## Fas 4 Scope

Ingår:

- `FastAPI`-backend under `server/`
- `Tauri`-shell under `src-tauri/`
- `React`-renderer under `src/`
- dokumentregistry för UI-read-model
- `GET /documents`, `GET /documents/counts`, `GET /activity`
- `POST /moves/undo`
- `GET /ws` för realtidsstatus per `client_id`
- audio ingest via `POST /process`
- `search_documents` och övriga MCP-tools på samma pipeline-lager

Ingår inte:

- dark mode
- system tray / The Orb
- widget UI
- AI-actionknappar
- waveform player

## Arkitektur

```text
Mac App (Tauri)
├── Rust WS bridge
│   └── ws://ai-server:9000/ws?client_id=<uuid>
├── React renderer
│   ├── GET /documents
│   ├── GET /documents/counts
│   ├── GET /activity
│   ├── GET /search
│   ├── POST /process
│   └── POST /moves/undo
└── FastAPI
    ├── pipelines/
    ├── document_registry.py
    ├── realtime.py
    ├── /mcp
    └── whisper proxy -> ai-server2:8090

ChatGPT
└── MCP -> https://docsgpt.fredlingautomation.dev/mcp
```

Arkitekturregeln gäller fortfarande:

```text
mcp_tools/     -> importerar från pipelines/
main.py / WS   -> importerar från pipelines/
pipelines/     -> importerar aldrig från mcp_tools/ eller UI-lager
```

## Repo-layout

```text
.
├── .env.example
├── README.md
├── agentic-docs-design-spec.md
├── agentic-docs-handler-blueprint-v4.md
├── docs/
├── scripts/
├── server/
│   ├── api/
│   ├── clients/
│   ├── mcp/
│   ├── pipelines/
│   ├── prompts/
│   ├── tests/
│   ├── config.py
│   ├── document_registry.py
│   ├── realtime.py
│   ├── requirements.txt
│   └── schemas.py
├── src/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   ├── store/
│   ├── templates/
│   └── types/
├── src-tauri/
│   ├── src/
│   ├── capabilities/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── whisper-server/
└── legacy/
```

## Backend Setup

Installera backend-bibliotek:

```bash
python3.14 -m venv .venv
. .venv/bin/activate
pip install -r server/requirements.txt
```

Starta FastAPI lokalt:

```bash
.venv/bin/python -m uvicorn server.main:app --host 0.0.0.0 --port 9000
```

Verifiera backend:

```bash
curl http://127.0.0.1:9000/
curl http://127.0.0.1:9000/healthz
curl http://127.0.0.1:9000/readyz
curl 'http://127.0.0.1:9000/search?query=kvitton%20mars'
curl http://127.0.0.1:9000/documents
curl http://127.0.0.1:9000/documents/counts
curl http://127.0.0.1:9000/activity
```

## Frontend Setup

Installera frontend-bibliotek:

```bash
npm install
```

Kör React-ytan separat:

```bash
npm run dev
```

Bygg frontend:

```bash
npm run build
```

Kör Tauri-shell:

```bash
npm run tauri dev
```

Byggkontroll för Rust/Tauri:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Tauri-kommandon som exponeras till React:

- `get_client_id`
- `get_backend_base_url`
- `reconnect_backend_ws`

## HTTP API för UI

Fas 4 använder följande publika ytor:

- `GET /healthz`
- `GET /readyz`
- `GET /validation/report`
- `GET /documents`
- `GET /documents/counts`
- `GET /activity`
- `GET /search`
- `POST /process`
- `POST /transcribe`
- `POST /moves/undo`
- `GET /ws` som WebSocket

`POST /process` är den enda ingest-ytan för appen. Backend avgör själv om filen ska gå genom text-, bild- eller audioflöde.

## WebSocket Events

Per klient skickar backend bland annat:

- `connection.ready`
- `job.started`
- `job.progress`
- `job.completed`
- `job.failed`
- `file.moved`
- `file.move_undone`
- `heartbeat`

Event routing är per `client_id`. Ingen broadcast används för UI-jobb.

## MCP Surface

MCP-servern är mountad i samma FastAPI-process under `/mcp`.

Nuvarande MCP-tools:

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

Publik MCP-URL i nuvarande setup:

- [https://docsgpt.fredlingautomation.dev/mcp](https://docsgpt.fredlingautomation.dev/mcp)

## Test och verifiering

Backend-tester:

```bash
python3 -m pytest server/tests -q
```

Frontend-tester:

```bash
npm test
```

Fas 4-verifiering som bör köras inför leverans:

```bash
python3 -m pytest server/tests -q
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Deploy

Backend + search + MCP + proxy deployas till `ai-server`:

```bash
bash scripts/deploy_ai_server.sh
```

Whisper-noden deployas till `ai-server2`:

```bash
bash scripts/deploy_whisper_server.sh
```

`deploy_ai_server.sh` gör även ett warmup-anrop efter serverstart:

```bash
curl -s localhost:9000/search?query=warmup > /dev/null
```

## Viktiga env-vars

Se [.env.example](/Users/coffeedev/Projects/02_AUTOMATION-PIPELINES/agentic-docs-handler/.env.example). Fas 4 adderar särskilt:

- `ADH_UI_DOCUMENTS_PATH`
- `ADH_MOVE_HISTORY_PATH`
- `ADH_CORS_ALLOWED_ORIGINS`
- `ADH_WHISPER_*`

## Status

Nuvarande status i repo:

- FastAPI orchestrator live
- LanceDB search live
- Whisper-proxy live
- MCP live på `/mcp`
- Tauri desktop-shell scaffoldad och kopplad till backend via hybridmodell:
  - WS för events
  - HTTP för data

## Nästa steg

Efter Fas 4 är de naturliga nästa spåren:

1. manuell live-validering av hela Tauri-flödet på Mac mot `ai-server`
2. polish av animationer, spacing och responsive detaljer
3. Fas 5+: system tray, widget UI och AI-actions
