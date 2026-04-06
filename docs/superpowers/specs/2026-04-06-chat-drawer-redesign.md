# Chat Drawer Redesign — Design Spec

## Context

The current chat lives in a togglable right panel (WorkspaceNotebook) that feels bolted on — awkward to open, confusing which mode you're in (workspace vs document), and competing with the inspector for space. Users want a real conversation experience that's naturally integrated into the app. This redesign replaces the right panel chat with a bottom drawer that's always accessible, context-aware, and keeps documents visible.

## Design Summary

Replace the right-panel chat with a **bottom drawer** in the workspace view. Two states: minimized (input bar at bottom) and expanded (conversation + input, documents compressed above). Remove document-specific chat — workspace-level RAG is sufficient. Remove all right-panel chat infrastructure.

### Design Principles

- **Input near the bottom** — Users type where their eyes naturally rest, not up in a header.
- **Documents always visible** — Even when chatting, the document list is compressed but present.
- **One chat mode** — Workspace chat only. No document mode, no category mode from UI. AI finds relevant docs via RAG.
- **Two fixed sizes** — Minimized and expanded. No free-dragging. Predictable and simple.

---

## 1. Chat Drawer — Minimized State (Default)

The drawer is a persistent bar at the bottom of the workspace view, below the document list.

### Anatomy

```
┌─────────────────────────────────────────────┐
│  Document list (full height)                │
│  ...                                        │
│  ...                                        │
├─────────────────────────────────────────────┤
│  [AI ring]  Fråga AI om dina dokument...  ⏎ │  ← input bar
└─────────────────────────────────────────────┘
```

### Behavior

- Always visible at the bottom of WorkspaceView (inside the scrollable area, pinned to bottom).
- Height: ~52px (padding + input field).
- Border-top: `1px solid rgba(88,86,214,0.15)` — subtle accent line.
- Background: `rgba(20,20,28,0.95)` — slightly darker than content area.
- Input field: rounded (10px), placeholder "Fråga AI om dina dokument..." / "Ask AI about your documents...".
- Small AI ring motif (16px) to the left of the input.
- Enter hint on the right.
- Clicking the input or pressing any key focuses it and expands the drawer.

---

## 2. Chat Drawer — Expanded State

Triggered by: focusing the input, typing, or clicking the drawer area when a conversation exists.

### Anatomy

```
┌─────────────────────────────────────────────┐
│  ● Kvitto Espresso  ● Faktura Nordic  +120  │  ← compressed doc row
├─────────────────────────────────────────────┤
│  [AI ring] Inkorg · 122 dok    Ny chatt  ▾  │  ← context header
│                                              │
│  Du                                          │
│  Hur mycket har jag spenderat...             │
│                                              │
│  AI                                          │
│  Totalt 4 230 kr på 8 kvitton...             │
│  [● ICA] [● Espresso] +6                    │  ← source pills
│                                              │
├─────────────────────────────────────────────┤
│  Följ upp...                              ⏎ │  ← input
└─────────────────────────────────────────────┘
```

### Behavior

- Drawer expands upward to ~50% of the workspace view height.
- Transition: `height` with `var(--transition-slide)` (220ms ease-out).
- Document list compresses to a single horizontal row showing a few doc pills + count ("+120"). This row remains clickable — clicking a doc still opens the inspector.
- Context header: AI ring motif (14px) + workspace name + document count + "Ny chatt" button + "Minimera" / chevron button.
- Messages scroll within the drawer. Auto-scroll to bottom on new messages.
- Escape key or "Minimera" button collapses back to minimized state.
- Conversation persists — expanding again shows the previous messages.

### Context Header

- Shows: `[AI ring] {workspace name} · {doc count} dok`
- "Ny chatt" clears the conversation for this workspace (calls `DELETE /conversations/{key}`, resets store).
- "Minimera" (or `▾` chevron) collapses the drawer.

### Message Rendering

**User messages:**
- Label: "Du" + timestamp (muted, 9px)
- Background: `rgba(255,255,255,0.04)`, border: `rgba(255,255,255,0.06)`, rounded 10px.
- Text: 12px, `--text-primary`.

**AI messages:**
- Label: AI ring icon (14px) + "AI" + timestamp (accent tint, 9px)
- Text: 12px, `--text-primary`, left-padded 20px (aligned under label).
- Streaming: token-by-token with blinking cursor (existing `streamingText` infrastructure).
- Source pills below each AI message.

**Source pills:**
- Type-colored dot (3px) + truncated title.
- Background: `rgba(255,255,255,0.04)`, border: `rgba(255,255,255,0.08)`.
- Clickable → calls `setSelectedDocument(id)` to open in inspector.
- If more than 3 sources, show "+N" count.

### Empty State (No Conversation Yet)

When expanded with no messages:
- Centered text: "Fråga vad som helst om dina {count} dokument" (13px, `--text-secondary`).
- No AI ring — the input is the focus.

---

## 3. What Gets Removed

| Item | Current Location | Action |
|------|-----------------|--------|
| `WorkspaceNotebook` rendered in App.tsx | `App.tsx` line 95-99 | Remove conditional render |
| Chat toggle button in WorkspaceHeader | `WorkspaceHeader.tsx` | Remove button |
| "Chat about this doc" button | `InspectorPane.tsx` line 362 | Remove button |
| `chatPanelOpen` state | `workspaceStore.ts` | Remove field + `toggleChatPanel` + `setChatPanelOpen` |
| `activeDocumentChat` state | `documentStore.ts` | Remove field + `setActiveDocumentChat` |
| Document chat mode in `useWorkspaceChat` | `useWorkspaceChat.ts` | Remove `document_id` parameter path |
| `HomeChat` component | `src/components/HomeChat.tsx` | Delete file (already dead code) |
| `HomeChat` test | `src/components/HomeChat.test.tsx` | Delete file |

**Not removed:**
- `WorkspaceNotebook.tsx` file — repurposed as the drawer's chat content (or replaced with new `ChatDrawer.tsx`)
- `useWorkspaceChat.ts` hook — simplified to workspace-only mode
- Backend `/workspace/chat` endpoint — unchanged, still supports `workspace_id` param
- Backend conversation persistence — unchanged

---

## 4. Data Flow

### Simplified Chat Flow

```
ChatDrawer (minimized input bar)
  → User types + Enter
  → Expand drawer
  → useWorkspaceChat.sendMessage(query)
    → documentStore.startWorkspaceQuery(workspaceId, query)
    → streamWorkspaceChat(workspace_id=activeWorkspaceId, message, history)
  → POST /workspace/chat { workspace_id, message, history }
  → Backend: prepare_workspace_context() → RAG search → LLM stream
  → SSE tokens → appendStreamingToken() → UI updates
  → done → finalizeStreamingEntry()
  → POST /conversations/{workspaceId} → persist entry
```

### Conversation Key

- `workspaceId` (e.g., `"67bcb87d-..."`) — one conversation per workspace.
- Switching workspaces shows that workspace's conversation (or empty state).
- "Ny chatt" clears the conversation.

---

## 5. State Changes

### workspaceStore.ts — removals

```
- chatPanelOpen: boolean              // REMOVE
- toggleChatPanel: () => void         // REMOVE
- setChatPanelOpen: (open) => void    // REMOVE
```

### documentStore.ts — removals

```
- activeDocumentChat: string | null           // REMOVE
- setActiveDocumentChat: (id) => void         // REMOVE
```

### documentStore.ts — additions

```
+ chatDrawerExpanded: boolean                  // default: false
+ setChatDrawerExpanded: (open: boolean) => void
```

### useWorkspaceChat.ts — simplification

- Remove `activeDocumentChat` reading
- Remove `document_id` parameter from `streamWorkspaceChat` calls
- Conversation key: always `activeWorkspaceId` (remove `doc:` prefix path)

---

## 6. New Component

### `ChatDrawer.tsx`

Single component handling both minimized and expanded states.

**Props:** `workspaceId: string`

**Reads from store:**
- `chatDrawerExpanded` — which state to render
- `conversations[workspaceId]` — current conversation
- Workspace name/count from `workspaceStore`

**Responsibilities:**
- Render minimized input bar OR expanded conversation
- Handle expand/collapse transitions
- Render message list with source pills
- Render compressed document row (when expanded)
- Handle "Ny chatt" (clear conversation)
- Focus management (focus input on expand, blur on collapse)
- Escape key handling (collapse)

**Reuses from WorkspaceNotebook:**
- `NotebookEntry` rendering pattern (user/AI messages)
- `NotebookInput` or equivalent input component
- `useWorkspaceChat` hook (simplified)

---

## 7. Files to Create

| File | Purpose |
|------|---------|
| `src/components/ChatDrawer.tsx` | Main drawer component (minimized + expanded states) |

## 8. Files to Modify

| File | Change |
|------|--------|
| `src/components/WorkspaceView.tsx` | Add `ChatDrawer` at bottom of workspace view |
| `src/store/documentStore.ts` | Remove `activeDocumentChat` + `setActiveDocumentChat`, add `chatDrawerExpanded` + setter |
| `src/store/workspaceStore.ts` | Remove `chatPanelOpen` + `toggleChatPanel` + `setChatPanelOpen` |
| `src/hooks/useWorkspaceChat.ts` | Simplify to workspace-only mode |
| `src/components/InspectorPane.tsx` | Remove "Chat about this doc" button |
| `src/components/WorkspaceHeader.tsx` | Remove chat toggle button |
| `src/App.tsx` | Remove `WorkspaceNotebook` conditional render, remove `chatPanelOpen` import |
| `src/lib/locale.ts` | Add drawer-specific strings |

## 9. Files to Delete

| File | Reason |
|------|--------|
| `src/components/HomeChat.tsx` | Dead code, never rendered |
| `src/components/HomeChat.test.tsx` | Tests for dead code |

## 10. Verification Plan

1. **Unit tests**: ChatDrawer (renders minimized, expands on focus, shows messages, collapses on Esc, source pills click). Update WorkspaceView tests for drawer presence.
2. **Store tests**: Update documentStore tests (remove activeDocumentChat tests, add chatDrawerExpanded). Update workspaceStore tests (remove chatPanelOpen tests).
3. **Integration**: Start backend + frontend → navigate to workspace → type in drawer → verify streaming response → click source pill → verify inspector opens → click "Ny chatt" → verify conversation clears → switch workspace → verify separate conversation.
4. **Build check**: `npm run build` + `npm test` + `cargo check`.
5. **Removed features**: Verify WorkspaceNotebook no longer renders, chat toggle button gone from header, "Chat about this doc" button gone from inspector.
