# Architecture Status

## Current Product Direction

Agentic Docs Handler is currently being shaped into **AI Contextboard V1**.

The product direction is local-first and chat-first:

- users see a visible folder structure
- users browse files inside the active folder
- users ask the AI about the active folder from the main right-hand panel

The goal is not whole-library autonomous reasoning. V1 is designed for **medium context within the active folder**, where the app can stay fast, grounded, and understandable on a local Mac setup.

## Current Runtime Reality

The app runs as a local desktop stack:

```text
macOS desktop app
  ├── Tauri shell
  ├── React frontend
  ├── local FastAPI backend
  ├── Ollama for local model inference
  ├── SQLite for app data
  └── LanceDB for retrieval
```

Important current defaults:

- primary local model target: `qwen3.5:9b`
- backend is the app's own FastAPI service, not an external product backend
- external services should only remain for narrow cases such as Whisper/audio transcription

## Frontend Responsibilities

The frontend now centers on the AI Contextboard shell.

Current responsibilities:

- render a visible folder structure
- render files for the active folder
- keep the AI chat as the main interaction surface
- show contextboard signals beside the chat experience
- preserve direct user control over read, move, rename, and delete actions
- keep user-managed structure separate from AI-derived context

The intended user mental model is:

- left = folders
- middle = files in the active folder
- right = AI chat plus contextboard

## Backend Responsibilities

The backend is the orchestrator for active-folder intelligence.

Current important responsibilities:

- folder-scoped retrieval
- chat orchestration
- contextboard signals
- related-file calculation
- timeline data
- ingestion and document processing

The backend should support answers that feel grounded in the active folder rather than broad, slow, whole-library reasoning.

## Data And AI Layer

The current technical baseline remains:

- FastAPI for API and orchestration
- Ollama for local inference
- `qwen3.5:9b` as the primary local chat model target
- SQLite for document, folder, and application state
- LanceDB for retrieval and semantic lookup

V1 should treat AI context as a lightweight, useful layer above the user's structure. The system should emphasize:

- relevant retrieval within the active folder
- related files that explain why material belongs together
- timeline signals that help answer sequence and date-based questions

## Next Implementation Stage

The next product stage is to make the shell feel alive as soon as files arrive.

Priority work:

- make imported files populate the contextboard quickly
- improve ingest from Inbox into folders
- improve grounded folder-scoped chat answers
- add smoother folder management flows

The target outcome is that a user can import material, understand where it landed, and immediately ask useful questions without manually digging through the folder.

## Historical Docs

Historical plans and specs under `docs/` are still valuable reference material, but they are no longer the current source of product truth.

Use them for context, implementation history, and prior reasoning. Do not treat them as authoritative if they conflict with:

- `README.md` for product direction
- `ARCHITECTURE.md` for current technical direction
