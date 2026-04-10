---
id: research-2026-04-09-per-file-chat-pivot-audit
type: research
date: 2026-04-09
---

# Research: Per-File Chat Pivot Audit

**Backend:** inline  
**Scope:** Main repo orientation plus audit of `feature/per-file-chat-pivot` in `/Users/coffeedev/Projects/02_AUTOMATION-PIPELINES/agentic-docs-handler-per-file-chat`

## Summary

The project is a local-first Tauri + React + FastAPI desktop app for AI-assisted file handling, with workspaces as the organizing model and Ollama/LanceDB/SQLite behind the scenes. The per-file chat pivot branch had the core layout and file-scoped chat work completed, but it still contained a few real follow-up gaps: dead sidebar/drawer state in the document store, untranslated new file-chat UI strings, incomplete workspace-modal tabs, and remembered active-file state that was stored but not restored.

I continued the branch with a focused finish pass. Frontend verification is green after the pass (`npm test`, `npm run build`).

## Key Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Repo-specific architecture, commands, and prompt/locale rules |
| `ARCHITECTURE.md` | High-level system map for Tauri/React/FastAPI/Ollama/LanceDB |
| `docs/superpowers/specs/2026-04-08-per-file-chat-pivot-design.md` | Approved design for the per-file chat pivot |
| `docs/superpowers/plans/2026-04-08-per-file-chat-pivot.md` | Implementation plan Claude followed |
| `src/components/FileChatView.tsx` | New main per-file chat composition surface |
| `src/components/WorkspaceModal.tsx` | Workspace support surface after the pivot |
| `src/hooks/useWorkspaceChat.ts` | Chat mode split between file and workspace scopes |
| `src/store/workspaceStore.ts` | Active workspace, remembered active file, modal state |
| `src/store/documentStore.ts` | Renderer-side document, chat, discovery, and selection state |
| `src/lib/locale.ts` | Frontend locale table used by `t()` |

## Findings

1. The pivot branch is structurally real, not abandoned: backend prompt wiring, file-scoped chat mode, new file rail/context card/filter chip, and app root swap were all already landed.
2. Claude's summary was directionally right, but not complete. The branch still had:
   - dead `sidebarFilter` and `chatDrawerExpanded` state in `src/store/documentStore.ts`
   - an orphaned `src/components/Sidebar.tsx`
   - hardcoded Swedish in the new file-chat components instead of `t()`
   - `WorkspaceModal` tabs with placeholder copy instead of real content in multiple tabs
   - `activeFileIdByWorkspace` stored in `workspaceStore` but not used to restore the selected file
3. The modal/content gap mattered more than cosmetic cleanup: it meant the branch was closer to “MVP delivered with unfinished integration seams” than “fully polished finish”.

## Implemented Continuation

- Removed dead drawer/sidebar state and deleted the orphaned sidebar component.
- Localized the new file-chat UI via `t()` and added matching Swedish/English locale keys.
- Restored remembered active-file selection per workspace in `FileChatView`.
- Replaced modal placeholders with real content:
  - people tab now renders extracted workspace entities
  - ask-workspace tab mounts `WorkspaceNotebook`
  - to-do tab mounts `InsightsFeed`
  - insights tab now shows workspace brief/topics instead of placeholder text
- Added/updated frontend tests for restored active file behavior and modal tab content.

## Verification

- `npm test` → passed, 38 files / 252 tests
- `npm run build` → passed

## Remaining Notes

- `WorkspaceModal.test.tsx` still prints a React `act(...)` warning from `DiscoveryCards` async state churn when switching to the discoveries tab. It is not failing the suite, but it is worth a cleanup pass.
- I did not rerun backend pytest or `cargo check` in this continuation because the changes were frontend-only.
