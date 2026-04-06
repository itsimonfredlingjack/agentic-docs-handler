# Chat Drawer Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right-panel chat (WorkspaceNotebook) with a bottom drawer that's always visible as an input bar and expands into a conversation view.

**Architecture:** New `ChatDrawer` component renders at the bottom of `WorkspaceView`. Minimized = input bar. Expanded = conversation + input, documents compressed above. `useWorkspaceChat` simplified to workspace-only mode. Old panel infrastructure removed.

**Tech Stack:** React 19, Zustand, existing `NotebookEntry`/`NotebookInput` components, existing `useWorkspaceChat` hook, existing SSE streaming backend.

---

### Task 1: State cleanup — remove old chat panel state

**Files:**
- Modify: `src/store/workspaceStore.ts`
- Modify: `src/store/documentStore.ts`
- Modify: `src/store/workspaceStore.test.ts`

- [ ] **Step 1: Remove `chatPanelOpen` and related actions from workspaceStore**

In `src/store/workspaceStore.ts`, remove from the type:

```ts
// REMOVE these three lines from WorkspaceStoreState type:
chatPanelOpen: boolean;
toggleChatPanel: () => void;
setChatPanelOpen: (open: boolean) => void;
```

Remove from initial state:

```ts
// REMOVE this line from initial state:
chatPanelOpen: false,
```

Remove from `setActiveWorkspace` — change:

```ts
setActiveWorkspace: (id) => set({ activeWorkspaceId: id, activeWorkspaceTab: "documents", chatPanelOpen: false }),
```

to:

```ts
setActiveWorkspace: (id) => set({ activeWorkspaceId: id, activeWorkspaceTab: "documents" }),
```

Remove the action implementations:

```ts
// REMOVE these two lines:
toggleChatPanel: () => set((state) => ({ chatPanelOpen: !state.chatPanelOpen })),
setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
```

- [ ] **Step 2: Remove `activeDocumentChat` from documentStore, add `chatDrawerExpanded`**

In `src/store/documentStore.ts`, remove from the type:

```ts
// REMOVE:
activeDocumentChat: string | null;
setActiveDocumentChat: (documentId: string | null) => void;
```

Add to the type:

```ts
chatDrawerExpanded: boolean;
setChatDrawerExpanded: (expanded: boolean) => void;
```

Remove from initial state:

```ts
// REMOVE:
activeDocumentChat: null,
```

Add to initial state:

```ts
chatDrawerExpanded: false,
```

Remove the action:

```ts
// REMOVE:
setActiveDocumentChat: (documentId) => set({ activeDocumentChat: documentId, activeWorkspace: null }),
```

Add the action:

```ts
setChatDrawerExpanded: (expanded) => set({ chatDrawerExpanded: expanded }),
```

- [ ] **Step 3: Update workspaceStore tests**

In `src/store/workspaceStore.test.ts`, remove the `chatPanelOpen` initial state assertion, the `toggleChatPanel` describe block, and the `setChatPanelOpen` describe block. Also remove `chatPanelOpen: false` from the `setActiveWorkspace` test assertion if it checks for it. Remove `chatPanelOpen` from any test setState calls that set it.

- [ ] **Step 4: Build check**

Run: `npm run build 2>&1 | head -30`

This WILL show errors in files that still reference removed state. That's expected — we fix those in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add src/store/workspaceStore.ts src/store/documentStore.ts src/store/workspaceStore.test.ts
git commit -m "refactor: remove chat panel state, add chatDrawerExpanded"
```

---

### Task 2: Simplify useWorkspaceChat to workspace-only mode

**Files:**
- Modify: `src/hooks/useWorkspaceChat.ts`
- Modify: `src/hooks/useWorkspaceChat.test.tsx`

- [ ] **Step 1: Remove document mode from useWorkspaceChat**

Replace the full contents of `src/hooks/useWorkspaceChat.ts` with:

```ts
import { useCallback, useEffect, useRef } from "react";
import { useDocumentStore } from "../store/documentStore";
import { fetchConversation, saveConversationEntry, streamWorkspaceChat } from "../lib/api";
import { useWorkspaceStore } from "../store/workspaceStore";
import { t } from "../lib/locale";

export function useWorkspaceChat() {
  const conversations = useDocumentStore((s) => s.conversations);
  const startQuery = useDocumentStore((s) => s.startWorkspaceQuery);
  const appendToken = useDocumentStore((s) => s.appendStreamingToken);
  const finalize = useDocumentStore((s) => s.finalizeStreamingEntry);
  const hydrate = useDocumentStore((s) => s.hydrateConversation);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const abortRef = useRef<AbortController | null>(null);

  const conversationKey = activeWorkspaceId;
  const conversation = conversationKey ? conversations[conversationKey] : undefined;
  const isStreaming = conversation?.isStreaming ?? false;

  // Hydrate persisted conversation when workspace activates
  useEffect(() => {
    if (!conversationKey) return;
    const existing = useDocumentStore.getState().conversations[conversationKey];
    if (existing && existing.entries.length > 0) return;

    let cancelled = false;
    fetchConversation(conversationKey)
      .then((data) => {
        if (cancelled || !data.entries.length) return;
        hydrate(conversationKey, data.entries.map((e) => ({
          id: e.id,
          query: e.query,
          response: e.response,
          timestamp: e.timestamp,
          sourceCount: e.sourceCount,
          sources: e.sources,
          errorMessage: e.errorMessage,
        })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [conversationKey, hydrate]);

  // Abort stream on workspace change or unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [conversationKey]);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!conversationKey) return;
      const currentConv = useDocumentStore.getState().conversations[conversationKey];
      if (currentConv?.isStreaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      startQuery(conversationKey, message);

      const conv = useDocumentStore.getState().conversations[conversationKey];
      const history: Array<{ role: string; content: string }> = [];
      if (conv) {
        for (const entry of conv.entries.slice(0, -1)) {
          if (entry.query) history.push({ role: "user", content: entry.query });
          if (entry.response) history.push({ role: "assistant", content: entry.response });
        }
      }

      let sourceCount = 0;
      let sources: Array<{ id: string; title: string }> = [];
      let errorMessage: string | null = null;
      let tokenCount = 0;
      try {
        for await (const event of streamWorkspaceChat(undefined, message, history, {
          signal: controller.signal,
          workspace_id: activeWorkspaceId ?? undefined,
        })) {
          if (event.type === "context") {
            sourceCount = event.data.source_count;
            sources = event.data.sources ?? [];
          } else if (event.type === "token") {
            appendToken(conversationKey, event.data.text);
            tokenCount++;
          } else if (event.type === "error") {
            errorMessage = event.data.error || t("chat.unknown_error");
            break;
          }
        }
        if (!errorMessage && tokenCount === 0) {
          errorMessage = t("chat.empty_response");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          finalize(conversationKey, sourceCount, sources, null);
          return;
        }
        errorMessage = error instanceof Error ? error.message : t("chat.connection_error");
      }
      finalize(conversationKey, sourceCount, sources, errorMessage);

      const finalConv = useDocumentStore.getState().conversations[conversationKey];
      if (finalConv && finalConv.entries.length > 0) {
        const lastEntry = finalConv.entries[finalConv.entries.length - 1];
        saveConversationEntry(conversationKey, {
          query: lastEntry.query,
          response: lastEntry.response,
          sourceCount: lastEntry.sourceCount,
          sources: lastEntry.sources,
          errorMessage: lastEntry.errorMessage,
        }).catch(() => {});
      }
    },
    [conversationKey, activeWorkspaceId, startQuery, appendToken, finalize],
  );

  return { conversation, isStreaming, sendMessage, conversationKey };
}
```

Key changes: removed `activeDocumentChat`, `chatDocument`, `isDocumentMode`, `category`, `doc:` prefix. Return value changed — no more `chatDocument`.

- [ ] **Step 2: Update useWorkspaceChat test**

In `src/hooks/useWorkspaceChat.test.tsx`, remove `chatPanelOpen` and `activeDocumentChat` from any mock store states. Update import if needed. The test should verify workspace-mode chat still works.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWorkspaceChat.ts src/hooks/useWorkspaceChat.test.tsx
git commit -m "refactor: simplify useWorkspaceChat to workspace-only mode"
```

---

### Task 3: Create ChatDrawer component

**Files:**
- Create: `src/components/ChatDrawer.tsx`

- [ ] **Step 1: Create the ChatDrawer component**

Create `src/components/ChatDrawer.tsx`:

```tsx
import { useEffect, useRef } from "react";

import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkspaceChat } from "../hooks/useWorkspaceChat";
import { NotebookEntry } from "./NotebookEntry";
import { NotebookInput } from "./NotebookInput";
import { t } from "../lib/locale";

type ChatDrawerProps = {
  workspaceId: string;
};

export function ChatDrawer({ workspaceId }: ChatDrawerProps) {
  const expanded = useDocumentStore((s) => s.chatDrawerExpanded);
  const setExpanded = useDocumentStore((s) => s.setChatDrawerExpanded);
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const { conversation, isStreaming, sendMessage } = useWorkspaceChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasConversation = (conversation?.entries.length ?? 0) > 0;

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.streamingText, conversation?.entries.length]);

  // Escape to collapse
  useEffect(() => {
    if (!expanded) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        if (target?.closest(".chat-drawer")) {
          e.stopPropagation();
          setExpanded(false);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [expanded, setExpanded]);

  const handleSubmit = (message: string) => {
    if (!expanded) setExpanded(true);
    void sendMessage(message);
  };

  const handleClearChat = () => {
    // Clear the conversation from the store
    useDocumentStore.getState().hydrateConversation(workspaceId, []);
  };

  const workspaceName = workspace?.name ?? "Workspace";
  const docCount = workspace?.file_count ?? 0;

  if (!expanded) {
    return (
      <div className="chat-drawer chat-drawer--minimized border-t border-[rgba(88,86,214,0.15)] bg-[rgba(20,20,28,0.95)]">
        <div className="px-3 py-2">
          <NotebookInput
            placeholder={t("chat.drawer_placeholder")}
            disabled={isStreaming}
            onSubmit={handleSubmit}
            onFocusChange={(focused) => {
              if (focused && hasConversation) setExpanded(true);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-drawer chat-drawer--expanded flex flex-col border-t-2 border-[rgba(88,86,214,0.15)] bg-[rgba(20,20,28,0.95)]" style={{ height: "50%" }}>
      {/* Context header */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 28 28" className="shrink-0">
            <circle cx="14" cy="14" r="12" fill="none" stroke="rgba(88,86,214,0.3)" strokeWidth="1" strokeDasharray="3 2" />
            <circle cx="14" cy="14" r="5" fill="rgba(88,86,214,0.2)" stroke="rgba(88,86,214,0.4)" strokeWidth="0.8" />
          </svg>
          <span className="text-xs-ui text-[var(--text-secondary)]">
            {workspaceName}
          </span>
          <span className="text-xs-ui font-mono text-[var(--text-disabled)]">
            {docCount} dok
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="text-xs-ui text-[var(--text-disabled)] hover:text-[var(--text-secondary)] transition-colors"
            onClick={handleClearChat}
          >
            {t("chat.new_chat")}
          </button>
          <button
            type="button"
            className="text-xs-ui text-[var(--text-disabled)] hover:text-[var(--text-secondary)] transition-colors"
            onClick={() => setExpanded(false)}
          >
            {t("chat.minimize")}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 scrollbar-hide">
        {hasConversation ? (
          conversation!.entries.map((entry, index) => {
            const isLast = index === conversation!.entries.length - 1;
            return (
              <NotebookEntry
                key={entry.id}
                query={entry.query}
                response={entry.response}
                sourceCount={entry.sourceCount}
                sources={entry.sources}
                errorMessage={entry.errorMessage}
                isStreaming={isLast && isStreaming}
                streamingText={isLast && isStreaming ? conversation!.streamingText : undefined}
              />
            );
          })
        ) : (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm-ui text-[var(--text-muted)]">
              {t("chat.empty_prompt").replace("{count}", String(docCount))}
            </p>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-3 py-2 border-t border-[rgba(255,255,255,0.04)]">
        <NotebookInput
          placeholder={t("chat.followup_placeholder")}
          disabled={isStreaming}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add locale strings**

In `src/lib/locale.ts`, add to the Swedish strings (after the insights section):

```ts
// Chat drawer
"chat.drawer_placeholder": "Fråga AI om dina dokument...",
"chat.followup_placeholder": "Följ upp...",
"chat.new_chat": "Ny chatt",
"chat.minimize": "Minimera",
"chat.empty_prompt": "Fråga vad som helst om dina {count} dokument",
```

Add the same keys to the English strings:

```ts
// Chat drawer
"chat.drawer_placeholder": "Ask AI about your documents...",
"chat.followup_placeholder": "Follow up...",
"chat.new_chat": "New chat",
"chat.minimize": "Minimize",
"chat.empty_prompt": "Ask anything about your {count} documents",
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ChatDrawer.tsx src/lib/locale.ts
git commit -m "feat: create ChatDrawer component with minimized/expanded states"
```

---

### Task 4: Wire ChatDrawer into WorkspaceView

**Files:**
- Modify: `src/components/WorkspaceView.tsx`

- [ ] **Step 1: Add ChatDrawer to WorkspaceView**

In `src/components/WorkspaceView.tsx`, add the import at the top:

```ts
import { ChatDrawer } from "./ChatDrawer";
```

Change the main layout structure. The current structure is:

```tsx
<main className="flex min-h-0 flex-1 flex-col items-stretch overflow-hidden bg-[rgba(0,0,0,0.1)] outline-none" tabIndex={-1}>
  <div className="border-b border-[var(--surface-4)]">
    ...tabs...
  </div>
  <div className="flex-1 overflow-y-auto pt-2 pb-4">
    ...content...
  </div>
</main>
```

Change it to:

```tsx
<main className="flex min-h-0 flex-1 flex-col items-stretch overflow-hidden bg-[rgba(0,0,0,0.1)] outline-none" tabIndex={-1}>
  <div className="border-b border-[var(--surface-4)]">
    ...tabs...
  </div>
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex-1 overflow-y-auto pt-2 pb-4">
      ...content...
    </div>
    {activeWorkspaceId && <ChatDrawer workspaceId={activeWorkspaceId} />}
  </div>
</main>
```

The key change: wrap the scrollable content + ChatDrawer in a flex column so the drawer sits at the bottom and the content takes remaining space.

- [ ] **Step 2: Commit**

```bash
git add src/components/WorkspaceView.tsx
git commit -m "feat: wire ChatDrawer into WorkspaceView bottom"
```

---

### Task 5: Remove old chat infrastructure from UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/WorkspaceHeader.tsx`
- Modify: `src/components/InspectorPane.tsx`

- [ ] **Step 1: Remove WorkspaceNotebook from App.tsx**

In `src/App.tsx`:

Remove the import:
```ts
import { WorkspaceNotebook } from "./components/WorkspaceNotebook";
```

Remove the `chatPanelOpen` store read:
```ts
const chatPanelOpen = useWorkspaceStore((s) => s.chatPanelOpen);
```

Remove the conditional render block (around lines 95-99):
```tsx
{chatPanelOpen && (
  <aside className="workspace-panel glass-panel hidden lg:flex">
    <WorkspaceNotebook />
  </aside>
)}
```

- [ ] **Step 2: Remove chat toggle from WorkspaceHeader**

In `src/components/WorkspaceHeader.tsx`:

Remove these store reads:
```ts
const toggleChatPanel = useWorkspaceStore((s) => s.toggleChatPanel);
const chatPanelOpen = useWorkspaceStore((s) => s.chatPanelOpen);
```

Remove the chat toggle button (the button with `onClick={toggleChatPanel}` and the sparkle SVG icon, around lines 74-85).

- [ ] **Step 3: Remove "Chat about this doc" from InspectorPane**

In `src/components/InspectorPane.tsx`, in the `ModalContent` function:

Remove the store read:
```ts
const setActiveDocumentChat = useDocumentStore((state) => state.setActiveDocumentChat);
```

Remove the "Chat about this doc" button (around lines 359-368) — the button that calls `setActiveDocumentChat(document.id)`.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/WorkspaceHeader.tsx src/components/InspectorPane.tsx
git commit -m "refactor: remove old chat panel from App, Header, and Inspector"
```

---

### Task 6: Delete dead code

**Files:**
- Delete: `src/components/HomeChat.tsx`
- Delete: `src/components/HomeChat.test.tsx`

- [ ] **Step 1: Delete HomeChat files**

```bash
rm src/components/HomeChat.tsx src/components/HomeChat.test.tsx
```

- [ ] **Step 2: Commit**

```bash
git add -A src/components/HomeChat.tsx src/components/HomeChat.test.tsx
git commit -m "chore: delete dead HomeChat component and tests"
```

---

### Task 7: Fix remaining test references

**Files:**
- Modify: `src/hooks/useSearch.test.tsx` (remove `chatPanelOpen` from mock state)
- Modify: `src/hooks/useSearchAiSummary.test.tsx` (remove `chatPanelOpen`)
- Modify: `src/components/WorkspaceSidebar.test.tsx` (remove `chatPanelOpen`)
- Modify: `src/components/CommandPalette.test.tsx` (remove `chatPanelOpen`)
- Modify: `src/components/WorkspaceNotebook.test.tsx` (remove `chatPanelOpen` and `activeDocumentChat` references, or delete if no longer needed)
- Modify: `src/store/documentStore.test.ts` (remove `activeDocumentChat` references)

- [ ] **Step 1: Remove `chatPanelOpen` from all test mock states**

In each test file that sets `chatPanelOpen` in mock workspace store state, remove that line. Search for `chatPanelOpen` in test files and delete each occurrence.

- [ ] **Step 2: Remove `activeDocumentChat` from documentStore test**

In `src/store/documentStore.test.ts`, remove any assertions or setup related to `activeDocumentChat`.

- [ ] **Step 3: Handle WorkspaceNotebook test**

If `src/components/WorkspaceNotebook.test.tsx` exists and tests the old right-panel behavior, delete it — the component is no longer rendered from App.tsx. The WorkspaceNotebook file itself can remain in the codebase (it's not imported anywhere) but its tests are no longer relevant.

- [ ] **Step 4: Build and test**

Run: `npm run build && npm test`

Expected: Clean build, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: fix test references after chat panel removal"
```

---

### Task 8: Full verification

- [ ] **Step 1: Full build chain**

```bash
npm run build && npm test && cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: All pass.

- [ ] **Step 2: Backend tests**

```bash
PYTHONPATH=. pytest server/tests -q --tb=short
```

Expected: All pass (no backend changes in this feature).

- [ ] **Step 3: Manual verification checklist**

Start the app (`npm run tauri dev` with backend running):

1. Bottom of workspace view shows a minimized input bar
2. Clicking the input or typing expands the drawer
3. Sending a message shows streaming AI response
4. Source pills appear under AI responses
5. Clicking a source pill opens the document in the inspector
6. "Ny chatt" clears the conversation
7. "Minimera" or Esc collapses the drawer
8. Switching workspaces shows that workspace's conversation
9. No chat toggle button in workspace header
10. No "Chat about this doc" button in inspector
11. No right-side chat panel anywhere

- [ ] **Step 4: Final commit if any manual fixes needed**

```bash
git add -A
git commit -m "fix: address manual verification issues"
```
