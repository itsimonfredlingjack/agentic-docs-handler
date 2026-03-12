# Dokumentens Resa — ProcessingRail Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a horizontal ProcessingRail between the upload bar and document feed that shows active jobs as compact cards moving through pipeline stages with modality-specific animations. Processing documents are hidden from DocumentRow and only appear in the feed once complete.

**Architecture:** ProcessingRail subscribes to Zustand store, filters for documents where `mapToUserStatus === "bearbetas" || "uppladdad"`. Each rail card renders an inline mini-stepper with modality-aware animation (waveform for audio, scan-line for image/OCR, standard dots for text). When a job completes, the card plays an exit animation and the document appears in ActivityFeed as a DocumentRow. The rail auto-hides when empty.

**Tech Stack:** React 19, Zustand, CSS keyframes, existing PipelineStepper stage logic

**Decomposition Strategy:** Layer-based (utilities → CSS → component → integration → polish)

**Target Model:** Sonnet 30min chunks

---

## Dependency Graph

```
Task 1 (isProcessingStatus util) ──┐
                                    ├──→ Task 3 (ProcessingRail component)
Task 2 (CSS)                      ──┘           │
                                                 ├──→ Task 4 (Integration: App + ActivityFeed)
                                                 │
                                                 └──→ Task 5 (Modality animations) ──→ Task 6 (Completion animation + verify)
```

Tasks 1+2 can run in parallel. Task 3 depends on both. Tasks 4+5 depend on 3 but can run in parallel. Task 6 last.

---

## Task 1: Processing Status Utility

**Chunk estimate:** ~10 min (Sonnet)

**Files:**
- Modify: `src/lib/status.ts`
- Modify: `src/lib/status.test.ts`

**What:** Add a helper `isProcessingStatus(doc)` that returns `true` for documents that should live in the rail (uploading/processing states). This centralizes the filter logic so both ProcessingRail and ActivityFeed use the same predicate.

**Step 1: Write the failing test**

Add to `src/lib/status.test.ts`:

```typescript
import { isProcessingStatus } from "./status";

describe("isProcessingStatus", () => {
  it("returns true for uploading status", () => {
    expect(isProcessingStatus(makeDoc({ status: "uploading" }))).toBe(true);
  });

  it("returns true for all processing stages", () => {
    for (const status of ["processing", "transcribing", "classifying", "classified", "extracting", "organizing", "indexing"] as const) {
      expect(isProcessingStatus(makeDoc({ status }))).toBe(true);
    }
  });

  it("returns true for queued status", () => {
    expect(isProcessingStatus(makeDoc({ status: "queued" }))).toBe(true);
  });

  it("returns false for completed", () => {
    expect(isProcessingStatus(makeDoc({ status: "completed" }))).toBe(false);
  });

  it("returns false for failed", () => {
    expect(isProcessingStatus(makeDoc({ status: "failed" }))).toBe(false);
  });

  it("returns false for awaiting_confirmation", () => {
    expect(isProcessingStatus(makeDoc({ status: "awaiting_confirmation" }))).toBe(false);
  });

  it("returns false for ready", () => {
    expect(isProcessingStatus(makeDoc({ status: "ready" }))).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/status.test.ts`
Expected: FAIL — `isProcessingStatus` is not exported

**Step 3: Write minimal implementation**

Add to `src/lib/status.ts`:

```typescript
export function isProcessingStatus(doc: UiDocument): boolean {
  const s = mapToUserStatus(doc);
  return s === "uppladdad" || s === "bearbetas";
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/status.test.ts`
Expected: All pass (previous 27 + new 7 = 34 tests)

**Step 5: Commit**

```bash
git add src/lib/status.ts src/lib/status.test.ts
git commit -m "feat(status): add isProcessingStatus utility for rail/feed filtering"
```

**Verification Gate:**
1. Automated: `npx vitest run src/lib/status.test.ts` — 34 pass
2. Manual: N/A (pure utility)
3. Regression: `npx vitest run` — all pass
4. Review: Diff is one function + tests, no unrelated changes

---

## Task 2: ProcessingRail CSS

**Chunk estimate:** ~10 min (Sonnet)

**Files:**
- Modify: `src/index.css`

**What:** Add CSS for the rail container, rail cards, modality animations (waveform, scan-line), and completion exit animation.

**Step 1: Add keyframes for modality animations**

Add after the existing `@keyframes stepper-pulse` block (after line 633 in `src/index.css`):

```css
@keyframes waveform {
  0%, 100% { transform: scaleY(0.4); }
  25% { transform: scaleY(1.0); }
  50% { transform: scaleY(0.6); }
  75% { transform: scaleY(0.9); }
}

@keyframes scan-line {
  0% { left: 0; }
  100% { left: 100%; }
}

@keyframes rail-card-in {
  from {
    opacity: 0;
    transform: translateX(-20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@keyframes rail-card-done {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(8px) scale(0.97);
  }
}
```

**Step 2: Add rail component classes**

Add after the `.upload-bar--active` block inside `@layer components`:

```css
.processing-rail {
  display: flex;
  gap: 10px;
  padding: 6px 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.processing-rail::-webkit-scrollbar {
  display: none;
}

.rail-card {
  flex: 0 0 auto;
  min-width: 220px;
  max-width: 320px;
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-line);
  border-radius: 10px;
  padding: 10px 14px;
  position: relative;
  overflow: hidden;
  animation: rail-card-in var(--transition-slide) both;
}

.rail-card--done {
  animation: rail-card-done var(--transition-smooth) both;
}

.rail-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rail-card__stage {
  font-size: 11px;
  color: var(--accent-primary);
  font-weight: 500;
  margin-top: 2px;
}

.rail-card__modality-audio {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 16px;
  margin-top: 6px;
}

.rail-card__modality-audio span {
  width: 3px;
  border-radius: 1px;
  background: var(--audio-color);
  animation: waveform 0.8s ease-in-out infinite;
}

.rail-card__modality-audio span:nth-child(2) { animation-delay: 0.1s; }
.rail-card__modality-audio span:nth-child(3) { animation-delay: 0.2s; }
.rail-card__modality-audio span:nth-child(4) { animation-delay: 0.3s; }
.rail-card__modality-audio span:nth-child(5) { animation-delay: 0.15s; }

.rail-card__modality-scan {
  position: relative;
  height: 3px;
  margin-top: 6px;
  background: color-mix(in srgb, var(--meeting-color) 15%, transparent);
  border-radius: 2px;
  overflow: hidden;
}

.rail-card__modality-scan::after {
  content: "";
  position: absolute;
  top: 0;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, transparent, var(--meeting-color), transparent);
  animation: scan-line 1.5s ease-in-out infinite;
}
```

**Step 3: Run build to verify CSS is valid**

Run: `npm run build`
Expected: Build succeeds, no CSS errors

**Step 4: Commit**

```bash
git add src/index.css
git commit -m "style: add ProcessingRail, rail-card, and modality animation CSS"
```

**Verification Gate:**
1. Automated: `npm run build` — succeeds
2. Manual: CSS file has no syntax errors
3. Regression: `npx vitest run` — all pass (CSS-only change)
4. Review: Only new CSS classes added, nothing removed

---

## Task 3: ProcessingRail Component

**Chunk estimate:** ~25 min (Sonnet)

**Files:**
- Create: `src/components/ProcessingRail.tsx`
- Create: `src/components/ProcessingRail.test.tsx`

**What:** The main rail component. Subscribes to Zustand, filters for processing documents, renders a horizontally scrolling row of `RailCard` sub-components. Each card shows filename, current stage label (Swedish), an inline mini-stepper (5 dots), and a modality-specific animation. The rail renders nothing when there are no active jobs.

**Step 1: Write the failing test**

Create `src/components/ProcessingRail.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProcessingRail } from "./ProcessingRail";
import { useDocumentStore } from "../store/documentStore";

const processingDoc = {
  id: "doc-1",
  requestId: "req-1",
  title: "faktura.pdf",
  summary: "",
  mimeType: "application/pdf",
  sourceModality: "text",
  kind: "generic",
  documentType: "generic",
  template: "processing",
  sourcePath: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  classification: { document_type: "generic", template: "generic", title: "faktura.pdf", summary: "", tags: [], language: "sv", confidence: 0, ocr_text: null, suggested_actions: [] },
  extraction: null,
  transcription: null,
  movePlan: null,
  moveResult: null,
  status: "classifying" as const,
  tags: [],
  undoToken: null,
  retryable: false,
  errorCode: null,
  warnings: [],
  moveStatus: "not_requested" as const,
  diagnostics: null,
};

const completedDoc = {
  ...processingDoc,
  id: "doc-2",
  requestId: "req-2",
  title: "kvitto.pdf",
  status: "completed" as const,
};

describe("ProcessingRail", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      documents: {},
      documentOrder: [],
      stageHistory: {},
    });
  });

  it("renders nothing when no processing documents", () => {
    const { container } = render(<ProcessingRail />);
    expect(container.innerHTML).toBe("");
  });

  it("renders rail card for processing document", () => {
    useDocumentStore.setState({
      documents: { "doc-1": processingDoc },
      documentOrder: ["doc-1"],
      stageHistory: { "req-1": [{ stage: "uploading", at: 1000 }, { stage: "classifying", at: 2000 }] },
    });
    render(<ProcessingRail />);
    expect(screen.getByText("faktura.pdf")).toBeInTheDocument();
    expect(screen.getByText("Klassificera")).toBeInTheDocument();
  });

  it("does not render completed documents", () => {
    useDocumentStore.setState({
      documents: { "doc-2": completedDoc },
      documentOrder: ["doc-2"],
      stageHistory: {},
    });
    const { container } = render(<ProcessingRail />);
    expect(container.innerHTML).toBe("");
  });

  it("renders multiple rail cards", () => {
    const doc2 = { ...processingDoc, id: "doc-3", requestId: "req-3", title: "avtal.docx", status: "extracting" as const };
    useDocumentStore.setState({
      documents: { "doc-1": processingDoc, "doc-3": doc2 },
      documentOrder: ["doc-1", "doc-3"],
      stageHistory: {
        "req-1": [{ stage: "uploading", at: 1000 }],
        "req-3": [{ stage: "uploading", at: 1000 }],
      },
    });
    render(<ProcessingRail />);
    expect(screen.getByText("faktura.pdf")).toBeInTheDocument();
    expect(screen.getByText("avtal.docx")).toBeInTheDocument();
  });

  it("renders audio waveform for audio modality", () => {
    const audioDoc = { ...processingDoc, sourceModality: "audio" as const, status: "transcribing" as const };
    useDocumentStore.setState({
      documents: { "doc-1": audioDoc },
      documentOrder: ["doc-1"],
      stageHistory: { "req-1": [{ stage: "uploading", at: 1000 }] },
    });
    const { container } = render(<ProcessingRail />);
    expect(container.querySelector(".rail-card__modality-audio")).toBeInTheDocument();
  });

  it("renders scan line for image modality", () => {
    const imgDoc = { ...processingDoc, sourceModality: "image" as const };
    useDocumentStore.setState({
      documents: { "doc-1": imgDoc },
      documentOrder: ["doc-1"],
      stageHistory: { "req-1": [{ stage: "uploading", at: 1000 }] },
    });
    const { container } = render(<ProcessingRail />);
    expect(container.querySelector(".rail-card__modality-scan")).toBeInTheDocument();
  });

  it("renders standard processing-bar for text modality", () => {
    useDocumentStore.setState({
      documents: { "doc-1": processingDoc },
      documentOrder: ["doc-1"],
      stageHistory: { "req-1": [{ stage: "uploading", at: 1000 }] },
    });
    const { container } = render(<ProcessingRail />);
    expect(container.querySelector(".processing-bar")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ProcessingRail.test.tsx`
Expected: FAIL — module not found

**Step 3: Write ProcessingRail component**

Create `src/components/ProcessingRail.tsx`:

```tsx
import { useMemo } from "react";
import { useDocumentStore } from "../store/documentStore";
import { isProcessingStatus } from "../lib/status";
import type { UiDocument, SourceModality } from "../types/documents";

const STAGE_LABELS: Record<string, string> = {
  queued: "I kö",
  uploading: "Laddar upp",
  processing: "Bearbetar",
  transcribing: "Transkriberar",
  classifying: "Klassificera",
  classified: "Extrahera",
  extracting: "Extrahera",
  organizing: "Organisera",
  indexing: "Indexera",
};

const PIPELINE_KEYS = ["uploading", "classifying", "extracting", "organizing", "indexing"] as const;

const RESOLVE_MAP: Record<string, string> = {
  processing: "classifying",
  transcribing: "classifying",
  classified: "extracting",
};

function resolveStage(raw: string): string {
  return RESOLVE_MAP[raw] ?? raw;
}

function stageIdx(stage: string): number {
  const resolved = resolveStage(stage);
  const idx = PIPELINE_KEYS.indexOf(resolved as typeof PIPELINE_KEYS[number]);
  return idx === -1 ? 0 : idx;
}

function ModalityAnimation({ modality }: { modality: SourceModality }) {
  if (modality === "audio") {
    return (
      <div className="rail-card__modality-audio">
        {[...Array(5)].map((_, i) => (
          <span key={i} style={{ height: `${40 + Math.random() * 60}%` }} />
        ))}
      </div>
    );
  }
  if (modality === "image") {
    return <div className="rail-card__modality-scan" />;
  }
  return <div className="processing-bar mt-1.5" style={{ height: 3 }} />;
}

function MiniStepper({ currentStage }: { currentStage: string }) {
  const active = stageIdx(currentStage);
  return (
    <div className="mt-1.5 flex items-center gap-1">
      {PIPELINE_KEYS.map((key, i) => (
        <div key={key} className="flex items-center gap-1">
          <span
            className="inline-block h-[6px] w-[6px] rounded-full transition-colors"
            style={{
              background: i <= active ? "var(--accent-primary)" : "var(--glass-line)",
              boxShadow: i === active ? "0 0 0 3px color-mix(in srgb, var(--accent-primary) 20%, transparent)" : "none",
            }}
          />
          {i < PIPELINE_KEYS.length - 1 && (
            <span
              className="inline-block h-[2px] w-3"
              style={{ background: i < active ? "var(--accent-primary)" : "var(--glass-line)" }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function RailCard({ document }: { document: UiDocument }) {
  const stageLabel = STAGE_LABELS[document.status] ?? "Bearbetar";

  return (
    <div className="rail-card" data-testid="rail-card">
      <p className="rail-card__title">{document.title}</p>
      <p className="rail-card__stage">{stageLabel}</p>
      <MiniStepper currentStage={document.status} />
      <ModalityAnimation modality={document.sourceModality} />
    </div>
  );
}

export function ProcessingRail() {
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);

  const processingDocs = useMemo(
    () =>
      documentOrder
        .map((id) => documents[id])
        .filter(Boolean)
        .filter(isProcessingStatus),
    [documents, documentOrder],
  );

  if (processingDocs.length === 0) return null;

  return (
    <div className="processing-rail" role="region" aria-label="Aktiva jobb">
      {processingDocs.map((doc) => (
        <RailCard key={doc.id} document={doc} />
      ))}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ProcessingRail.test.tsx`
Expected: All 7 tests pass

**Step 5: Commit**

```bash
git add src/components/ProcessingRail.tsx src/components/ProcessingRail.test.tsx
git commit -m "feat: add ProcessingRail component with modality animations"
```

**Verification Gate:**
1. Automated: `npx vitest run src/components/ProcessingRail.test.tsx` — 7 pass
2. Manual: N/A (not integrated yet)
3. Regression: `npx vitest run` — all pass
4. Review: Component is self-contained, no modifications to existing files

---

## Task 4: Integration — App Layout + ActivityFeed Filter

**Chunk estimate:** ~20 min (Sonnet)

**Files:**
- Modify: `src/App.tsx:62-68` — add `<ProcessingRail />` between DropZone and ActivityFeed
- Modify: `src/components/ActivityFeed.tsx:13-22` — update `matchesFilter` to exclude processing docs
- Modify: `src/components/ActivityFeed.test.tsx` — add test for processing doc exclusion
- Modify: `src/components/DocumentRow.tsx` — remove the `isProcessing` path (processing-bar + processing modifier class) since DocumentRow no longer renders processing docs

**Step 1: Write the failing test for ActivityFeed filtering**

Add to `src/components/ActivityFeed.test.tsx`:

```typescript
it("excludes processing documents from feed", () => {
  const processingDoc = {
    ...mockDoc,
    id: "doc-proc",
    requestId: "req-proc",
    status: "classifying",
    template: "processing",
  };
  useDocumentStore.setState({
    documents: { "doc-1": mockDoc, "doc-proc": processingDoc },
    documentOrder: ["doc-proc", "doc-1"],
    stageHistory: {},
  });
  render(<ActivityFeed />);
  expect(screen.getByText("test-doc.pdf")).toBeInTheDocument();
  expect(screen.queryByText("document-row")).not.toBeNull(); // completed doc renders
  // The processing doc should not appear as a DocumentRow
  const rows = screen.getAllByTestId("document-row");
  expect(rows).toHaveLength(1);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ActivityFeed.test.tsx`
Expected: FAIL — processing doc also appears as DocumentRow (2 rows instead of 1)

**Step 3: Update ActivityFeed.tsx matchesFilter**

In `src/components/ActivityFeed.tsx`, update the `matchesFilter` function to exclude processing docs:

```typescript
import { isProcessingStatus } from "../lib/status";

function matchesFilter(doc: UiDocument, filter: string): boolean {
  // Processing docs live in ProcessingRail, not here
  if (isProcessingStatus(doc)) return false;
  if (filter === "all") return true;
  if (filter === "processing") {
    return doc.status !== "ready" && doc.status !== "completed" && doc.status !== "failed";
  }
  if (filter === "moved") {
    return doc.moveStatus === "moved";
  }
  return doc.kind === filter;
}
```

**Important:** The `filter === "processing"` sidebar filter now only matches `awaiting_confirmation` docs (since all truly-processing docs are excluded by `isProcessingStatus`). This is correct — the sidebar "processing" filter shows docs that need attention but aren't in the rail.

**Step 4: Update App.tsx layout**

Add ProcessingRail between DropZone and ActivityFeed:

```tsx
import { ProcessingRail } from "./components/ProcessingRail";

// In the JSX, between <DropZone /> and <ActivityFeed />:
<DropZone />
<ProcessingRail />
<ActivityFeed />
```

**Step 5: Clean up DocumentRow**

In `src/components/DocumentRow.tsx`, the `isProcessing` code path is now dead (DocumentRow never receives processing docs). Remove:
- The `isProcessing` variable
- The `document-row--processing` modifier from `modifierClass`
- The `{isProcessing && <div className="processing-bar mt-2" />}` block

The `modifierClass` becomes:
```typescript
const modifierClass = isFailed
  ? "document-row--failed"
  : isReview
    ? "document-row--review"
    : "";
```

**Step 6: Update DocumentRow tests**

In `src/components/DocumentRow.test.tsx`, remove the test "shows processing bar when document is being processed" and "is not clickable when processing" since DocumentRow no longer handles processing state. These behaviors are now tested in ProcessingRail.test.tsx.

**Step 7: Run all tests**

Run: `npx vitest run`
Expected: All pass

**Step 8: Commit**

```bash
git add src/App.tsx src/components/ActivityFeed.tsx src/components/ActivityFeed.test.tsx src/components/DocumentRow.tsx src/components/DocumentRow.test.tsx
git commit -m "feat: integrate ProcessingRail, filter processing docs from feed"
```

**Verification Gate:**
1. Automated: `npx vitest run` — all pass
2. Manual: `npm run build` — succeeds
3. Regression: No existing tests broken
4. Review: ProcessingRail placed between DropZone and ActivityFeed, processing docs excluded from feed, DocumentRow cleaned up

---

## Task 5: Completion Animation + Result Receipt

**Chunk estimate:** ~20 min (Sonnet)

**Files:**
- Modify: `src/components/ProcessingRail.tsx` — add completion receipt state
- Modify: `src/components/ProcessingRail.test.tsx` — add completion test

**What:** When a document transitions from processing to completed/failed, the rail card briefly shows a "result receipt" (green checkmark + Swedish summary like "Klassificerad som Faktura") before fading out. Uses the existing `rail-card--done` CSS animation.

**Step 1: Write the failing test**

Add to `ProcessingRail.test.tsx`:

```typescript
it("shows completion receipt for recently-completed document", () => {
  // Start with a processing doc
  useDocumentStore.setState({
    documents: { "doc-1": processingDoc },
    documentOrder: ["doc-1"],
    stageHistory: { "req-1": [{ stage: "uploading", at: 1000 }, { stage: "classifying", at: 2000 }] },
  });
  const { rerender } = render(<ProcessingRail />);
  expect(screen.getByText("faktura.pdf")).toBeInTheDocument();

  // Now mark it as completed
  const completedVersion = {
    ...processingDoc,
    status: "completed" as const,
    kind: "invoice" as const,
    documentType: "invoice",
  };
  useDocumentStore.setState({
    documents: { "doc-1": completedVersion },
    documentOrder: ["doc-1"],
    stageHistory: { "req-1": [{ stage: "uploading", at: 1000 }, { stage: "completed", at: 5000 }] },
  });
  rerender(<ProcessingRail />);
  // The rail card should show a completion receipt with kind label
  expect(screen.getByText(/Faktura/)).toBeInTheDocument();
});
```

**Step 2: Implement completion tracking**

Add a `useRef` to track previously-processing requestIds. When a document leaves the processing set but was present in the previous render, show a receipt card for 2 seconds.

In `ProcessingRail.tsx`:

- Add `recentlyCompleted` state: `Map<string, UiDocument>` tracking docs that just completed
- Use `useRef` to remember previous processing requestIds
- On each render, diff current vs previous: any doc that left processing → add to `recentlyCompleted` with a 2s timeout
- Render `recentlyCompleted` docs as `RailCard` with `rail-card--done` class and a receipt overlay

The receipt overlay shows:
- ✓ icon (green) + kind label in Swedish (using existing `formatKindLabel`-style logic)
- Or ✕ icon (red) for failed docs

**Step 3: Run tests**

Run: `npx vitest run src/components/ProcessingRail.test.tsx`
Expected: All pass including completion receipt test

**Step 4: Commit**

```bash
git add src/components/ProcessingRail.tsx src/components/ProcessingRail.test.tsx
git commit -m "feat: add completion receipt animation to ProcessingRail"
```

**Verification Gate:**
1. Automated: `npx vitest run src/components/ProcessingRail.test.tsx` — all pass
2. Manual: N/A
3. Regression: `npx vitest run` — all pass
4. Review: Completion tracking is ref-based, no store changes needed

---

## Task 6: Final Verification + Polish

**Chunk estimate:** ~15 min (Sonnet)

**Files:**
- Possibly modify: `src/index.css` — remove `.document-row--processing` class (dead CSS since DocumentRow no longer uses it)
- Possibly modify: various test files for assertion updates

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All pass

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Dead CSS cleanup**

Remove `.document-row--processing` from `src/index.css` (line ~330) since DocumentRow no longer applies it.

**Step 4: Swedish audit**

Grep for any English strings in new components:

```bash
grep -rn '"[A-Z][a-z]*ing\|"Process\|"Upload\|"Complete\|"Failed' src/components/ProcessingRail.tsx
```

Expected: No matches (all labels should be Swedish)

**Step 5: Run full verification chain**

```bash
npx vitest run && npm run build
```

Expected: All pass, build succeeds

**Step 6: Commit**

```bash
git add -A
git commit -m "polish: remove dead CSS, verify ProcessingRail integration"
```

**Verification Gate:**
1. Automated: `npx vitest run` — all pass
2. Automated: `npm run build` — succeeds
3. Manual: `npm run dev` — visual check: rail appears during processing, hides when idle, modality animations visible, completion receipt shows before fade
4. Review: No dead CSS, no English strings, clean diff

---

## Post-Implementation Checklist

- [ ] ProcessingRail visible between upload bar and document feed
- [ ] Rail auto-hides when no active jobs
- [ ] Each rail card shows: filename, stage label (Swedish), mini-stepper dots, modality animation
- [ ] Audio docs show waveform animation
- [ ] Image docs show scan-line animation
- [ ] Text docs show standard processing bar
- [ ] Completed docs show receipt with kind label, then fade out
- [ ] Failed docs show error receipt, then fade out
- [ ] DocumentRow no longer shows processing-state documents
- [ ] ActivityFeed filters out processing docs
- [ ] All text in Swedish
- [ ] `npx vitest run` — all pass
- [ ] `npm run build` — succeeds
- [ ] `prefers-reduced-motion` disables rail animations
