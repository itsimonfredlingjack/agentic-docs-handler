# Local-First Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the ai-server dependency so everything runs locally on the Mac, keeping only Whisper on ai-server2.

**Architecture:** Move `AppServices` out of `server/mcp/`, delete MCP/ChatGPT code, clean up config, update docs. Pipeline logic is untouched.

**Tech Stack:** Python 3.14, FastAPI, Tauri 2, TypeScript, pytest

**Spec:** `docs/superpowers/specs/2026-03-25-local-first-architecture.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/services.py` | Create | Relocated `AppServices`, `KnowledgeDocument`, `load_default_documents`, `build_app_services` |
| `server/main.py` | Modify | Update imports, remove MCP mount, remove ChatGPT staging |
| `server/config.py` | Modify | Remove MCP + ChatGPT config fields |
| `server/schemas.py` | Modify | Remove `"server"` from `MoveExecutor` |
| `server/api/routes.py` | Modify | Remove `move_executor == "server"` branch |
| `server/pipelines/process_pipeline.py` | Modify | Remove `move_executor == "server"` branch |
| `server/document_registry.py` | Modify | Remove `executor == "server"` finalized logic |
| `src/types/documents.ts` | Modify | Remove `"server"` from `MoveExecutor` type |
| `src/lib/api.ts` | Modify | Remove `"server"` from `moveExecutor` inline type |
| `.env.example` | Modify | Remove MCP variables |
| `CLAUDE.md` | Modify | Rewrite architecture, remove MCP/ChatGPT/ai-server sections |
| `AGENTS.md` | Modify | Same scope as CLAUDE.md |
| `server/mcp/` | Delete | Entire directory |
| `apps/chatgpt-widget/` | Delete | Entire directory |
| `scripts/deploy_ai_server.sh` | Delete | No remote ai-server |
| `server/tests/test_mcp_mount.py` | Delete | Tests for removed code |
| `server/tests/test_mcp_tools.py` | Delete | Tests for removed code |
| `server/tests/test_mcp_chatgpt_tools.py` | Delete | Tests for removed code |

---

## Task 1: Relocate `AppServices` to `server/services.py`

**Files:**
- Create: `server/services.py`
- Modify: `server/main.py:18-19` (imports)

This must happen first — everything else depends on `server/mcp/` being deletable.

- [ ] **Step 1: Create `server/services.py`**

Copy the contents of `server/mcp/services.py` into a new file `server/services.py`. Then remove the MCP-only methods `allowed_roots()` and `resolve_path()` from `AppServices`. The resulting file should contain:

- `KnowledgeDocument` dataclass
- `AppServices` dataclass (without `allowed_roots` and `resolve_path`)
- `load_default_documents()` function
- `build_app_services()` function

Keep all imports (`json`, `dataclasses`, `Path`, `yaml`, `AppConfig`, `REPO_ROOT`).

- [ ] **Step 2: Update imports in `server/main.py`**

Change lines 18-19 from:

```python
from server.mcp.app import mount_mcp_server
from server.mcp.services import build_app_services
```

To:

```python
from server.services import build_app_services
```

(Remove the `mount_mcp_server` import entirely.)

- [ ] **Step 3: Verify tests pass**

Run: `PYTHONPATH=. pytest server/tests/test_api.py server/tests/test_workspace_api.py server/tests/test_workspace_chat.py -q`
Expected: All pass — these tests use `create_app()` which imports `build_app_services`.

- [ ] **Step 4: Commit**

```bash
git add server/services.py server/main.py
git commit -m "refactor: relocate AppServices from server/mcp/services to server/services"
```

---

## Task 2: Remove MCP mount and ChatGPT staging from `main.py`

**Files:**
- Modify: `server/main.py`

- [ ] **Step 1: Remove MCP-related code from `create_app()`**

In `server/main.py`, remove:

1. The `mcp_enabled` parameter from the `create_app()` signature (line 104)
2. The `config.chatgpt_upload_staging_dir.mkdir(parents=True, exist_ok=True)` line (line 114)
3. The MCP mount block (lines 261-263):
   ```python
   if mcp_enabled if mcp_enabled is not None else config.mcp_enabled:
       mount_mcp_server(app, services, config.mcp_mount_path)
   ```

- [ ] **Step 2: Verify tests pass**

Run: `PYTHONPATH=. pytest server/tests/test_api.py -q`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add server/main.py
git commit -m "refactor: remove MCP mount and ChatGPT staging from app factory"
```

---

## Task 3: Remove MCP and ChatGPT config fields

**Files:**
- Modify: `server/config.py`

- [ ] **Step 1: Remove config fields**

In `server/config.py`, remove these fields from `AppConfig`:

```python
# MCP fields to remove:
mcp_enabled: bool = True
mcp_mount_path: str = "/mcp"
mcp_allowed_roots: list[Path] = Field(default_factory=lambda: [REPO_ROOT])
mcp_max_image_bytes: int = 4 * 1024 * 1024

# ChatGPT fields to remove:
chatgpt_upload_staging_dir: Path = Path("server/data/chatgpt_uploads")
chatgpt_upload_max_bytes: int = 25 * 1024 * 1024
chatgpt_allowed_download_hosts: list[str] = Field(...)
chatgpt_staging_ttl_hours: int = 24
chatgpt_write_guard_enabled: bool = True
chatgpt_widget_enabled: bool = True
```

- [ ] **Step 2: Verify tests pass**

Run: `PYTHONPATH=. pytest server/tests/test_api.py server/tests/test_workspace_api.py -q`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add server/config.py
git commit -m "refactor: remove MCP and ChatGPT config fields"
```

---

## Task 4: Remove `move_executor="server"` handling

**Files:**
- Modify: `server/schemas.py:17`
- Modify: `server/api/routes.py:291-298`
- Modify: `server/pipelines/process_pipeline.py:389`
- Modify: `server/document_registry.py:247`
- Modify: `src/types/documents.ts:20`

- [ ] **Step 1: Update `MoveExecutor` in schemas**

In `server/schemas.py`, change line 17:

```python
MoveExecutor = Literal["none", "client", "server"]
```

To:

```python
MoveExecutor = Literal["none", "client"]
```

- [ ] **Step 2: Remove server branch in routes**

In `server/api/routes.py`, remove the staged file cleanup block (lines ~291-298):

```python
            if (
                staged_path is not None
                and move_executor == "server"
                and response.move_result.success
            ):
                try:
                    staged_path.unlink(missing_ok=True)
                except OSError:
                    pass
```

- [ ] **Step 3: Remove server branch in process_pipeline**

In `server/pipelines/process_pipeline.py`, find the `move_executor == "server"` block (line ~389) and remove it. The `"server"` branch executes the move immediately on the backend — this is no longer needed. Keep the `"client"` branch logic intact.

Read the surrounding code carefully before editing — the if/elif chain for move_executor has `"server"`, `"client"`, and `"none"` branches. Remove only the `"server"` branch.

- [ ] **Step 4: Update document_registry**

In `server/document_registry.py`, make three changes:

1. `MoveHistoryEntry` (line 38): change default executor from `"server"` to `"client"`:
   ```python
   executor: str = "client"
   ```

2. `record_move()` (line 238): change default executor from `"server"` to `"client"`:
   ```python
   executor: str = "client",
   ```

3. `record_move()` (line 247): change finalized logic:
   ```python
   finalized=executor == "server",
   ```
   To:
   ```python
   finalized=False,
   ```

Since the server executor no longer exists, moves are never immediately finalized at registration time.

- [ ] **Step 5: Update frontend types**

In `src/types/documents.ts`, change line 20:

```typescript
export type MoveExecutor = "none" | "client" | "server";
```

To:

```typescript
export type MoveExecutor = "none" | "client";
```

In `src/lib/api.ts`, change line 100:

```typescript
moveExecutor?: "none" | "client" | "server";
```

To:

```typescript
moveExecutor?: "none" | "client";
```

- [ ] **Step 6: Verify backend and frontend**

Run: `PYTHONPATH=. pytest server/tests/test_api.py -q`
Run: `npm run build`
Expected: Both pass.

- [ ] **Step 7: Commit**

```bash
git add server/schemas.py server/api/routes.py server/pipelines/process_pipeline.py server/document_registry.py src/types/documents.ts src/lib/api.ts
git commit -m "refactor: remove move_executor server mode"
```

---

## Task 5: Delete MCP, ChatGPT widget, deploy script, and MCP tests

**Files:**
- Delete: `server/mcp/` (entire directory)
- Delete: `apps/chatgpt-widget/` (entire directory)
- Delete: `scripts/deploy_ai_server.sh`
- Delete: `server/tests/test_mcp_mount.py`
- Delete: `server/tests/test_mcp_tools.py`
- Delete: `server/tests/test_mcp_chatgpt_tools.py`

- [ ] **Step 1: Delete all files**

```bash
rm -rf server/mcp/
rm -rf apps/chatgpt-widget/
rm scripts/deploy_ai_server.sh
rm server/tests/test_mcp_mount.py
rm server/tests/test_mcp_tools.py
rm server/tests/test_mcp_chatgpt_tools.py
```

- [ ] **Step 2: Verify no broken imports**

Run: `PYTHONPATH=. pytest server/tests -q`
Expected: All remaining tests pass. Test count should drop (MCP tests gone) but zero failures.

- [ ] **Step 3: Verify frontend build**

Run: `npm run build`
Expected: Pass (frontend doesn't import MCP code).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete MCP server, ChatGPT widget, and ai-server deploy script"
```

---

## Task 6: Clean up `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Remove MCP variables**

Remove these lines from `.env.example`:

```
ADH_MCP_ENABLED=true
ADH_MCP_MOUNT_PATH=/mcp
ADH_MCP_ALLOWED_ROOTS=["/Users/coffeedev/Projects/02_AUTOMATION-PIPELINES/agentic-docs-handler"]
ADH_MCP_MAX_IMAGE_BYTES=4194304
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: remove MCP env vars from .env.example"
```

---

## Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

This is the largest documentation update. Key changes:

- [ ] **Step 1: Rewrite architecture section**

Replace the architecture diagram with:

```text
Mac (Tauri 2 + React 19)
  ├── FastAPI backend (localhost:9000)
  │     ├── Ollama (localhost:11434)
  │     ├── sentence-transformers + LanceDB
  │     ├── FileOrganizer (YAML rules)
  │     └── Whisper proxy → ai-server2:8090
  └── Tauri UI → localhost:9000
```

- [ ] **Step 2: Remove MCP/ChatGPT sections**

Delete the entire "MCP And ChatGPT" section.

- [ ] **Step 3: Update commands**

Remove `deploy_ai_server.sh` from the commands section. Keep `deploy_whisper_server.sh`.

- [ ] **Step 4: Update key files**

Remove all `server/mcp/*` entries from the key files list.

- [ ] **Step 5: Update gotchas**

- Remove "The real backend normally runs on `ai-server`" gotcha
- Remove ChatGPT upload staging gotcha
- Remove MCP env vars from the env vars list
- Keep Whisper references (ai-server2)

- [ ] **Step 6: Update move execution model**

Remove `move_executor="server"` documentation. Only `"client"` and `"none"` remain.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for local-first architecture"
```

---

## Task 8: Update AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Apply same changes as CLAUDE.md**

Read `AGENTS.md` and apply the same scope of changes: update architecture diagram, remove MCP/ChatGPT sections, update commands, key files, gotchas, and env vars. Keep aligned with `CLAUDE.md`.

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for local-first architecture"
```

---

## Task 9: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full backend test suite**

Run: `PYTHONPATH=. pytest server/tests -q`
Expected: All tests pass, reduced count (MCP tests gone).

- [ ] **Step 2: Run frontend build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Run Rust check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: Clean.

- [ ] **Step 4: Verify no stale imports**

Run: `grep -r "from server.mcp" server/ --include="*.py"`
Expected: No matches.

Run: `grep -r "server/mcp" CLAUDE.md AGENTS.md`
Expected: No matches.

- [ ] **Step 5: Final commit if any fixups needed**

Only if previous steps required adjustments.
