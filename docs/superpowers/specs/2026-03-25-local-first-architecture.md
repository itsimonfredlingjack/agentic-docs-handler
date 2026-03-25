# Local-First Architecture

**Date:** 2026-03-25
**Status:** Approved
**Scope:** Config, MCP removal, deploy cleanup, documentation

## Problem

The project is architecturally split across a Mac (Tauri UI) and a remote ai-server (FastAPI + Ollama on RTX 4070), with files sent over the network for LLM processing. This complexity is not justified: the Mac can run Ollama locally with sufficient quality (Qwen 3.5 9B on Apple Silicon), and the only GPU-dependent workload that cannot run locally is Whisper (CUDA-only, on ai-server2).

## Solution

Make everything run locally on the Mac except Whisper, which stays on ai-server2.

### What Gets Removed

| Area | Files to Delete | Reason |
|------|----------------|--------|
| MCP server | `server/mcp/` (entire directory: `__init__.py`, `app.py`, `chatgpt_app_types.py`, `chatgpt_file_ingest.py`, `chatgpt_sessions.py`, `chatgpt_tools.py`, `chatgpt_widget_resource.py`, `read_tools.py`, `schemas.py`, `services.py`, `toolsets.py`, `write_tools.py`) | No external endpoint needed for local-only use |
| ChatGPT widget | `apps/chatgpt-widget/` (entire directory: `dist/widget.js`, `dist/widget.css`) | Depends on MCP |
| MCP tests | `server/tests/test_mcp_mount.py`, `server/tests/test_mcp_tools.py`, `server/tests/test_mcp_chatgpt_tools.py` | Tests for removed code |
| ai-server deploy | `scripts/deploy_ai_server.sh` | No remote ai-server to deploy to |

### What Gets Modified

**`server/main.py`:**
- Remove `from server.mcp.app import mount_mcp_server`
- Remove `from server.mcp.services import build_app_services` — replace with local service wiring (or inline the service construction)
- Remove `mcp_enabled` parameter from `create_app()`
- Remove `mount_mcp_server()` call
- Remove `config.chatgpt_upload_staging_dir.mkdir(...)` and related ChatGPT staging setup

**`server/config.py`:**
- Remove MCP config fields: `mcp_enabled`, `mcp_mount_path`, `mcp_allowed_roots`, `mcp_max_image_bytes`
- Remove ChatGPT config fields: `chatgpt_upload_staging_dir`, `chatgpt_upload_max_bytes`, `chatgpt_allowed_download_hosts`, `chatgpt_staging_ttl_hours`, `chatgpt_write_guard_enabled`, `chatgpt_widget_enabled`
- Change `ollama_base_url` default from `"http://localhost:11434/v1"` to `"http://localhost:11434/v1"` (already correct — verify)

**`server/schemas.py`:**
- Change `MoveExecutor` from `Literal["none", "client", "server"]` to `Literal["none", "client"]`

**`server/api/routes.py`:**
- Remove the `move_executor == "server"` branch in the process endpoint (staged file cleanup after server-side move)

**`server/pipelines/process_pipeline.py`:**
- Remove `move_executor="server"` handling if any exists in the pipeline

**`.env.example`:**
- Remove all `ADH_MCP_*` variables
- `ADH_OLLAMA_BASE_URL` stays as `http://localhost:11434/v1` (local Ollama)
- `ADH_WHISPER_BASE_URL` stays as `http://ai-server2:8090`

**`src/types/documents.ts`:**
- Remove `"server"` from `MoveExecutor` type (align with backend schema change)

**`src/lib/api.ts`:**
- Remove any `"server"` references in `move_executor` usage

**`CLAUDE.md`:**
- Rewrite architecture section: Mac runs everything, Whisper proxied to ai-server2
- Remove MCP/ChatGPT section entirely
- Remove deploy_ai_server references
- Update commands section (remove deploy_ai_server.sh)
- Update key files (remove MCP files)
- Update gotchas (remove ai-server references)
- Update env vars list

**`AGENTS.md`:**
- Same scope of changes as `CLAUDE.md` (keep aligned per repo convention)

**`README.md`:**
- Update to reflect local-first architecture (create if missing)

### What Does NOT Change

- `server/pipelines/` — all pipeline logic (classify, extract, organize, search, workspace_chat) stays identical
- `server/api/routes.py` — HTTP endpoints stay (minus MCP-specific cleanup)
- `server/api/ws.py` — WebSocket unchanged
- `server/pipelines/whisper_proxy.py` — Whisper proxy to ai-server2 stays
- `scripts/deploy_whisper_server.sh` — Whisper deploy stays
- Frontend (Tauri + React) — unchanged except `MoveExecutor` type cleanup in `src/types/documents.ts`
- `server/tests/test_api.py`, `server/tests/test_workspace_api.py`, `server/tests/test_workspace_chat.py` — stay (test the preserved functionality)

### Architecture After

```text
Mac (Tauri 2 + React 19)
  ├── FastAPI backend (localhost:9000)
  │     ├── Ollama (localhost:11434)
  │     ├── sentence-transformers + LanceDB
  │     ├── FileOrganizer (YAML rules)
  │     └── Whisper proxy → ai-server2:8090
  └── Tauri UI → localhost:9000
```

### `server/mcp/services.py` Migration

`build_app_services()` and `AppServices` in `server/mcp/services.py` are imported by `server/main.py` to construct the shared service container. Before deleting `server/mcp/`:

1. Create `server/services.py`
2. Move `AppServices` dataclass, `KnowledgeDocument`, `load_default_documents`, and `build_app_services` into it
3. Remove `allowed_roots()` and `resolve_path()` methods from `AppServices` (MCP-only)
4. Update `server/main.py` import: `from server.services import build_app_services`
5. `app.state.services` assignment stays as a diagnostic/extension point
6. Then delete `server/mcp/`

## Testing Strategy

- Run `PYTHONPATH=. pytest server/tests -q` after removal — expect reduced test count (MCP tests gone) but zero failures
- Run `npm run build` — frontend unchanged, should pass
- Run `cargo check --manifest-path src-tauri/Cargo.toml` — Rust unchanged, should pass
- Verify `create_app()` still works without MCP parameters
