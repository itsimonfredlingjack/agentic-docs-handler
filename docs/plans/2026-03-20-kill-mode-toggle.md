# Kill ModeToggle — Workspace Chat as Side Panel

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the "Aktivitet / Analys" mode toggle and bring workspace chat into the main activity view as a right-side panel, so the activity feed is always visible and chat is additive.

**Architecture:** Delete ModeToggle, WorkspaceGrid, and WorkspaceCard. Add a small chat-trigger icon per document-category sidebar pill. Clicking it sets `activeWorkspace` which renders WorkspaceNotebook as a right panel alongside the activity feed. The panel uses the existing glass-panel design language and slides in from the right.

**Tech Stack:** React 19, Zustand, Tailwind CSS, Vitest

**Decomposition Strategy:** Feature-based

**Target Model:** Sonnet 30min chunks

---

## Task 1: Remove ViewMode from store and types

**Chunk estimate:** ~10 min (Sonnet)

**Files:**
- Modify: `src/types/documents.ts:371` — delete the `ViewMode` type
- Modify: `src/store/documentStore.ts` — remove `viewMode`, `setViewMode`
- Modify: `src/store/documentStore.test.ts` — remove viewMode assertions

**Step 1: Remove `ViewMode` type from documents.ts**

Delete line 371:
```ts
export type ViewMode = "activity" | "workspaces";
```

**Step 2: Remove viewMode from documentStore.ts**

Remove from `DocumentStoreState`:
```ts
viewMode: ViewMode;
```
```ts
setViewMode: (mode: ViewMode) => void;
```

Remove the import of `ViewMode` from the import block.

Remove from initial state:
```ts
viewMode: "activity",
```

Remove the action:
```ts
setViewMode: (mode) => set({ viewMode: mode }),
```

**Step 3: Update documentStore.test.ts**

In the `bootstrap` test around line 77, remove the `viewMode: "activity"` expectation.

Delete the `"sets view mode"` test (lines ~396-400):
```ts
it("sets view mode", () => {
  const store = useDocumentStore.getState();
  store.setViewMode("workspaces");
  expect(useDocumentStore.getState().viewMode).toBe("workspaces");
});
```

In the `beforeEach` for workspace state tests (~line 388), remove `viewMode: "activity"` from `setState`.

**Step 4: Run tests**

Run: `npm test`
Expected: All pass (tests that referenced viewMode are removed, nothing else touches it yet)

**Step 5: Commit**

```bash
git add src/types/documents.ts src/store/documentStore.ts src/store/documentStore.test.ts
git commit -m "refactor: remove ViewMode from store and types"
```

**Verification Gate:**
1. Automated: `npm test` — all pass
2. Manual: `grep -r "ViewMode\|viewMode" src/` returns only the files we'll clean up in Task 2
3. Regression: `npm run build` — type-checks pass
4. Review: Diff is purely deletions from 3 files

---

## Task 2: Delete ModeToggle, WorkspaceGrid, WorkspaceCard and their tests

**Chunk estimate:** ~15 min (Sonnet)

**Files:**
- Delete: `src/components/ModeToggle.tsx`
- Delete: `src/components/WorkspaceGrid.tsx`
- Delete: `src/components/WorkspaceGrid.test.tsx`
- Delete: `src/components/WorkspaceCard.tsx`
- Modify: `src/components/Sidebar.tsx` — remove ModeToggle import and usage, remove `viewMode` guard on filter nav
- Modify: `src/App.tsx` — remove viewMode branching, remove WorkspaceGrid import

**Step 1: Delete the component files**

Delete these 4 files:
- `src/components/ModeToggle.tsx`
- `src/components/WorkspaceGrid.tsx`
- `src/components/WorkspaceGrid.test.tsx`
- `src/components/WorkspaceCard.tsx`

**Step 2: Clean up Sidebar.tsx**

Remove the import:
```ts
import { ModeToggle } from "./ModeToggle";
```

Remove the `viewMode` store selector:
```ts
const viewMode = useDocumentStore((state) => state.viewMode);
```

Remove `<ModeToggle />` from the JSX (line 58).

Remove the `{viewMode === "activity" && (` guard on the `<nav>` block (line 61). The nav should always render — remove the conditional wrapper but keep the `<nav>` and its children intact.

**Step 3: Simplify App.tsx**

Remove unused imports:
```ts
import { WorkspaceGrid } from "./components/WorkspaceGrid";
```

Remove the `viewMode` store selector:
```ts
const viewMode = useDocumentStore((s) => s.viewMode);
```

Replace the current `<main>` branching logic. The old code branches on `viewMode === "activity"`, `activeWorkspace`, and a fallback with WorkspaceGrid. Replace with:

```tsx
<main className="glass-panel flex min-h-0 flex-1 flex-col items-stretch gap-4 p-4">
  <SearchBar
    activeFilterLabel={getSidebarFilterLabel(sidebarFilter)}
    onOpenFilters={() => setFilterSheetOpen(true)}
  />
  <DropZone />
  <ProcessingRail />
  <ActivityFeed />
</main>
{activeWorkspace && <WorkspaceNotebook />}
```

The `WorkspaceNotebook` renders as a sibling to `<main>`, outside of it, so it sits to the right in the flex container.

**Step 4: Run tests and build**

Run: `npm test && npm run build`
Expected: All pass. The deleted test files are gone, no imports reference deleted modules.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete ModeToggle, WorkspaceGrid, WorkspaceCard"
```

**Verification Gate:**
1. Automated: `npm test` — all pass
2. Manual: `grep -r "ModeToggle\|WorkspaceGrid\|WorkspaceCard\|viewMode" src/` — no results
3. Regression: `npm run build` — clean
4. Review: Diff is deletions + simplification of App.tsx and Sidebar.tsx

---

## Task 3: Add chat trigger to sidebar filter pills

**Chunk estimate:** ~20 min (Sonnet)

**Files:**
- Modify: `src/components/Sidebar.tsx` — add chat icon button per category pill
- Modify: `src/index.css` — add `.sidebar-pill__chat-trigger` styles

**Step 1: Identify which sidebar filters are chat-able**

The chat-eligible categories are those that match workspace categories: `receipt`, `contract`, `invoice`, `meeting_notes`, `audio`, `generic`. The `all`, `processing`, and `moved` filters are NOT chat-able (they're meta-filters, not document categories).

**Step 2: Add the chat trigger to Sidebar.tsx**

Import `setActiveWorkspace` from the store:
```ts
const setActiveWorkspace = useDocumentStore((state) => state.setActiveWorkspace);
const activeWorkspace = useDocumentStore((state) => state.activeWorkspace);
```

Define chat-eligible filter IDs:
```ts
const CHAT_ELIGIBLE: Set<string> = new Set(["receipt", "contract", "invoice", "meeting_notes", "audio", "generic"]);
```

Inside the `.map()` over `SIDEBAR_FILTER_ITEMS`, after the `<KineticNumber>` span and before the closing `</button>`, add a chat trigger for eligible categories:

```tsx
{SIDEBAR_FILTER_ITEMS.map((item) => {
  const active = sidebarFilter === item.id;
  const chatEligible = CHAT_ELIGIBLE.has(item.id);
  const chatActive = activeWorkspace === item.id;
  return (
    <div key={item.id} className="sidebar-pill-row">
      <button
        type="button"
        className={`sidebar-pill hover-lift flex flex-1 items-center justify-between text-left ${active ? "is-active" : ""}`}
        aria-label={`Filtrera: ${item.label}`}
        onClick={() => setSidebarFilter(item.id)}
      >
        <span className="font-medium">{item.label}</span>
        <KineticNumber value={counts[item.countKey] || 0} />
      </button>
      {chatEligible && (
        <button
          type="button"
          className={`sidebar-pill__chat-trigger ${chatActive ? "is-active" : ""}`}
          aria-label={`Chatta med ${item.label}`}
          onClick={() => setActiveWorkspace(chatActive ? null : item.id)}
        >
          ▸
        </button>
      )}
    </div>
  );
})}
```

Note: The outer element changes from `<button>` to `<div className="sidebar-pill-row">` containing the filter button and the chat trigger button. The chat trigger toggles: click once to open, click again to close.

**Step 3: Add CSS for the chat trigger and row layout**

Add to `src/index.css` after the existing `.sidebar-pill` rules:

```css
/* ── Sidebar pill row (filter + chat trigger) ── */
.sidebar-pill-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sidebar-pill__chat-trigger {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--badge-radius);
  font-size: 11px;
  color: var(--text-muted);
  transition: color var(--transition-fast), background var(--transition-fast);
  flex-shrink: 0;
}

.sidebar-pill__chat-trigger:hover {
  background: var(--glass-bg-hover);
  color: var(--accent-primary);
}

.sidebar-pill__chat-trigger.is-active {
  background: var(--accent-surface);
  color: var(--accent-primary);
}
```

**Step 4: Run tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/index.css
git commit -m "feat: add chat trigger to sidebar category pills"
```

**Verification Gate:**
1. Automated: `npm test` — all pass
2. Manual: `npm run tauri dev` — sidebar pills for receipt/contract/invoice/etc show a ▸ trigger on the right. Clicking it sets `activeWorkspace`. Meta-filters (Alla, Pågår, Flyttade) have no trigger.
3. Regression: `npm run build` — clean
4. Review: Sidebar layout still looks correct, pills aren't broken

---

## Task 4: Render WorkspaceNotebook as a right panel

**Chunk estimate:** ~25 min (Sonnet)

**Files:**
- Modify: `src/App.tsx` — render WorkspaceNotebook as a panel sibling to main
- Modify: `src/components/WorkspaceNotebook.tsx` — adapt to panel layout, add close button
- Modify: `src/index.css` — add `.workspace-panel` styles, remove `.workspace-card` and `.mode-toggle` CSS

**Step 1: Update App.tsx layout**

The current flex layout is: `Sidebar | main`. We need: `Sidebar | main | WorkspaceNotebook (when active)`.

The App.tsx inner flex container already has `gap-3`. The WorkspaceNotebook should render as a direct child of that flex container, after `<main>`:

```tsx
<div className="flex min-h-0 flex-1 w-full max-w-[1720px] gap-3 overflow-hidden p-3">
  <div className="hidden shrink-0 lg:block">
    <Sidebar />
  </div>
  <main className="glass-panel flex min-h-0 flex-1 flex-col items-stretch gap-4 p-4">
    <SearchBar
      activeFilterLabel={getSidebarFilterLabel(sidebarFilter)}
      onOpenFilters={() => setFilterSheetOpen(true)}
    />
    <DropZone />
    <ProcessingRail />
    <ActivityFeed />
  </main>
  {activeWorkspace && (
    <aside className="workspace-panel glass-panel hidden lg:flex">
      <WorkspaceNotebook />
    </aside>
  )}
</div>
```

The `hidden lg:flex` means the panel only appears on desktop widths (same breakpoint as the sidebar). The `glass-panel` class gives it the same visual treatment as main.

**Step 2: Adapt WorkspaceNotebook.tsx**

The notebook currently calls `setActiveWorkspace(null)` via its own back button. Keep that — it closes the panel.

Change the back button from `←` to `✕` (close icon) since it's now a panel dismiss, not a navigation back:

```tsx
<button
  className="action-secondary px-2.5 py-1 text-xs"
  onClick={() => setActiveWorkspace(null)}
  aria-label="Stäng workspace"
>
  ✕
</button>
```

The component keeps `fetchWorkspaceCategories` — it still needs category data. But wait: WorkspaceGrid was the one calling `fetchWorkspaceCategories`. Now that WorkspaceGrid is gone, we need `WorkspaceNotebook` to not depend on categories being pre-fetched. Looking at the component — it only reads `counts` for the document count display, and `activeWorkspace` for the category key. It doesn't actually use `workspaceCategories`. Good, no change needed there.

Remove the `ProcessingRail` import if WorkspaceGrid was the only other place it showed — check: it's not imported in either workspace component, so no change.

**Step 3: Add workspace panel CSS**

Add to `src/index.css`:

```css
/* ── Workspace Chat Panel ───────────────────────── */
.workspace-panel {
  width: 380px;
  flex-shrink: 0;
  flex-direction: column;
  padding: 16px;
  animation: panel-slide-in var(--transition-slide) ease;
}

@keyframes panel-slide-in {
  from {
    opacity: 0;
    transform: translateX(12px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

**Step 4: Remove dead CSS**

Delete the `.mode-toggle` rules (lines ~714-742):
```css
.mode-toggle { ... }
.mode-toggle__option { ... }
.mode-toggle__option:hover { ... }
.mode-toggle__option.is-active { ... }
```

Delete the `.workspace-card` rules (lines ~745-783):
```css
.workspace-card { ... }
.workspace-card:hover { ... }
.workspace-card__icon { ... }
.workspace-card__info { ... }
.workspace-card__accent { ... }
.workspace-card:hover .workspace-card__accent { ... }
```

**Step 5: Run tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/App.tsx src/components/WorkspaceNotebook.tsx src/index.css
git commit -m "feat: render workspace chat as right panel alongside activity feed"
```

**Verification Gate:**
1. Automated: `npm test && npm run build` — all pass
2. Manual: `npm run tauri dev` — click a chat trigger in the sidebar. The notebook panel slides in on the right. The activity feed remains visible on the left. Click ✕ to close the panel. Verify the glass styling matches.
3. Regression: Full suite passes, no layout breaks on resize
4. Review: No dead code from WorkspaceGrid/ModeToggle remains

---

## Task 5: Update WorkspaceNotebook test

**Chunk estimate:** ~10 min (Sonnet)

**Files:**
- Modify: `src/components/WorkspaceNotebook.test.tsx` — update test for panel context

**Step 1: Update the existing test**

The test already mocks `useWorkspaceChat` and sets `activeWorkspace: "receipt"`. It checks for the input placeholder and empty state text. These assertions are still valid — the component renders the same content, just in a different layout context.

Update the test to also verify the close button:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useWorkspaceChat", () => ({
  useWorkspaceChat: () => ({
    conversation: undefined,
    isStreaming: false,
    sendMessage: vi.fn(),
  }),
}));

import { WorkspaceNotebook } from "./WorkspaceNotebook";
import { useDocumentStore } from "../store/documentStore";

describe("WorkspaceNotebook", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      activeWorkspace: "receipt",
      counts: {
        all: 1,
        processing: 0,
        receipt: 1,
        contract: 0,
        invoice: 0,
        meeting_notes: 0,
        audio: 0,
        generic: 0,
        moved: 0,
      },
    });
  });

  it("renders the notebook input and empty state", () => {
    render(<WorkspaceNotebook />);

    expect(screen.getByPlaceholderText("Fråga dina kvitton...")).toBeInTheDocument();
    expect(screen.getByText("Fråga dina kvitton vad som helst")).toBeInTheDocument();
  });

  it("closes panel when close button is clicked", async () => {
    render(<WorkspaceNotebook />);

    await userEvent.click(screen.getByLabelText("Stäng workspace"));

    expect(useDocumentStore.getState().activeWorkspace).toBeNull();
  });
});
```

**Step 2: Run tests**

Run: `npm test -- src/components/WorkspaceNotebook.test.tsx`
Expected: 2 tests pass.

**Step 3: Commit**

```bash
git add src/components/WorkspaceNotebook.test.tsx
git commit -m "test: update WorkspaceNotebook test for panel close button"
```

**Verification Gate:**
1. Automated: `npm test` — all pass
2. Manual: N/A (test-only change)
3. Regression: Full suite passes
4. Review: Test covers close behavior

---

## Task 6: Final cleanup and full verification

**Chunk estimate:** ~10 min (Sonnet)

**Files:**
- Possibly: `src/index.css` — verify no orphaned CSS remains
- Possibly: `src/lib/api.ts` — `fetchWorkspaceCategories` is still used by the sidebar or notebook? If not, consider removing.

**Step 1: Check for dead code**

Run these greps:
```bash
grep -r "WorkspaceGrid\|WorkspaceCard\|ModeToggle\|viewMode\|ViewMode\|mode-toggle\|workspace-card" src/
```
Expected: No results.

Check if `fetchWorkspaceCategories` is still imported anywhere:
```bash
grep -r "fetchWorkspaceCategories" src/
```
If only in `src/lib/api.ts` (the definition) and nowhere else, delete the function and its import from api.ts. If still used, keep it.

Check if `workspaceCategories` and `setWorkspaceCategories` in the store are still used. If WorkspaceGrid was the only consumer, remove them from the store.

**Step 2: Run full verification**

```bash
npm test && npm run build
```

**Step 3: Commit any cleanup**

```bash
git add -A
git commit -m "chore: remove dead workspace grid code"
```

**Verification Gate:**
1. Automated: `npm test && npm run build` — all pass
2. Manual: `npm run tauri dev` — full walkthrough: sidebar filters work, chat triggers open/close panel, notebook sends messages, activity feed stays visible throughout
3. Regression: `PYTHONPATH=. pytest server/tests -q` — backend tests unaffected
4. Review: `git diff main --stat` shows clean removal with no orphaned code
