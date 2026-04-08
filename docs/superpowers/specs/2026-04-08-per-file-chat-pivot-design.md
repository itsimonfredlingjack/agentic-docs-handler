# Per-File Chat Pivot — Design Spec

**Date:** 2026-04-08
**Status:** Approved for implementation planning
**Scope:** Frontend layout restructure + minor backend parameterization

---

## Context

The current product positions itself as "Linear for Files" — a workspace-centric AI file manager. The backend pipeline (classification, entity extraction, workspace suggestion, discovery, chat with memory) is complete and battle-tested (172 frontend tests passing, full Swedish/English prompt parity). The UI is also complete, with a workspace-first layout, `ChatDrawer` at the bottom, and an `InspectorPane` on the right.

**The problem:** The product is horizontally useful but struggles to find a sharp differentiation. "Organize files into workspaces with AI" is a crowded space (Dropbox Dash, Claude Projects, NotebookLM, Notion AI, Obsidian plugins). The owner identified that the one feature which feels irreplaceable during personal use is **the ability to switch files and continue a conversation, smoothly, one file at a time** — something no existing tool handles fluidly. Every competitor requires a new session per file, clunky upload flows, or is cloud-only with privacy friction.

**The pivot:** Reposition the app from "workspace-centric file manager with a chat feature" to **"per-file AI chat with workspace support"**. Chat becomes the center of gravity. The file list becomes the primary navigation affordance. Workspaces demote from organizing metaphor to filter/supporting metadata.

This is a UI-layer pivot. Backend pipelines, data model, LanceDB, prompt architecture, and Tauri shell all remain largely unchanged. The semantic flip happens in how components are composed and which one takes center stage.

---

## Guiding principles

1. **Chat is the identity.** Visually dominant, always present, no drawer metaphor.
2. **Speed over persistence.** File switching must feel instant (~16ms, single render frame, no network). Old conversations are ephemeral by default.
3. **Preserve investments.** Entity extraction, workspace brief, discovery, action queues, insights feed — all survive, demoted to a workspace-overview modal.
4. **Minimum backend change.** Reuse `workspace_chat.py` with a `file_id` parameter rather than inventing a new endpoint.
5. **Don't orphan features.** Everything reachable today must remain reachable after the pivot, even if through fewer interactions.
6. **Keyboard-first.** The target user power-switches files with `j`/`k` while never touching the mouse.

---

## Layout

### New two-column root layout

```
┌────────────────────────────┬───────────────────────────────────┐
│  VÄNSTERKOLUMN (280px)     │  HÖGERKOLUMN (flex)               │
│                            │                                   │
│  [▼ Workspace: Tax 2025]   │  ┌─ FileContextCard ───────────┐  │
│  ↑ filter-chip             │  │ 📄 faktura_2024_03.pdf      │  │
│                            │  │ "Faktura från Telia 412 kr" │  │
│  ── Filer i workspace ──   │  │ [kontrakt] [412 kr] [mars]  │  │
│  ┌──────────────────────┐  │  └─────────────────────────────┘  │
│  │ ▸ faktura_2024_03 ★  │  │                                   │
│  │ ▸ kontrakt_v2        │  │  ┌─ ChatStream ─────────────────┐ │
│  │ ▸ mote_notes.md      │  │  │                              │ │
│  │ ▸ kvitto_cafe.jpg    │  │  │  [du]  När ska den betalas?  │ │
│  └──────────────────────┘  │  │                              │ │
│                            │  │  [ai]  Senast 2024-04-15.    │ │
│  j/k = byt fil             │  │                              │ │
│  ⌘K = sök                  │  │                              │ │
│                            │  └──────────────────────────────┘ │
│                            │                                   │
│                            │  [ Fråga något om den här filen…]│
└────────────────────────────┴───────────────────────────────────┘
```

**Left column (280px fixed):**
- `WorkspaceFilterChip` at the top — clickable dropdown showing current workspace name. Clicking opens a dropdown with Inbox first, then all workspaces, then "Open workspace overview" (triggers the workspace modal).
- `FileRail` below — vertical file list scoped to the current workspace. Keyboard-navigable, compact (name + small type icon + optional thumbnail). Selected file is visually distinct.
- Small hint row at the bottom showing key bindings (`j/k`, `⌘K`).

**Right column (flex, fills remaining width):**
- `FileContextCard` at the top — fixed-height card showing current file's thumbnail, AI title, AI summary, type badge, entity pills. Replaces the role of `InspectorPane`.
- `ChatStream` below — flex-grows to fill. Takes 70% of right-column vertical space. Uses existing SSE infrastructure.
- Chat input at the bottom with placeholder referencing the current file ("Fråga något om faktura_2024_03.pdf…").

**Single-layout rule (from CLAUDE.md):** The same layout is used for all states (empty, loading, streaming, error). State changes affect content within the layout, never the layout itself.

### Inbox as a separate view

Inbox is the one exception. Its triage flow (accept workspace suggestions, bulk move) is a fundamentally different activity than per-file chat, and forcing it into the two-column layout would confuse the mental model. Inbox keeps its current layout. Switching to Inbox from the filter chip dropdown renders the Inbox view; switching to any other workspace renders the new File-Chat view.

---

## Component inventory

### New components

| Component | Purpose | Location |
|---|---|---|
| `FileRail` | Left-column file list, keyboard-navigable | `src/components/FileRail.tsx` |
| `FileContextCard` | Top-right card with current file metadata | `src/components/FileContextCard.tsx` |
| `WorkspaceFilterChip` | Dropdown chip to switch workspace | `src/components/WorkspaceFilterChip.tsx` |
| `WorkspaceModal` | Slide-in workspace overview container | `src/components/WorkspaceModal.tsx` |

### Components that change role

| Component | Before | After |
|---|---|---|
| `ChatStream` (extracted from the existing chat UI — `ChatDrawer` and related) | Drawer at bottom of workspace view | Main right-column content in File-Chat view |
| `WorkspaceHeader` | Always-visible at top of workspace view | Rendered inside `WorkspaceModal` "Översikt" tab |
| `DiscoveryCards` | Below file list | Rendered inside `WorkspaceModal` "Upptäckter" tab |
| `InsightsFeed` | Own tab | Rendered inside `WorkspaceModal` "Insikter" tab |
| `ActionCard` list | Sidebar action queues | Rendered inside `WorkspaceModal` "Att göra" tab |
| Workspace-wide chat component (whichever component currently owns multi-file RAG chat — likely `WorkspaceNotebook` or the workspace path inside `ChatDrawer`) | Main chat surface | Rendered inside `WorkspaceModal` "Fråga workspace" tab |
| `useWorkspaceChat` hook | Default scope: workspace, with memory | Default scope: file, ephemeral; `workspace_id` scope only used inside the modal |

### Components that are removed

- `ChatDrawer` — replaced by `ChatStream` as main content. Drawer state (minimized/expanded) no longer exists.
- `WorkspaceSidebar` — replaced by `WorkspaceFilterChip` + `CommandPalette` workspace switching.
- `InspectorPane` — content folded into `FileContextCard`.
- `WorkspaceView` — replaced by the new root layout in `App.tsx`. The component file itself is deleted.

### Components that are unchanged

- All UI primitives: `Button`, `Card`, `StatusBadge`, `EmptyState`, `ProgressBar`, `SkeletonLoader`, `ErrorBanner`
- `CommandPalette`, `SearchFilterBar`, `DocumentRow` (still used in Inbox view)
- `ProcessingRail`, `ConnectionBanner`, `FileMoveToast`, `WindowDropZone`
- `GhostTyper`, `InlineEdit`, `PipelineStepper`, `TimeGroupHeader`
- `AiPresence`, `NotebookEntry`, `NotebookInput`

---

## File-switching interaction model

### Keyboard bindings

| Key | Action |
|---|---|
| `j` / `↓` | Next file in `FileRail` (context updates instantly) |
| `k` / `↑` | Previous file |
| `⌘K` | Open `CommandPalette` (search files, switch workspace, run commands) |
| `⌘F` | Focus search box in `FileRail` header (filter within workspace) |
| `↵` on file list | Move focus to chat input |
| `Esc` in chat input | Return focus to file list |
| `⌘⏎` in chat input | Send message (existing behavior) |
| `⌘1`..`⌘9` | Quick-switch to workspace N |

**Focus guard:** When focus is in a `textarea`, `input`, or `contenteditable` element, `j`/`k` are treated as letter input, not navigation. The guard already exists in the codebase from prior UX work (`preventListNavigation` pattern) and is reused.

### File-switch sequence

When the user presses `j`:

1. `FileRail` selected index advances; visual highlight moves.
2. `FileContextCard` re-renders with the new file's **cached** metadata (already loaded — see preload strategy).
3. `ChatStream` clears (old messages discarded — chosen behavior, confirmed with owner).
4. `ChatStream` renders an empty prompt-state with placeholder: "Fråga något om {ai_title}…".
5. Chat input resets (no carryover text).
6. **No backend calls happen during the switch.** Everything is local state.
7. Backend is only hit when the user actually sends a message.

Target: ≤16ms from keypress to fully rendered new context (one frame).

### Preload strategy

When a workspace is selected, the existing `GET /workspaces/:id/files` endpoint returns all files. We **extend** its response to include all metadata needed for instant switching:

```typescript
interface WorkspaceFileResponse {
  id: string
  filename: string
  ai_title: string | null          // existing
  ai_summary: string | null        // existing or NEW: inline summary
  ai_type: string | null           // existing
  ai_entities: Entity[]            // NEW: flattened entity list
  thumbnail_url: string | null     // existing
  status: 'processing' | 'ready' | 'error'
  // ... existing fields
}
```

No new endpoint. The `ai_entities` field is the only truly new addition — current response likely already includes `ai_title`, `ai_summary`, `ai_type`, and thumbnails. Implementation verifies this against `server/api/routes.py` before adding.

### First-file-on-open behavior

- If `localStorage` has a last-active-file-per-workspace and that file still exists in the current workspace, select it.
- Otherwise, select the first file in the list.
- If the workspace is empty, render an `EmptyState` in the right column: "Dra filer hit för att börja" with `WindowDropZone` still active.

### Edge cases

| Case | Behavior |
|---|---|
| File has no summary/entities yet (fresh upload) | `FileContextCard` shows `SkeletonLoader` for those fields; chat still works using raw text |
| File currently processing | `StatusBadge` "Analyseras…" in card; chat input enabled (raw text is enough for most questions) |
| Workspace becomes empty mid-session | Switch right column to `EmptyState` |
| Backend disconnect during streaming | Existing `ErrorBanner` pattern; retry available |
| User switches file while streaming | Cancel in-flight SSE request, clear messages, reset to new file |
| Ollama completely unavailable | `ErrorBanner` + retry; input remains editable so user can queue a question |

---

## Backend changes

### Reuse `POST /workspace/chat` with `file_id` parameter

The existing endpoint in `server/api/routes.py` already calls `workspace_chat.py`, which (per commit `75a3ebb`) can already scope to a specific document. The change:

- Add optional `file_id: str | None` to `WorkspaceChatRequest` schema.
- When `file_id` is set, pipeline scopes RAG to that file's chunks only and skips workspace-level memory retrieval (no `past_conversations` fetch). `file_id` takes precedence over `workspace_id` if both are present.
- When only `workspace_id` is set, existing behavior is preserved unchanged — this path is what the workspace modal's "Fråga workspace" tab uses.
- Both cases stream SSE with `context`, `token`, `done`, `error` events as today.

No new route, no new pipeline module, no database migration.

### New prompt file

Add `server/prompts/sv/file_chat_system.txt` and `server/prompts/en/file_chat_system.txt`. Purpose: frame the model as talking about a single specific file (in contrast to `workspace_chat_system.txt`, which assumes multi-file context).

Add `file_chat_system` to `AppConfig.PROMPT_NAMES` in `server/config.py` so it loads at startup. This raises the total prompt-file count from 14 to 15 (one logical prompt name resolved across both `sv/` and `en/`).

Content sketch (Swedish reference):
> Du är en assistent som hjälper användaren förstå en specifik fil. Filens typ är `{ai_type}`. Här är en kort sammanfattning: `{ai_summary}`. Svara kortfattat, konkret och hänvisa till specifika delar av filen när det är relevant. Om frågan inte kan besvaras utifrån filen, säg det tydligt.

English version preserves identical JSON/output contract (no structured output here — just plain text streaming) and is culturally adapted, not literally translated.

### Context-building per question

When `file_id` is set:

1. Fetch file metadata from SQLite: `ai_summary`, `ai_title`, `ai_type`, `ai_entities`.
2. Fetch raw extracted text (or VLM description for images) from document store.
3. Semantic search in LanceDB, **filtered by `file_id`**, to pick top N chunks for the question. This filter primitive already exists in `server/pipelines/search.py`.
4. Build prompt: `file_chat_system.txt` + file summary + relevant chunks + user question.
5. Stream response via existing SSE infrastructure.

### Chat memory code — demoted, not deleted

The `chat_conversation` table and `past_conversations` retrieval (commit `91bde93`) remain in the codebase and database schema. They are **not called** in the per-file default flow. They remain available for the workspace modal's "Fråga workspace" tab, preserving optionality without maintenance cost.

A future cleanup pass can remove the memory feature entirely if it proves dead weight. That cleanup is out of scope for this design.

---

## Workspace modal

Clicking `WorkspaceFilterChip` opens a dropdown; choosing "Open workspace overview" (or clicking the chip's ⓘ icon, exact interaction TBD during implementation) opens a **slide-in panel from the left** covering roughly 60% of the window, with a backdrop blur over the remaining right side.

### Tabs

| Tab | Content | Source |
|---|---|---|
| Översikt | AI brief, stats, entity highlights | `WorkspaceHeader` (reused) |
| Personer & saker | Full entity list across workspace files | `WorkspaceHeader` entity section or new view |
| Upptäckter | Duplicates, versions, contradictions | `DiscoveryCards` (reused) |
| Insikter | AI insights feed | `InsightsFeed` (reused) |
| Att göra | Action queues | `ActionCard` list (reused) |
| Fråga workspace | Multi-file RAG chat with memory | `WorkspaceNotebook` (reused) |

Each tab is a thin wrapper around an existing component. No tab requires new feature development.

### Modal behavior

- Opens via click on `WorkspaceFilterChip`'s overview affordance
- Closes on `Esc`, click outside the panel, or explicit close button
- Modal state is ephemeral (not persisted across reloads)
- Only one modal at a time; opening it while File-Chat view is active does not navigate away — the modal is a temporary overlay

---

## State management

### Frontend store changes

`useWorkspaceChat` hook simplifies:

```typescript
interface FileChatState {
  activeFileId: string | null
  messages: ChatMessage[]           // ephemeral, cleared on file switch
  status: 'idle' | 'streaming' | 'error'
  error: string | null
}
```

- `messages` lives in the hook's local state, not in persisted Zustand.
- On `activeFileId` change, `messages` resets to `[]`.
- The hook gains a `sendMessage(fileId, text)` function that calls `POST /workspace/chat` with `file_id` param.
- A separate `useWorkspaceChatMemory` hook (or unchanged path) is used by the workspace modal's "Fråga workspace" tab.

`workspaceStore` changes:
- Add `activeFileId: string | null` derived/persisted per workspace.
- Add `workspaceModalOpen: boolean` + `workspaceModalTab: string`.
- Remove any state related to the old `WorkspaceSidebar` layout (expand/collapse, etc.).

`documentStore` changes:
- The per-workspace files are already loaded. Extend to ensure `ai_entities` is populated per file.
- Consider splitting into `fileStore` later (out of scope for this pivot, but flagged in the transformation guide as a future refactor).

---

## Testing strategy

### Tests removed

- `ChatDrawer.test.tsx` (if present)
- `WorkspaceSidebar.test.tsx`
- `WorkspaceView.test.tsx`
- Any inspector-specific tests tied to the removed `InspectorPane`

### Tests updated

- `WorkspaceHeader.test.tsx` — tests it inside the modal context rather than as root element
- `DiscoveryCards.test.tsx`, `InsightsFeed.test.tsx` — tested inside modal tabs
- `useWorkspaceChat` test — simplified (remove memory setup, add `file_id` scope assertions)

### Tests added

- `FileRail.test.tsx` — keyboard navigation (`j`/`k`), focus guard when typing, selected state visual, empty workspace fallback
- `FileContextCard.test.tsx` — renders metadata, shows `SkeletonLoader` for missing fields, handles processing status
- `WorkspaceFilterChip.test.tsx` — dropdown opens, Inbox appears first, workspace switch works
- `WorkspaceModal.test.tsx` — opens on trigger, closes with Esc, tab switching works, renders correct inner component per tab
- `RootLayout.test.tsx` (or extension to `App.test.tsx`) — Inbox view vs File-Chat view based on selected workspace
- Backend: `test_file_chat.py` — `POST /workspace/chat` with `file_id` scopes RAG correctly and bypasses memory

### Coverage target

Total test count must remain **≥ 172** after the pivot. Removed tests are offset by added tests. This is a hard rule — net coverage cannot go down.

### Unchanged tests

- All `src/components/ui/*.test.tsx`
- `CommandPalette.test.tsx`, `DocumentRow.test.tsx`, `GhostTyper.test.tsx`, `InlineEdit.test.tsx`, `PipelineStepper.test.tsx`, `ProcessingRail.test.tsx`, `SearchFilterBar.test.tsx`
- All backend pipeline tests (`test_api.py`, entity extraction, classification, workspace brief, suggester)
- `test_workspace_api.py`, `test_workspace_chat.py` — new `file_id` cases added; existing cases unchanged

---

## Implementation order (suggested)

To be refined in the implementation plan, but the intended sequence is:

1. **Backend first (~1–2 days)**
   - New prompt files in `sv/` and `en/`
   - `file_id` parameter in `WorkspaceChatRequest` schema and `workspace_chat.py`
   - Extend `GET /workspaces/:id/files` response with `ai_entities` (and verify other fields)
   - Backend tests: `test_file_chat.py`
   - Verify via curl before touching frontend

2. **New isolated components (~2–3 days)**
   - Build `FileRail`, `FileContextCard`, `WorkspaceFilterChip`, `WorkspaceModal` as standalone components
   - Each with its own unit tests
   - Rendered in isolation during development (old layout untouched)

3. **Root layout swap (~1 day)**
   - Update `App.tsx` to render File-Chat view when a workspace is selected
   - Inbox view remains untouched and takes over when Inbox is selected
   - Old components still in codebase but no longer rendered

4. **Cleanup (~0.5 day)**
   - Delete `ChatDrawer.tsx`, `WorkspaceSidebar.tsx`, `InspectorPane.tsx`, `WorkspaceView.tsx` files
   - Remove dead imports and orphaned test files
   - Verify no stale references

5. **Full verification**
   - `PYTHONPATH=. pytest server/tests -q`
   - `npm test`
   - `npm run build`
   - `cargo check --manifest-path src-tauri/Cargo.toml`

All work happens in an isolated git worktree on a feature branch, following the same pattern as `feature/ui-ux-optimering`.

---

## Out of scope

The following are explicitly **not** part of this pivot, to keep scope manageable:

- Changes to the ingest pipeline (classification, extraction, entity extraction, workspace suggester)
- Changes to Tauri Rust code or WebSocket event contracts
- Changes to LanceDB schema or embedding strategy
- New AI features (this is a repositioning, not a feature expansion)
- New languages beyond maintaining `sv/` and `en/` parity
- Color theme or design-token changes
- Removing the chat memory feature entirely (keep demoted; remove later if it proves dead)
- Splitting `documentStore` into `fileStore`

### Flagged for future follow-ups (not built now)

- Opt-in per-file chat memory (keyed on `file_id`)
- Drag-and-drop a file into the chat to add it as context mid-conversation
- Multi-file chat context ("talk to these three files at once")
- Rolodex-style thumbnail strip at the top of the right column (Alt 3 direction if user wants to go further later)

---

## Success criteria

**Minimum viable pivot:** Opening the app and clicking a workspace should present the two-column layout. Pressing `j`/`k` must switch files with no visible loading state. Typing a question about the current file must stream an answer that demonstrably uses only that file's content. The workspace modal must be reachable from the filter chip and render all six tabs with existing workspace-level features intact.

**Qualitative success:** The owner's own dogfooding should feel distinctly different — "fast chat across my files" instead of "a file manager I occasionally chat with". If the owner catches themselves using `j`/`k` without thinking, the pivot is landing.

**Quantitative success:**
- Test count ≥ 172 (no regression)
- `npm run build` passes
- Backend tests pass
- `cargo check` passes
- File switch → context refresh latency ≤ 16ms (measured via React DevTools profiler or manual inspection)

**Anti-goal:** This pivot must not make workspace features harder to reach by more than one extra click. Everything that exists today must still be reachable. If a feature becomes unreachable or requires three+ clicks to find, the design has failed.

---

## Open questions deferred to implementation

1. Exact visual treatment of the `WorkspaceFilterChip` affordance that opens the modal (separate ⓘ icon vs. chip-as-dropdown-with-overview-option vs. hover-to-reveal)
2. Whether `FileRail` should show thumbnails inline for every file or only for images (cost: vertical density vs. scanability)
3. Whether selected-file persistence is per-workspace or global (leaning per-workspace)
4. Exact slide-in animation timing for `WorkspaceModal` (use existing `--transition-slide` token by default)
5. Whether the chat input should show entity suggestions from the current file while typing (future nice-to-have, not MVP)

These are resolved during implementation, not during design.

---

## References

- Product vision: `claude-code-transformation-guide.md`
- Prior chat redesign: `docs/superpowers/specs/2026-04-06-chat-drawer-redesign.md`
- Workspace chat memory design: `docs/superpowers/specs/2026-04-06-workspace-chat-memory-design.md`
- AI insights feed design: `docs/superpowers/specs/2026-04-06-ai-insights-feed-design.md`
- Prior UX optimization session: `thoughts/ledgers/CONTINUITY_ses_2b18.md`
- Code style conventions: `CODE_STYLE.md`
- Single-layout rule, prompt architecture, and workflow: `CLAUDE.md`
