# AI Insights Feed — Design Spec

## Context

Brainfileing's backend discovers document relationships (duplicates, versions, entity-based connections) but currently buries them at the bottom of the document feed via `DiscoveryCards`. Users don't see the AI working for them. This feature promotes document relationships to a first-class view — an "Insights Feed" — making the AI's intelligence visible and giving users a reason to prefer this app over plain file management.

## Design Summary

Three connected changes:

1. **Sidebar "AI Insikter" section** in `WorkspaceSidebar` — shows discovery counts and latest insight preview
2. **Tab system** in workspace header — "Dokument | Insikter" tabs that switch the main content area
3. **Insights Feed view** — full-width feed with filter sidebar and typed insight cards

### Design Principles

- **Progressive disclosure**: Confidence % shown only on version/near-duplicate cards where uncertainty is meaningful. Exact duplicates and entity-based relations don't show confidence.
- **No emojis**: Use colored dots and text labels only. Never Unicode emoji characters.
- **One layout**: No separate online/offline states. Same layout regardless of connection status.

---

## 1. Sidebar AI Insikter Section

**Location**: `src/components/WorkspaceSidebar.tsx` — new section between the Collections list and the keyboard hints.

**Note**: The old `Sidebar.tsx` with `CHAT_CATEGORY_ITEMS` is dead code (not mounted in `App.tsx`). We are *adding* this section to `WorkspaceSidebar`, not replacing anything.

### Anatomy

```
┌─────────────────────────┐
│ AI INSIKTER             │  ← section-kicker label
├─────────────────────────┤
│ 12  upptäckter    Visa  │  ← summary card (clickable)
│ ● 5 relaterade         │
│ ● 4 versioner           │  ← breakdown row, colored dots
│ ● 3 duplikat            │
├─────────────────────────┤
│ [NY] Just nu            │  ← latest insight preview (optional)
│ 3 dokument delar:       │
│ Acme AB                 │
└─────────────────────────┘
```

### Behavior

- **Summary card** — accent-tinted background (`rgba(88,86,214,0.08)`), shows total count in large monospace + breakdown by type with colored dots. Clickable → sets `activeWorkspaceTab` to `"insights"`.
- **"Visa"** link — text affordance on the right. Same click handler as the card.
- **Breakdown dots** — `#5856d6` (related), `#ff375f` (version), `#34c759` (duplicate). Monospace counts.
- **Latest insight preview** — Compact card below the summary. Shows the most recent discovery's explanation, truncated. Fades in with `fade-in-up` animation when new. Only renders when `discoveryCards.length > 0`.
- **Count animation** — Use `count-hop` pattern (scale 1.1 bounce) when counts update.
- **Hidden when zero** — If no discoveries exist for the active workspace, the entire section is hidden (not shown with zeros).

---

## 2. Workspace Tab System

**Location**: `src/components/WorkspaceView.tsx` — new tab bar below the workspace header.

### Tab Bar

```
┌────────────┬──────────────────┐
│ Dokument   │ Insikter [12]    │  ← active tab has 2px bottom border
└────────────┴──────────────────┘
```

- Two tabs: "Dokument" (default) and "Insikter" with count badge.
- Active tab: `color: #5856d6`, `border-bottom: 2px solid #5856d6`, `font-weight: 600`.
- Inactive tab: `color: var(--text-muted)`, no border.
- Count badge on Insikter: small monospace pill `rgba(88,86,214,0.2)` background.
- Tab state lives in `workspaceStore.activeWorkspaceTab`. Resets to `"documents"` on workspace switch.
- No URL routing — purely Zustand state.

### Conditional Rendering

- `"documents"` tab → existing content (column headers, time-grouped document list, processing rail)
- `"insights"` tab → new `InsightsFeed` component
- Crossfade transition between tabs using `opacity` + `transition-smooth` (180ms).

### Keyboard

- Tab bar is focusable with arrow keys (left/right to switch).
- Escape from Insights tab returns to Documents tab.

---

## 3. Insights Feed View

**Location**: New component `src/components/InsightsFeed.tsx`.

### Layout

```
┌──────────┬──────────────────────────────────┐
│  [12]    │  [RELATERADE]  2 min sedan  Göm  │
│  Alla    │  3 dokument delar: Acme AB, ...   │
│          │  ┌──────┐ ┌──────┐ ┌──────┐      │
│  [5]     │  │● Doc1│ │● Doc2│ │● Doc3│      │
│ Relaterade│  └──────┘ └──────┘ └──────┘      │
│          ├───────────────────────────────────┤
│  [4]     │  [DUPLIKAT]           5 min  Göm  │
│ Versioner│  Exakt innehållsmatch (SHA256)     │
│          │  ┌──────┐  =  ┌──────┐            │
│  [3]     │  │● FileA│    │● FileB│           │
│ Duplikat │  └──────┘     └──────┘            │
└──────────┴───────────────────────────────────┘
```

### Filter Sidebar

- Width: 90px, flex-shrink: 0.
- Stacked count cards: Alla (all), Relaterade, Versioner, Duplikat.
- Active filter: accent background `rgba(88,86,214,0.12)` + accent border. Larger number, accent color.
- Inactive: `rgba(255,255,255,0.04)` background. Muted text.
- Click to filter the feed. `discoveryFilter` state in `documentStore`.
- Counts derived from `discoveryCards` array at render time (not separate state — avoids sync issues).

### Insight Card Types

All cards share: type badge, timestamp ("2 min sedan"), "Göm" dismiss button, explanation text, document pills.

**Related card** (`relation_type === "related"`):
- Badge: `RELATERADE`, purple (`rgba(88,86,214,0.15)` bg, `#5856d6` text).
- Border: neutral `rgba(255,255,255,0.08)`.
- Explanation: "3 dokument delar entiteter: **Acme AB**, **J. Svensson**" — entity names are bolded and tinted accent color.
- Document pills: horizontal flex-wrap, each pill has type-colored dot + title + one metadata field (type + date or amount).

**Duplicate card** (`relation_type === "duplicate"`):
- Badge: `DUPLIKAT`, green (`rgba(52,199,89,0.15)` bg, `#34c759` text).
- Border: subtle green `rgba(52,199,89,0.15)`.
- Explanation: "Exakt innehållsmatch (SHA256)" for exact dupes, or "{confidence}% likhet" for near-dupes.
- Document pills: two pills connected by `=` sign in green.

**Version card** (`relation_type === "version"`):
- Badge: `VERSION`, red (`rgba(255,55,95,0.15)` bg, `#ff375f` text).
- Confidence badge: `92%` in monospace next to the type badge.
- Border: subtle red `rgba(255,55,95,0.15)`.
- Explanation: "Uppdaterad version upptäckt — samma innehåll, nyare fil".
- Document pills: two pills connected by `→` arrow. Older version dimmed (`opacity: 0.6`), newer version highlighted.

### Document Pills

Clickable mini-cards within insight cards:
- Type-colored dot (5px) + title (10px) + metadata line (8px monospace, muted).
- Background: `rgba(255,255,255,0.04)`, border: `rgba(255,255,255,0.08)`.
- Hover: border brightens to `rgba(255,255,255,0.15)`.
- Click: opens the document in the InspectorPane (same as clicking a document row).
- Metadata line shows: document type + one extraction field (date, amount, or vendor).

### Dismiss

- "Göm" button: `color: var(--text-disabled)`, hover brightens.
- Calls existing `POST /workspaces/{id}/discovery/{relation}/dismiss` endpoint.
- Card fades out with `opacity` transition (180ms) then removes from DOM.
- Updates `discoveryCards` in store, recalculates counts.

### Empty State

When `discoveryCards.length === 0` (after filtering):

- Centered vertically in the feed area.
- AiPresence ring motif (simplified — outer dashed ring + inner solid circle, matching existing `AiPresence.tsx` style).
- Title: "AI:n letar efter kopplingar" (13px, `--text-secondary`).
- Description: "Insikter dyker upp här när AI:n hittar relaterade dokument, versioner eller dubbletter i din workspace." (11px, `--text-muted`, max-width 280px).

---

## 4. Data Flow

### Current (to be replaced)

```
GET /workspaces/{id}/discovery
  → DiscoveryCards component (local useState)
  → Also fetched independently by InspectorPane.RelatedFilesSection
```

### Proposed

```
GET /workspaces/{id}/discovery
  → documentStore.fetchDiscovery(workspaceId)
  → documentStore.discoveryCards[]
  → documentStore.discoveryCounts { related, version, duplicate }
  ↓
  → WorkspaceSidebar reads discoveryCounts for badges
  → InsightsFeed reads discoveryCards + discoveryFilter for rendering
  → InspectorPane.RelatedFilesSection reads from store (no own fetch)
```

### Fetch Timing

- Triggered on workspace switch (alongside document loading in `App.tsx` useEffect).
- Stale-while-revalidate: show cached data immediately, refresh in background.
- Also re-fetched when a `job.completed` WebSocket event arrives (new document may create new relations).

---

## 5. State Changes

### workspaceStore.ts — additions

```ts
activeWorkspaceTab: "documents" | "insights"  // default: "documents"
setActiveWorkspaceTab: (tab) => void
// Reset to "documents" inside setActiveWorkspace()
```

### documentStore.ts — additions

```ts
discoveryCards: DiscoveryCard[]           // default: []
discoveryLoading: boolean                 // default: false
discoveryError: string | null             // default: null
discoveryFilter: DiscoveryFilterType      // default: "all"

fetchDiscovery(workspaceId: string): Promise<void>
dismissDiscoveryCard(workspaceId: string, cardId: string): Promise<void>
setDiscoveryFilter(filter: DiscoveryFilterType): void
```

### types/documents.ts — addition

```ts
export type DiscoveryFilterType = "all" | "related" | "version" | "duplicate";
```

---

## 6. Backend Changes (Optional Enhancement)

The current `DiscoveryCard` schema returns entity names embedded in the `explanation` string. To show entity chips properly, add a structured `metadata` field:

### schemas.py — extend DiscoveryCard

```python
class DiscoveryCard(BaseModel):
    # ... existing fields ...
    metadata: dict | None = None
    # For "related": {"shared_entities": ["Acme AB", "J. Svensson"]}
    # For "duplicate": {"is_exact_hash": true}
    # For "version": {"similarity_pct": 92}
```

### schemas.py — extend DiscoveryFileRef

```python
class DiscoveryFileRef(BaseModel):
    id: str
    title: str
    source_path: str | None = None
    kind: str | None = None  # NEW: document type for color-coding pills
```

### discovery.py — populate new fields

In `_build_relations()`, add `metadata` dict alongside `explanation`. In the query that builds `DiscoveryFileRef`, join `document_type`/`kind` from the documents table.

**If skipped**: Entity names can be parsed from the `explanation` string with a regex, and document kind can be looked up from the documentStore by file ID. Less clean but functional.

---

## 7. Files to Create

| File | Purpose |
|------|---------|
| `src/components/InsightsFeed.tsx` | Main insights view with filter sidebar + card feed + empty state |
| `src/components/InsightCard.tsx` | Individual card component (three variants: related, duplicate, version) |
| `src/components/WorkspaceTabBar.tsx` | Tab bar component for Documents/Insights switching |

## 8. Files to Modify

| File | Change |
|------|--------|
| `src/components/WorkspaceView.tsx` | Add tab bar, conditional render between documents and InsightsFeed |
| `src/components/WorkspaceSidebar.tsx` | Add AI Insikter section with counts and latest preview |
| `src/store/documentStore.ts` | Add discovery state, actions, and derived counts |
| `src/store/workspaceStore.ts` | Add `activeWorkspaceTab` state + reset on workspace switch |
| `src/types/documents.ts` | Add `DiscoveryFilterType` |
| `src/components/InspectorPane.tsx` | Update `RelatedFilesSection` to read from store |
| `src/index.css` | Add tab bar, insights feed, insight card, filter sidebar styles |
| `src/components/DiscoveryCards.tsx` | Deprecate (remove from WorkspaceView) |
| `server/schemas.py` | (Optional) Extend DiscoveryCard with metadata, DiscoveryFileRef with kind |
| `server/pipelines/discovery.py` | (Optional) Populate metadata and kind fields |

## 9. Verification Plan

1. **Unit tests**: New tests for InsightCard (renders each variant), InsightsFeed (filter behavior, empty state), WorkspaceTabBar (tab switching). Update WorkspaceView.test.tsx for tab rendering.
2. **Store tests**: Test fetchDiscovery populates cards and counts, dismissDiscoveryCard removes card, setDiscoveryFilter filters correctly.
3. **Integration test**: Start backend with test fixtures → process 3+ documents that share entities → verify discovery endpoint returns cards → verify UI shows counts in sidebar and cards in feed.
4. **Manual verification**: 
   - Drop 3 files that mention the same company → see "Relaterade" card appear
   - Drop the same file twice → see "Duplikat" card
   - Drop a modified version of a file → see "Version" card
   - Click filter buttons → feed filters correctly
   - Click document pills → inspector opens
   - Click "Göm" → card dismisses
   - Switch workspace → tab resets to "Dokument", counts update
5. **Build check**: `npm run build` passes, `npm test` passes, `cargo check` passes.
