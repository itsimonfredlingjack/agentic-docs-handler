# Activity Feed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the static document grid with a chronological activity feed that shows live pipeline progression per document, so users can watch their documents being processed in real-time without clicking anything.

**Architecture:** Refactor `FileGrid` into `ActivityFeed` — a time-grouped chronological list where each document card includes an inline pipeline stepper. The Zustand store gains a `stageHistory` map tracking timestamped stage transitions per document. No backend changes — all data comes from existing WebSocket `job.progress` events and the `status` field on `UiDocument`. Sidebar filters and search continue to work by filtering the feed.

**Tech Stack:** React 19, Zustand, Tailwind CSS, existing CSS variable design system, pure CSS animations (no Framer Motion)

**Decomposition Strategy:** Complexity-based (simple → better → polished)

**Target Model:** Sonnet 30min chunks

---

## Current State (what exists)

- `FileGrid.tsx` (379 lines): Static responsive grid, renders document cards by kind/status
- `documentStore.ts` (385 lines): Zustand store with `documents`, `documentOrder`, `markJobStage(requestId, stage)`
- `useWebSocket.ts` (129 lines): Routes `job.progress` → `markJobStage`, `job.completed` → `upsertDocument`
- `index.css` (499 lines): Design tokens, glass panels, animations (`aurora-pulse`, `fade-in-up`, etc.)
- Templates: `ReceiptCard`, `ContractCard`, `AudioTranscript`, `GenericDocument`, `FileMovedCard` — all take `{ document: UiDocument }`
- Job stages enum: `"uploading" | "processing" | "transcribing" | "classifying" | "extracting" | "organizing" | "indexing" | "awaiting_confirmation" | "moved" | "completed" | "failed"`

## Target State

1. **Feed-first layout**: Documents ordered newest-first with time group headers ("Just nu", "2 min sedan", "Idag", "Igår")
2. **Inline pipeline stepper**: Each in-progress card shows `Upload → Classify → Extract → Organize → Index → ✓` with live stage highlighting
3. **Completed cards**: Collapse to compact summary showing document type, key extracted field, destination path, total time
4. **Same filters + search**: Sidebar filters and search bar filter the feed identically to today

---

## Task 1: Add Stage History to Zustand Store

**Chunk estimate:** ~20 min (Sonnet)

**Files:**
- Modify: `src/store/documentStore.ts`
- Create: `src/store/documentStore.test.ts`

**Context:** Currently `markJobStage` only sets the *current* status on a document. We need a history of stage transitions with timestamps so the feed can show what happened and when.

**Step 1: Write the failing test**

Create `src/store/documentStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "./documentStore";

describe("stageHistory", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      documents: {},
      documentOrder: [],
      stageHistory: {},
    });
  });

  it("records timestamp when a job stage is marked", () => {
    const store = useDocumentStore.getState();
    // Seed a document
    store.upsertDocument({
      id: "doc-1",
      requestId: "req-1",
      title: "test.pdf",
      status: "uploading",
    } as any);

    store.markJobStage("req-1", "classifying");

    const history = useDocumentStore.getState().stageHistory["req-1"];
    expect(history).toBeDefined();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].stage).toBe("classifying");
    expect(typeof history[0].at).toBe("number"); // Date.now()
  });

  it("appends stages in order", () => {
    const store = useDocumentStore.getState();
    store.upsertDocument({
      id: "doc-1",
      requestId: "req-1",
      title: "test.pdf",
      status: "uploading",
    } as any);

    store.markJobStage("req-1", "classifying");
    store.markJobStage("req-1", "extracting");
    store.markJobStage("req-1", "organizing");

    const history = useDocumentStore.getState().stageHistory["req-1"];
    expect(history.map((h: any) => h.stage)).toEqual([
      "classifying",
      "extracting",
      "organizing",
    ]);
  });

  it("records initial stage on queueUploads", () => {
    const store = useDocumentStore.getState();
    store.queueUploads([
      {
        id: "doc-1",
        requestId: "req-1",
        title: "test.pdf",
        status: "uploading",
      } as any,
    ]);

    const history = useDocumentStore.getState().stageHistory["req-1"];
    expect(history).toBeDefined();
    expect(history[0].stage).toBe("uploading");
  });

  it("computes totalDuration from first to last stage", () => {
    const store = useDocumentStore.getState();
    store.upsertDocument({
      id: "doc-1",
      requestId: "req-1",
      title: "test.pdf",
      status: "uploading",
    } as any);

    // Manually set history with known timestamps
    useDocumentStore.setState({
      stageHistory: {
        "req-1": [
          { stage: "uploading", at: 1000 },
          { stage: "classifying", at: 3000 },
          { stage: "completed", at: 8000 },
        ],
      },
    });

    const history = useDocumentStore.getState().stageHistory["req-1"];
    const totalMs = history[history.length - 1].at - history[0].at;
    expect(totalMs).toBe(7000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/coffeedev/Projects/02_AUTOMATION-PIPELINES/agentic-docs-handler && npx vitest run src/store/documentStore.test.ts`
Expected: FAIL — `stageHistory` not defined on store

**Step 3: Implement stageHistory in the store**

Modify `src/store/documentStore.ts`:

1. Add type near top of file:
```typescript
export type StageEntry = { stage: string; at: number };
```

2. Add to store state interface:
```typescript
stageHistory: Record<string, StageEntry[]>;
```

3. Initialize in store creation:
```typescript
stageHistory: {},
```

4. In `markJobStage`, after the existing status update logic, append to history:
```typescript
const prev = get().stageHistory[requestId] ?? [];
set({
  stageHistory: {
    ...get().stageHistory,
    [requestId]: [...prev, { stage, at: Date.now() }],
  },
});
```

5. In `queueUploads`, after creating the local document, seed the initial stage:
```typescript
// Inside the loop that creates local documents:
newHistory[doc.requestId] = [{ stage: "uploading", at: Date.now() }];
// Then merge into stageHistory at the end of the function
```

6. In `upsertDocument`, when a completed document arrives and has no history yet, seed a single "completed" entry so the feed can display it.

**Step 4: Run test to verify it passes**

Run: `cd /Users/coffeedev/Projects/02_AUTOMATION-PIPELINES/agentic-docs-handler && npx vitest run src/store/documentStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/store/documentStore.ts src/store/documentStore.test.ts
git commit -m "feat(store): add stageHistory tracking for pipeline stage transitions"
```

**Verification Gate:**
1. Automated: `npx vitest run src/store/documentStore.test.ts` — all pass
2. Manual: In browser console, drop a file → inspect store → `stageHistory` has entries with timestamps
3. Regression: `npm test` — no existing tests broken
4. Review: Diff only touches store, adds history tracking alongside existing `markJobStage`

---

## Task 2: Create PipelineStepper Component

**Chunk estimate:** ~25 min (Sonnet)

**Files:**
- Create: `src/components/PipelineStepper.tsx`
- Create: `src/components/PipelineStepper.test.tsx`
- Modify: `src/index.css` (add stepper styles)

**Context:** A horizontal inline stepper that shows pipeline stages. Active stage pulses, completed stages have checkmarks, future stages are dimmed. Displays elapsed time when complete.

**Step 1: Write the failing test**

Create `src/components/PipelineStepper.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineStepper } from "./PipelineStepper";

describe("PipelineStepper", () => {
  const STAGES = ["uploading", "classifying", "extracting", "organizing", "indexing", "completed"];

  it("renders all stage labels", () => {
    render(<PipelineStepper currentStage="uploading" history={[]} />);
    expect(screen.getByText("Ladda upp")).toBeInTheDocument();
    expect(screen.getByText("Klassificera")).toBeInTheDocument();
    expect(screen.getByText("Extrahera")).toBeInTheDocument();
    expect(screen.getByText("Organisera")).toBeInTheDocument();
    expect(screen.getByText("Indexera")).toBeInTheDocument();
  });

  it("marks completed stages with checkmark", () => {
    render(
      <PipelineStepper
        currentStage="extracting"
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "classifying", at: 2000 },
          { stage: "extracting", at: 3000 },
        ]}
      />,
    );
    const steps = screen.getAllByTestId("pipeline-step");
    // uploading and classifying should be completed
    expect(steps[0]).toHaveAttribute("data-state", "completed");
    expect(steps[1]).toHaveAttribute("data-state", "completed");
    expect(steps[2]).toHaveAttribute("data-state", "active");
    expect(steps[3]).toHaveAttribute("data-state", "pending");
  });

  it("shows failed state on the active stage", () => {
    render(
      <PipelineStepper
        currentStage="classifying"
        failed={true}
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "classifying", at: 2000 },
        ]}
      />,
    );
    const steps = screen.getAllByTestId("pipeline-step");
    expect(steps[1]).toHaveAttribute("data-state", "failed");
  });

  it("shows total duration when completed", () => {
    render(
      <PipelineStepper
        currentStage="completed"
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "completed", at: 13500 },
        ]}
      />,
    );
    expect(screen.getByText("12.5s")).toBeInTheDocument();
  });

  it("shows nothing when document has no active pipeline", () => {
    const { container } = render(
      <PipelineStepper currentStage="ready" history={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PipelineStepper.test.tsx`
Expected: FAIL — module not found

**Step 3: Implement PipelineStepper**

Create `src/components/PipelineStepper.tsx`:

```tsx
import type { StageEntry } from "../store/documentStore";

const PIPELINE_STAGES = [
  { key: "uploading", label: "Ladda upp" },
  { key: "classifying", label: "Klassificera" },
  { key: "extracting", label: "Extrahera" },
  { key: "organizing", label: "Organisera" },
  { key: "indexing", label: "Indexera" },
] as const;

// Stages that don't map to pipeline steps but indicate processing
const ACTIVE_STAGE_MAP: Record<string, string> = {
  processing: "classifying",
  transcribing: "classifying",
  classified: "extracting",
  awaiting_confirmation: "organizing",
  moved: "completed",
};

type Props = {
  currentStage: string;
  history: StageEntry[];
  failed?: boolean;
};

function resolveStage(raw: string): string {
  return ACTIVE_STAGE_MAP[raw] ?? raw;
}

function stageIndex(stage: string): number {
  const resolved = resolveStage(stage);
  const idx = PIPELINE_STAGES.findIndex((s) => s.key === resolved);
  return idx === -1 ? PIPELINE_STAGES.length : idx;
}

export function PipelineStepper({ currentStage, history, failed }: Props) {
  const resolved = resolveStage(currentStage);

  // Don't render for non-pipeline states
  const isPipelineActive =
    resolved === "completed" ||
    resolved === "failed" ||
    PIPELINE_STAGES.some((s) => s.key === resolved);
  if (!isPipelineActive && currentStage === "ready") return null;

  const activeIdx = stageIndex(currentStage);
  const isCompleted = resolved === "completed" || resolved === "moved";

  // Calculate total duration
  let durationLabel: string | null = null;
  if (isCompleted && history.length >= 2) {
    const ms = history[history.length - 1].at - history[0].at;
    durationLabel = ms >= 60_000
      ? `${(ms / 60_000).toFixed(1)}m`
      : `${(ms / 1000).toFixed(1)}s`;
  }

  return (
    <div className="pipeline-stepper" role="group" aria-label="Pipeline progress">
      <div className="pipeline-stepper__track">
        {PIPELINE_STAGES.map((stage, i) => {
          let state: "completed" | "active" | "failed" | "pending";
          if (isCompleted || i < activeIdx) {
            state = "completed";
          } else if (i === activeIdx) {
            state = failed ? "failed" : "active";
          } else {
            state = "pending";
          }

          return (
            <div
              key={stage.key}
              className="pipeline-stepper__step"
              data-testid="pipeline-step"
              data-state={state}
            >
              <div className="pipeline-stepper__dot" />
              {i < PIPELINE_STAGES.length - 1 && (
                <div className="pipeline-stepper__connector" />
              )}
              <span className="pipeline-stepper__label">{stage.label}</span>
            </div>
          );
        })}
      </div>
      {durationLabel && (
        <span className="pipeline-stepper__duration">{durationLabel}</span>
      )}
    </div>
  );
}
```

**Step 4: Add CSS styles**

Append to `src/index.css` (before the final closing comments):

```css
/* ── Pipeline Stepper ─────────────────────────────── */
.pipeline-stepper {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0 4px;
}

.pipeline-stepper__track {
  display: flex;
  align-items: flex-start;
  gap: 0;
  flex: 1;
}

.pipeline-stepper__step {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  flex: 1;
  min-width: 0;
}

.pipeline-stepper__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border-subtle, #e2e5ea);
  transition: background var(--transition-normal), box-shadow var(--transition-normal);
  z-index: 1;
}

.pipeline-stepper__connector {
  position: absolute;
  top: 5px;
  left: calc(50% + 5px);
  right: calc(-50% + 5px);
  height: 2px;
  background: var(--border-subtle, #e2e5ea);
  transition: background var(--transition-normal);
}

.pipeline-stepper__label {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  margin-top: 4px;
  white-space: nowrap;
  transition: color var(--transition-normal);
}

.pipeline-stepper__duration {
  font-size: 11px;
  font-family: var(--font-mono, "SF Mono", monospace);
  color: var(--text-muted);
  white-space: nowrap;
}

/* States */
.pipeline-stepper__step[data-state="completed"] .pipeline-stepper__dot {
  background: var(--accent-primary);
}
.pipeline-stepper__step[data-state="completed"] .pipeline-stepper__connector {
  background: var(--accent-primary);
}
.pipeline-stepper__step[data-state="completed"] .pipeline-stepper__label {
  color: var(--text-secondary);
}

.pipeline-stepper__step[data-state="active"] .pipeline-stepper__dot {
  background: var(--accent-primary);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-primary) 20%, transparent);
  animation: stepper-pulse 1.5s ease-in-out infinite;
}
.pipeline-stepper__step[data-state="active"] .pipeline-stepper__label {
  color: var(--accent-primary);
  font-weight: 600;
}

.pipeline-stepper__step[data-state="failed"] .pipeline-stepper__dot {
  background: var(--invoice-color, #ff375f);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--invoice-color, #ff375f) 20%, transparent);
}
.pipeline-stepper__step[data-state="failed"] .pipeline-stepper__label {
  color: var(--invoice-color, #ff375f);
}

@keyframes stepper-pulse {
  0%, 100% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-primary) 20%, transparent); }
  50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--accent-primary) 8%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  .pipeline-stepper__step[data-state="active"] .pipeline-stepper__dot {
    animation: none;
  }
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/PipelineStepper.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/PipelineStepper.tsx src/components/PipelineStepper.test.tsx src/index.css
git commit -m "feat(ui): add PipelineStepper component with live stage progression"
```

**Verification Gate:**
1. Automated: `npx vitest run src/components/PipelineStepper.test.tsx` — all pass
2. Manual: Import and render `<PipelineStepper currentStage="extracting" history={[...]} />` in isolation — dots and labels visible, active stage pulses
3. Regression: `npm test` — no existing tests broken
4. Review: New component + CSS only, no existing files modified beyond CSS append

---

## Task 3: Create TimeGroupHeader and Feed Utility

**Chunk estimate:** ~15 min (Sonnet)

**Files:**
- Create: `src/components/TimeGroupHeader.tsx`
- Create: `src/lib/feed-utils.ts`
- Create: `src/lib/feed-utils.test.ts`

**Context:** The feed groups documents by relative time. We need a utility to assign time groups and a small header component.

**Step 1: Write the failing test**

Create `src/lib/feed-utils.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { getTimeGroup } from "./feed-utils";

describe("getTimeGroup", () => {
  it("returns 'Just nu' for documents less than 60 seconds old", () => {
    const now = Date.now();
    expect(getTimeGroup(new Date(now - 30_000).toISOString(), now)).toBe("Just nu");
  });

  it("returns relative minutes for documents 1-59 minutes old", () => {
    const now = Date.now();
    expect(getTimeGroup(new Date(now - 120_000).toISOString(), now)).toBe("2 min sedan");
    expect(getTimeGroup(new Date(now - 600_000).toISOString(), now)).toBe("10 min sedan");
  });

  it("returns relative hours for documents 1-23 hours old", () => {
    const now = Date.now();
    expect(getTimeGroup(new Date(now - 3_600_000).toISOString(), now)).toBe("1 timme sedan");
    expect(getTimeGroup(new Date(now - 7_200_000).toISOString(), now)).toBe("2 timmar sedan");
  });

  it("returns 'Igår' for yesterday", () => {
    const now = Date.now();
    expect(getTimeGroup(new Date(now - 86_400_000 - 3600_000).toISOString(), now)).toBe("Igår");
  });

  it("returns date string for older documents", () => {
    const now = Date.now();
    const old = new Date(now - 5 * 86_400_000).toISOString();
    const result = getTimeGroup(old, now);
    // Should be a formatted date like "7 mar" or "2026-03-07"
    expect(result).not.toBe("Igår");
    expect(result.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test — expect FAIL**

Run: `npx vitest run src/lib/feed-utils.test.ts`

**Step 3: Implement**

Create `src/lib/feed-utils.ts`:

```typescript
export function getTimeGroup(isoDate: string, now: number = Date.now()): string {
  const diff = now - new Date(isoDate).getTime();
  const seconds = diff / 1000;
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;

  if (seconds < 60) return "Just nu";
  if (minutes < 60) return `${Math.floor(minutes)} min sedan`;
  if (hours < 2) return "1 timme sedan";
  if (hours < 24) return `${Math.floor(hours)} timmar sedan`;
  if (days < 2) return "Igår";

  // Format as "7 mar" style
  const date = new Date(isoDate);
  const monthNames = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  return `${date.getDate()} ${monthNames[date.getMonth()]}`;
}

/**
 * Groups an ordered array of items by time group label.
 * Items must already be sorted newest-first.
 */
export function groupByTime<T>(
  items: T[],
  getDate: (item: T) => string,
  now?: number,
): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  let currentLabel = "";

  for (const item of items) {
    const label = getTimeGroup(getDate(item), now);
    if (label !== currentLabel) {
      groups.push({ label, items: [] });
      currentLabel = label;
    }
    groups[groups.length - 1].items.push(item);
  }

  return groups;
}
```

Create `src/components/TimeGroupHeader.tsx`:

```tsx
type Props = { label: string };

export function TimeGroupHeader({ label }: Props) {
  return (
    <div className="time-group-header" role="separator">
      <span className="time-group-header__line" />
      <span className="time-group-header__label">{label}</span>
      <span className="time-group-header__line" />
    </div>
  );
}
```

Add to `src/index.css`:

```css
/* ── Time Group Header ────────────────────────────── */
.time-group-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  grid-column: 1 / -1;
}

.time-group-header__line {
  flex: 1;
  height: 1px;
  background: var(--border-subtle, #e2e5ea);
}

.time-group-header__label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  white-space: nowrap;
}
```

**Step 4: Run tests — expect PASS**

Run: `npx vitest run src/lib/feed-utils.test.ts`

**Step 5: Commit**

```bash
git add src/lib/feed-utils.ts src/lib/feed-utils.test.ts src/components/TimeGroupHeader.tsx src/index.css
git commit -m "feat(ui): add time grouping utilities and TimeGroupHeader component"
```

**Verification Gate:**
1. Automated: `npx vitest run src/lib/feed-utils.test.ts` — all pass
2. Manual: N/A (utility + static component, will be visible in Task 4)
3. Regression: `npm test` — no existing tests broken
4. Review: Pure additions, no existing files modified beyond CSS append

---

## Task 4: Create FeedCard Wrapper

**Chunk estimate:** ~25 min (Sonnet)

**Files:**
- Create: `src/components/FeedCard.tsx`
- Create: `src/components/FeedCard.test.tsx`

**Context:** A wrapper component that renders the PipelineStepper above the appropriate template card. For in-progress documents, the stepper dominates. For completed documents, it shows a compact summary line (type + key field + destination + duration). This replaces the per-status branching logic currently in `FileGrid`.

**Step 1: Write the failing test**

Create `src/components/FeedCard.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeedCard } from "./FeedCard";
import type { UiDocument } from "../store/documentStore";

const baseDoc: UiDocument = {
  id: "doc-1",
  requestId: "req-1",
  title: "faktura-mars.pdf",
  summary: "Faktura från Telia",
  mimeType: "application/pdf",
  sourceModality: "text",
  kind: "invoice",
  documentType: "invoice",
  template: "invoice",
  sourcePath: "/tmp/faktura-mars.pdf",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  classification: {
    document_type: "invoice",
    template: "invoice",
    title: "Faktura mars",
    summary: "Faktura från Telia",
    tags: [],
    language: "sv",
    confidence: 0.92,
    ocr_text: null,
    suggested_actions: [],
  },
  extraction: { fields: { vendor: "Telia", amount: "1 250 kr" }, field_confidence: {}, missing_fields: [] },
  transcription: null,
  movePlan: null,
  moveResult: null,
  status: "completed",
  tags: [],
  undoToken: null,
  retryable: false,
  errorCode: null,
  warnings: [],
  moveStatus: "not_requested",
  diagnostics: null,
} as any;

describe("FeedCard", () => {
  it("shows pipeline stepper when document is processing", () => {
    render(
      <FeedCard
        document={{ ...baseDoc, status: "classifying" }}
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "classifying", at: 2000 },
        ]}
      />,
    );
    expect(screen.getByRole("group", { name: /pipeline/i })).toBeInTheDocument();
  });

  it("renders template card for completed document", () => {
    render(
      <FeedCard
        document={baseDoc}
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "completed", at: 5000 },
        ]}
      />,
    );
    // Should render the ReceiptCard/invoice variant with vendor info
    expect(screen.getByText(/Telia/)).toBeInTheDocument();
  });

  it("shows compact summary line for completed documents", () => {
    render(
      <FeedCard
        document={{
          ...baseDoc,
          moveResult: { attempted: true, success: true, from_path: "/a", to_path: "/dst/faktura.pdf", error: null },
          moveStatus: "moved",
        }}
        history={[
          { stage: "uploading", at: 1000 },
          { stage: "completed", at: 13500 },
        ]}
      />,
    );
    expect(screen.getByText(/\/dst\/faktura\.pdf/)).toBeInTheDocument();
    expect(screen.getByText("12.5s")).toBeInTheDocument();
  });

  it("shows failure state with retry button", () => {
    render(
      <FeedCard
        document={{ ...baseDoc, status: "failed", retryable: true, errorCode: "llm_timeout" }}
        history={[{ stage: "uploading", at: 1000 }, { stage: "classifying", at: 2000 }]}
      />,
    );
    expect(screen.getByText(/Försök igen/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run test — expect FAIL**

Run: `npx vitest run src/components/FeedCard.test.tsx`

**Step 3: Implement FeedCard**

Create `src/components/FeedCard.tsx`:

```tsx
import { PipelineStepper } from "./PipelineStepper";
import { ReceiptCard } from "../templates/ReceiptCard";
import { ContractCard } from "../templates/ContractCard";
import { AudioTranscript } from "../templates/AudioTranscript";
import { GenericDocument } from "../templates/GenericDocument";
import { FileMovedCard } from "../templates/FileMovedCard";
import type { StageEntry } from "../store/documentStore";
import type { UiDocument } from "../store/documentStore";

type Props = {
  document: UiDocument;
  history: StageEntry[];
  onSelect?: () => void;
  onRetry?: () => void;
};

const TERMINAL_STAGES = new Set(["completed", "ready", "moved", "failed"]);
const PROCESSING_STAGES = new Set([
  "uploading", "processing", "transcribing", "classifying",
  "classified", "extracting", "organizing", "indexing",
]);

function CompactSummary({ document, history }: { document: UiDocument; history: StageEntry[] }) {
  const dest = document.moveResult?.to_path;
  let durationLabel: string | null = null;
  if (history.length >= 2) {
    const ms = history[history.length - 1].at - history[0].at;
    durationLabel = ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
  }

  return (
    <div className="feed-card__summary">
      {dest && (
        <span className="feed-card__destination" title={dest}>
          → {dest.split("/").slice(-3).join("/")}
        </span>
      )}
      {durationLabel && (
        <span className="pipeline-stepper__duration">{durationLabel}</span>
      )}
    </div>
  );
}

function TemplateCard({ document }: { document: UiDocument }) {
  switch (document.kind) {
    case "receipt":
      return <ReceiptCard document={document} variant="receipt" />;
    case "invoice":
      return <ReceiptCard document={document} variant="invoice" />;
    case "contract":
      return <ContractCard document={document} />;
    case "audio":
    case "meeting_notes":
      return <AudioTranscript document={document} />;
    default:
      if (document.moveStatus === "moved" && document.moveResult?.success) {
        return <FileMovedCard document={document} />;
      }
      return <GenericDocument document={document} />;
  }
}

export function FeedCard({ document, history, onSelect, onRetry }: Props) {
  const isProcessing = PROCESSING_STAGES.has(document.status);
  const isFailed = document.status === "failed";
  const isTerminal = TERMINAL_STAGES.has(document.status);
  const showStepper = isProcessing || isFailed;

  return (
    <div
      className={`feed-card ${isProcessing ? "feed-card--processing" : ""} ${isFailed ? "feed-card--failed" : ""}`}
      onClick={isTerminal ? onSelect : undefined}
      role={isTerminal ? "button" : undefined}
      tabIndex={isTerminal ? 0 : undefined}
    >
      {/* Title bar */}
      <div className="feed-card__header">
        <span className="feed-card__title">{document.title}</span>
        {isTerminal && document.kind !== "generic" && (
          <span
            className="glass-badge"
            style={{
              background: `color-mix(in srgb, var(--${document.kind === "invoice" ? "invoice" : document.kind}-color, var(--text-muted)) 12%, transparent)`,
            }}
          >
            {document.documentType}
          </span>
        )}
      </div>

      {/* Pipeline stepper for active processing */}
      {(showStepper || isTerminal) && (
        <PipelineStepper
          currentStage={document.status}
          history={history}
          failed={isFailed}
        />
      )}

      {/* Template card content for completed documents */}
      {isTerminal && !isFailed && <TemplateCard document={document} />}

      {/* Compact summary for completed + moved documents */}
      {isTerminal && !isFailed && (document.moveResult?.to_path || history.length >= 2) && (
        <CompactSummary document={document} history={history} />
      )}

      {/* Failure state */}
      {isFailed && (
        <div className="feed-card__error">
          <p className="feed-card__error-msg">
            {document.errorCode ?? "Behandlingen misslyckades"}
          </p>
          {document.retryable && onRetry && (
            <button className="action-secondary" onClick={(e) => { e.stopPropagation(); onRetry(); }}>
              Försök igen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

Add to `src/index.css`:

```css
/* ── Feed Card ────────────────────────────────────── */
.feed-card {
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border, rgba(255,255,255,0.18));
  border-radius: var(--card-radius);
  padding: 16px;
  transition: box-shadow var(--transition-normal), transform var(--transition-normal);
  cursor: default;
}

.feed-card[role="button"] {
  cursor: pointer;
}

.feed-card[role="button"]:hover {
  box-shadow: var(--glass-shadow-hover);
  transform: translateY(-2px);
}

.feed-card--processing {
  animation: aurora-pulse 3s ease-in-out infinite;
}

.feed-card--failed {
  border-color: color-mix(in srgb, var(--invoice-color, #ff375f) 30%, transparent);
}

.feed-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.feed-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.feed-card__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle, #e2e5ea);
}

.feed-card__destination {
  font-size: 11px;
  font-family: var(--font-mono, "SF Mono", monospace);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.feed-card__error {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.feed-card__error-msg {
  font-size: 12px;
  color: var(--invoice-color, #ff375f);
}
```

**Step 4: Run test — expect PASS**

Run: `npx vitest run src/components/FeedCard.test.tsx`

**Step 5: Commit**

```bash
git add src/components/FeedCard.tsx src/components/FeedCard.test.tsx src/index.css
git commit -m "feat(ui): add FeedCard wrapper with stepper + template rendering"
```

**Verification Gate:**
1. Automated: `npx vitest run src/components/FeedCard.test.tsx` — all pass
2. Manual: N/A (will be integrated in Task 5)
3. Regression: `npm test` — no existing tests broken
4. Review: New component only, CSS appended

---

## Task 5: Replace FileGrid with ActivityFeed

**Chunk estimate:** ~30 min (Sonnet)

**Files:**
- Create: `src/components/ActivityFeed.tsx`
- Modify: `src/App.tsx` — swap `FileGrid` import to `ActivityFeed`
- Modify: `src/components/DropZone.tsx` — remove the activity log section (it's now redundant with the feed)

**Context:** This is the main integration task. `ActivityFeed` replaces `FileGrid` and uses `FeedCard` + `TimeGroupHeader` + `groupByTime`. It reads `documents`, `documentOrder`, `stageHistory`, `sidebarFilter`, and `search` from the store — the same data `FileGrid` used plus `stageHistory`.

**Step 1: Implement ActivityFeed**

Create `src/components/ActivityFeed.tsx`:

```tsx
import { useMemo } from "react";
import { useDocumentStore } from "../store/documentStore";
import { FeedCard } from "./FeedCard";
import { TimeGroupHeader } from "./TimeGroupHeader";
import { groupByTime } from "../lib/feed-utils";
import type { UiDocument } from "../store/documentStore";
import type { SearchResult } from "../lib/api";

// Same filter logic as the old FileGrid — kept identical for backwards compat
function matchesFilter(doc: UiDocument, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "processing") {
    return !["completed", "ready", "failed", "moved"].includes(doc.status);
  }
  if (filter === "moved") {
    return doc.moveStatus === "moved";
  }
  return doc.kind === filter || doc.documentType === filter;
}

export function ActivityFeed() {
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);
  const stageHistory = useDocumentStore((s) => s.stageHistory);
  const sidebarFilter = useDocumentStore((s) => s.sidebarFilter);
  const search = useDocumentStore((s) => s.search);
  const setSelectedDocument = useDocumentStore((s) => s.setSelectedDocument);
  const uploadsByRequestId = useDocumentStore((s) => s.uploadsByRequestId);
  const processFile = useDocumentStore((s) => s.processFile);

  // Build ordered document list
  const orderedDocs = useMemo(() => {
    // In search mode, show search results
    if (search.status === "ready" || search.status === "loading") {
      const inMemory = search.resultIds
        .map((id) => documents[id])
        .filter(Boolean);
      return inMemory;
    }

    // Normal mode: ordered by documentOrder (newest first)
    return documentOrder
      .map((id) => documents[id])
      .filter(Boolean)
      .filter((doc) => matchesFilter(doc, sidebarFilter));
  }, [documents, documentOrder, sidebarFilter, search]);

  // Group by time
  const now = useMemo(() => Date.now(), [orderedDocs]); // refresh when docs change
  const groups = useMemo(
    () => groupByTime(orderedDocs, (doc) => doc.updatedAt ?? doc.createdAt, now),
    [orderedDocs, now],
  );

  // Orphan results (from search, not in local documents)
  const orphans = search.status === "ready" ? search.orphanResults : [];

  if (groups.length === 0 && orphans.length === 0) {
    return (
      <div className="feed-empty">
        <div className="feed-empty__icon">📄</div>
        <p className="feed-empty__text">
          {sidebarFilter !== "all"
            ? "Inga dokument matchar filtret"
            : "Släpp filer ovan för att börja"}
        </p>
      </div>
    );
  }

  return (
    <div className="activity-feed" id="document-canvas">
      {groups.map((group) => (
        <div key={group.label} className="activity-feed__group">
          <TimeGroupHeader label={group.label} />
          <div className="activity-feed__cards">
            {group.items.map((doc) => (
              <FeedCard
                key={doc.id}
                document={doc}
                history={stageHistory[doc.requestId] ?? []}
                onSelect={() => setSelectedDocument(doc.id)}
                onRetry={
                  doc.retryable && uploadsByRequestId[doc.requestId]
                    ? () => {
                        /* retry logic — reuse existing from DropZone */
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      ))}

      {/* Orphan search results */}
      {orphans.length > 0 && (
        <div className="activity-feed__group">
          <TimeGroupHeader label="Enbart i index" />
          <div className="activity-feed__cards">
            {orphans.map((result: SearchResult) => (
              <div key={result.id} className="feed-card">
                <div className="feed-card__header">
                  <span className="feed-card__title">{result.title}</span>
                  <span className="glass-badge">index</span>
                </div>
                {result.snippet && (
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                    {result.snippet}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

Add to `src/index.css`:

```css
/* ── Activity Feed ────────────────────────────────── */
.activity-feed {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.activity-feed__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.activity-feed__cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.feed-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
}

.feed-empty__icon {
  font-size: 48px;
  margin-bottom: 16px;
  animation: float 5s ease-in-out infinite;
}

.feed-empty__text {
  font-size: 14px;
  color: var(--text-muted);
}
```

**Step 2: Update App.tsx**

In `src/App.tsx`, replace:
```tsx
import { FileGrid } from "./components/FileGrid";
```
with:
```tsx
import { ActivityFeed } from "./components/ActivityFeed";
```

And replace `<FileGrid />` with `<ActivityFeed />` in the JSX.

**Step 3: Simplify DropZone**

In `src/components/DropZone.tsx`, remove the "Recent Activity" section (the bottom glass panel showing 5 activity events with colored dots). The feed itself now shows activity. Keep only the upload area panel.

**Step 4: Run full test suite**

Run: `npm test`
Expected: All existing tests pass (FileGrid tests may need updating — see Task 6)

**Step 5: Commit**

```bash
git add src/components/ActivityFeed.tsx src/App.tsx src/components/DropZone.tsx src/index.css
git commit -m "feat(ui): replace FileGrid with chronological ActivityFeed"
```

**Verification Gate:**
1. Automated: `npm test` — all pass (or FileGrid tests flagged for Task 6)
2. Manual: `npm run dev` → drop a file → see it appear in feed with live stepper → watch stages tick → see it collapse to summary on completion
3. Regression: Sidebar filters still work, search still works, DetailPanel still opens on click
4. Review: FileGrid replaced, DropZone simplified, App.tsx minimal change

---

## Task 6: Update Tests and Clean Up

**Chunk estimate:** ~20 min (Sonnet)

**Files:**
- Modify: `src/components/FileGrid.test.tsx` → rename to `src/components/ActivityFeed.test.tsx` and update
- Delete: `src/components/FileGrid.tsx` (now unused)
- Verify: all existing tests pass

**Step 1: Migrate FileGrid tests**

Rename `FileGrid.test.tsx` to `ActivityFeed.test.tsx`. Update:
- Import `ActivityFeed` instead of `FileGrid`
- Render `<ActivityFeed />` instead of `<FileGrid />`
- Update assertions that reference grid-specific DOM (e.g. `grid-cols-*` classes) to feed-specific DOM
- Keep all behavioral tests (filter logic, search results, empty state, document rendering)

**Step 2: Run tests**

Run: `npm test`
Expected: All pass

**Step 3: Delete old FileGrid**

```bash
rm src/components/FileGrid.tsx
```

Verify no other imports reference `FileGrid`:
```bash
grep -r "FileGrid" src/
```

**Step 4: Type check + build**

Run: `npm run build`
Expected: Clean build, no type errors

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ui): migrate FileGrid tests to ActivityFeed, remove old grid"
```

**Verification Gate:**
1. Automated: `npm test` — all pass
2. Automated: `npm run build` — clean
3. Manual: Full flow: upload → live stepper → completion → filter → search → detail panel → undo toast
4. Review: No dead code remaining, imports clean

---

## Task 7: Polish Animations and Responsive Behavior

**Chunk estimate:** ~20 min (Sonnet)

**Files:**
- Modify: `src/index.css` — animation refinements
- Modify: `src/components/FeedCard.tsx` — staggered entry animation
- Modify: `src/components/ActivityFeed.tsx` — responsive adjustments

**Context:** Add entry animations for new feed cards, smooth stage transitions, and ensure the feed looks good on mobile.

**Step 1: Add feed card entry animation**

In `FeedCard.tsx`, add `animate-fade-in-up` class to the root div (existing keyframe from `index.css`).

**Step 2: Add stage transition animation**

In `PipelineStepper`, when a dot transitions from `pending` to `active`, the CSS already handles this via `transition: background var(--transition-normal)`. Verify this looks smooth.

**Step 3: Mobile layout**

The feed is already single-column by nature (vertical list), so it should work on mobile out of the box. Verify:
- Cards don't overflow on small screens
- Stepper labels are readable at 375px width
- Time group headers don't clip

If stepper labels are too wide on mobile, add a responsive rule:
```css
@media (max-width: 480px) {
  .pipeline-stepper__label {
    font-size: 9px;
  }
}
```

**Step 4: Run full verification**

Run: `npm test && npm run build`

**Step 5: Commit**

```bash
git add -A
git commit -m "polish(ui): feed card animations, stepper transitions, mobile responsiveness"
```

**Verification Gate:**
1. Automated: `npm test && npm run build` — all pass
2. Manual: Drop file → card fades in → stepper animates through stages → card settles
3. Manual: Resize browser to 375px → feed still readable
4. Review: Only CSS + minor component tweaks

---

## Summary

| Task | What | Chunk | Dependencies |
|------|------|-------|--------------|
| 1 | StageHistory in Zustand store | 20 min | None |
| 2 | PipelineStepper component | 25 min | Task 1 (StageEntry type) |
| 3 | TimeGroupHeader + feed-utils | 15 min | None |
| 4 | FeedCard wrapper | 25 min | Task 2, Task 1 |
| 5 | ActivityFeed replaces FileGrid | 30 min | Tasks 1-4 |
| 6 | Test migration + cleanup | 20 min | Task 5 |
| 7 | Animation polish + responsive | 20 min | Task 6 |

**Parallelizable:** Tasks 1, 2, and 3 can run in parallel (no shared files). Task 4 depends on 1+2. Task 5 depends on all. Tasks 6-7 are sequential.

**Total estimated time:** ~155 min (Sonnet), ~75 min (Opus)

**Zero backend changes required.**
