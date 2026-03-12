# Metamorfos — Dokumentet som bygger sig självt

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform ProcessingRail cards from static progress indicators into living documents that morph shape, reveal extracted data via ghost-typing, and support inline correction — making AI processing visible and magical.

**Architecture:** Extend backend WebSocket events to carry classification/extraction payloads at key stages. Frontend RailCard morphs shape per document type, ghost-types extracted fields as they arrive, and supports inline edits. All CSS animation, no canvas/WebGL.

**Tech Stack:** React 19, CSS keyframes + custom properties, Zustand, WebSocket events, FastAPI backend

**Decomposition Strategy:** Feature-based

**Target Model:** Sonnet 30min chunks

---

### Task 1: Richer WebSocket events — backend sends classification + extraction data

**Chunk estimate:** ~25 min (Sonnet)

**Context:** Currently `job.progress` only sends `{ type, request_id, stage, message }`. The frontend has no classification or extraction data until after `job.completed` + document fetch. For Metamorfos, we need this data to arrive *during* processing so the card can morph and ghost-type in real time.

**Files:**
- Modify: `server/pipelines/process_pipeline.py` — `_progress()` method (line 821) and call sites at "classified" (line 307) and after extraction
- Modify: `server/realtime.py` — no schema changes needed, payload is untyped dict
- Modify: `src/types/documents.ts` — extend `job.progress` event type
- Modify: `src/hooks/useWebSocket.ts` — pass new data to store
- Modify: `src/store/documentStore.ts` — `markJobStage` receives optional classification/extraction
- Test: `server/tests/test_api.py` (verify events still work), `src/store/documentStore.test.ts`

**Step 1: Write backend test for enriched progress events**

Add to `server/tests/test_process_pipeline.py` (or the integration test that covers events):

```python
@pytest.mark.asyncio
async def test_progress_classified_includes_classification_payload(fake_pipeline):
    """After classification, the job.progress event should include classification data."""
    # Arrange: submit a document
    # Act: process it
    # Assert: the "classified" progress event contains a "classification" key
```

If there is no existing test that captures emitted events, write one using a spy on `_emit_event`.

**Step 2: Extend `_progress()` to accept optional `data` dict**

In `server/pipelines/process_pipeline.py` line 821:

```python
async def _progress(
    self,
    client_id: str | None,
    request_id: str,
    stage: str,
    message: str,
    data: dict[str, object] | None = None,
) -> None:
    payload: dict[str, object] = {
        "type": "job.progress",
        "request_id": request_id,
        "client_id": client_id,
        "stage": stage,
        "message": message,
    }
    if data is not None:
        payload["data"] = data
    await self._emit_event(client_id, payload)
```

**Step 3: Send classification data at "classified" stage**

At the call site (~line 307) where `await self._progress(client_id, request_id, "classified", "Dokument klassificerat")`, change to:

```python
await self._progress(
    client_id, request_id, "classified", "Dokument klassificerat",
    data={"classification": classification.model_dump(mode="json")},
)
```

**Step 4: Send extraction data after extraction completes**

After extraction completes (before "organizing" stage), add:

```python
await self._progress(
    client_id, request_id, "extracting_done", "Fält extraherade",
    data={"extraction": extraction.model_dump(mode="json")},
)
```

**Step 5: Extend frontend types**

In `src/types/documents.ts`, update the `job.progress` union member:

```typescript
| {
    type: "job.progress";
    request_id: string;
    client_id?: string | null;
    stage: JobStage;
    message: string;
    data?: {
      classification?: DocumentClassification;
      extraction?: ExtractionResult;
    };
  }
```

Add `"extracting_done"` to the `JobStage` union.

**Step 6: Handle enriched events in useWebSocket + store**

In `src/hooks/useWebSocket.ts`, pass `payload.data` to `markJobStage`:

```typescript
handlers.markJobStage(payload.request_id, payload.stage, payload.data);
```

In `src/store/documentStore.ts`, extend `markJobStage` to merge classification/extraction:

```typescript
markJobStage: (requestId, stage, data?) =>
  set((state) => {
    // ... existing lookup ...
    const updates: Partial<UiDocument> = {
      status: stage,
      updatedAt: new Date().toISOString(),
    };
    if (data?.classification) {
      updates.classification = data.classification;
      updates.kind = data.classification.document_type as UiDocumentKind;
      updates.title = data.classification.title;
      updates.summary = data.classification.summary;
      updates.documentType = data.classification.document_type;
    }
    if (data?.extraction) {
      updates.extraction = data.extraction;
    }
    documents[target.id] = { ...target, ...updates };
    // ... stage history ...
  }),
```

**Step 7: Run tests**

```bash
PYTHONPATH=. pytest server/tests -q
npm test
```

**Verification Gate:**
1. Automated: All backend + frontend tests pass
2. Manual: In dev mode, upload a file — check browser console for `backend:event` logs showing `data.classification` and `data.extraction` in progress events
3. Regression: Full test suite passes
4. Review: Diff is scoped to event enrichment only

---

### Task 2: Card shape morphing CSS — document type determines card form

**Chunk estimate:** ~20 min (Sonnet)

**Context:** Currently all RailCards look identical. After classification arrives (Task 1), the card should morph shape based on document type. Receipt = narrow/tall, contract = wide/formal, invoice = standard with highlighted amount, audio = rounded waveform shape.

**Files:**
- Modify: `src/index.css` — new CSS classes and keyframes
- Modify: `src/components/ProcessingRail.tsx` — `RailCard` applies type-based CSS class
- Test: `src/components/ProcessingRail.test.tsx`

**Step 1: Write failing test**

```typescript
it("applies document-type CSS class after classification", () => {
  // Set up a processing doc with kind="receipt"
  // Assert: the rail-card element has class "rail-card--receipt"
});
```

**Step 2: Add CSS classes for each document type**

In `src/index.css` inside `@layer components`:

```css
/* ── Metamorfos card shapes ──────────────── */
.rail-card--receipt {
  min-width: 160px;
  max-width: 180px;
  min-height: 140px;
  border-radius: 4px 4px 12px 12px;
  border-top: 2px dashed var(--receipt-color);
  transition: all var(--transition-smooth);
}

.rail-card--invoice {
  min-width: 220px;
  border-left: 3px solid var(--accent-primary);
  transition: all var(--transition-smooth);
}

.rail-card--contract {
  min-width: 240px;
  border: 1px solid var(--glass-line);
  border-bottom: 3px double var(--contract-color);
  background: linear-gradient(
    180deg,
    var(--glass-bg-strong) 0%,
    color-mix(in srgb, var(--contract-color) 4%, var(--glass-bg-strong)) 100%
  );
  transition: all var(--transition-smooth);
}

.rail-card--meeting_notes,
.rail-card--audio {
  min-width: 200px;
  border-radius: 16px;
  transition: all var(--transition-smooth);
}

.rail-card--generic {
  transition: all var(--transition-smooth);
}

/* Pre-classification: pulsing undecided state */
.rail-card--unclassified {
  animation: morph-pulse 1.5s ease-in-out infinite;
}

@keyframes morph-pulse {
  0%, 100% { border-color: var(--glass-line); }
  33% { border-color: var(--receipt-color); }
  66% { border-color: var(--accent-primary); }
}
```

**Step 3: Apply type class in RailCard**

In `ProcessingRail.tsx`, update `RailCard`:

```typescript
function RailCard({ doc }: { doc: UiDocument }) {
  const stageLabel = STAGE_LABELS[doc.status] ?? doc.status;
  const isClassified = doc.kind && doc.kind !== "generic" && doc.status !== "queued" && doc.status !== "uploading" && doc.status !== "processing" && doc.status !== "transcribing";
  const shapeClass = isClassified ? `rail-card--${doc.kind}` : "rail-card--unclassified";

  return (
    <div className={`rail-card ${shapeClass}`} data-testid="rail-card">
      ...
    </div>
  );
}
```

**Step 4: Run tests**

```bash
npm test
```

**Verification Gate:**
1. Automated: ProcessingRail tests pass with new shape classes
2. Manual: Upload a receipt — card starts with pulsing border, then morphs to narrow receipt shape when classified
3. Regression: `npm test` all pass
4. Review: Only CSS + RailCard className logic changed

---

### Task 3: Ghost typing component — character-by-character field reveal

**Chunk estimate:** ~25 min (Sonnet)

**Context:** When extraction data arrives on the RailCard (via Task 1), fields should write themselves character by character with a blinking cursor. This is the core visual magic of Metamorfos.

**Files:**
- Create: `src/components/GhostTyper.tsx`
- Create: `src/components/GhostTyper.test.tsx`
- Modify: `src/index.css` — ghost typing cursor animation

**Step 1: Write failing test**

```typescript
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GhostTyper } from "./GhostTyper";

describe("GhostTyper", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("reveals text character by character", () => {
    render(<GhostTyper text="Telia" speed={30} />);
    expect(screen.getByTestId("ghost-typer").textContent).toBe("");

    act(() => { vi.advanceTimersByTime(30); });
    expect(screen.getByTestId("ghost-typer").textContent).toBe("T");

    act(() => { vi.advanceTimersByTime(30 * 4); });
    expect(screen.getByTestId("ghost-typer").textContent).toBe("Telia");
  });

  it("shows cursor while typing and hides after done", () => {
    render(<GhostTyper text="Hi" speed={30} />);
    expect(screen.getByTestId("ghost-cursor")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(30 * 3); });
    expect(screen.queryByTestId("ghost-cursor")).not.toBeInTheDocument();
  });

  it("handles empty text without errors", () => {
    render(<GhostTyper text="" speed={30} />);
    expect(screen.getByTestId("ghost-typer").textContent).toBe("");
  });
});
```

**Step 2: Implement GhostTyper**

```typescript
// src/components/GhostTyper.tsx
import { useEffect, useState } from "react";

type GhostTyperProps = {
  text: string;
  speed?: number; // ms per character
  className?: string;
  onDone?: () => void;
};

export function GhostTyper({ text, speed = 25, className, onDone }: GhostTyperProps) {
  const [charIndex, setCharIndex] = useState(0);
  const isDone = charIndex >= text.length;

  useEffect(() => {
    if (!text || isDone) return;
    const timer = setInterval(() => {
      setCharIndex((prev) => {
        const next = prev + 1;
        if (next >= text.length) {
          clearInterval(timer);
          onDone?.();
        }
        return next;
      });
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed, isDone, onDone]);

  // Reset when text changes
  useEffect(() => {
    setCharIndex(0);
  }, [text]);

  return (
    <span className={className} data-testid="ghost-typer">
      {text.slice(0, charIndex)}
      {!isDone && text.length > 0 && (
        <span className="ghost-cursor" data-testid="ghost-cursor" />
      )}
    </span>
  );
}
```

**Step 3: Add CSS for ghost cursor**

```css
/* In @layer components */
.ghost-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--accent-primary);
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: ghost-blink 0.6s step-end infinite;
}

@keyframes ghost-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
```

**Step 4: Run tests**

```bash
npm test
```

**Verification Gate:**
1. Automated: GhostTyper tests pass (3 tests)
2. Manual: Import GhostTyper in a dev sandbox, confirm visual cursor blink + typing
3. Regression: `npm test` all pass
4. Review: Self-contained component, no side effects

---

### Task 4: Wire GhostTyper into RailCard — fields appear during processing

**Chunk estimate:** ~25 min (Sonnet)

**Context:** With Task 1 (enriched events) and Task 3 (GhostTyper), we can now show extracted fields materializing on the RailCard. The card shows: title (ghost-typed after classification), then key fields (ghost-typed after extraction).

**Files:**
- Modify: `src/components/ProcessingRail.tsx` — RailCard uses GhostTyper for title + fields
- Modify: `src/components/ProcessingRail.test.tsx`

**Step 1: Write failing test**

```typescript
it("ghost-types the document title after classification", () => {
  // Set up a doc with status="classified" and title="Faktura Telia Mars 2026"
  // Assert: GhostTyper is rendered with that text
});

it("shows extracted key fields after extraction", () => {
  // Set up a doc with status="extracting_done" and extraction.fields = { vendor: "Telia", amount: "4200" }
  // Assert: extraction field text is rendered via GhostTyper
});
```

**Step 2: Add key-field extraction helper**

In `ProcessingRail.tsx`:

```typescript
function extractKeyLine(doc: UiDocument): string {
  if (!doc.extraction?.fields) return "";
  const f = doc.extraction.fields as Record<string, string | undefined>;
  const parts: string[] = [];
  if (f.vendor) parts.push(String(f.vendor));
  if (f.amount) parts.push(String(f.amount));
  if (f.date) parts.push(String(f.date));
  if (f.parties) parts.push(String(f.parties));
  if (parts.length === 0) {
    // Fallback: first 2 non-empty string fields
    for (const [, value] of Object.entries(doc.extraction.fields)) {
      if (typeof value === "string" && value.trim()) {
        parts.push(value);
        if (parts.length >= 2) break;
      }
    }
  }
  return parts.join(" · ");
}
```

**Step 3: Update RailCard to use GhostTyper**

```typescript
function RailCard({ doc }: { doc: UiDocument }) {
  const stageLabel = STAGE_LABELS[doc.status] ?? doc.status;
  const isClassified = /* from Task 2 */;
  const shapeClass = isClassified ? `rail-card--${doc.kind}` : "rail-card--unclassified";
  const keyLine = extractKeyLine(doc);
  const showGhostTitle = isClassified && doc.title;
  const showGhostFields = Boolean(doc.extraction?.fields && keyLine);

  return (
    <div className={`rail-card ${shapeClass}`} data-testid="rail-card">
      {showGhostTitle ? (
        <GhostTyper text={doc.title} className="rail-card__title" speed={20} />
      ) : (
        <div className="rail-card__title">{doc.title}</div>
      )}
      <div className="rail-card__stage">{stageLabel}</div>
      <MiniStepper currentStage={doc.status} />
      {showGhostFields ? (
        <GhostTyper text={keyLine} className="rail-card__fields" speed={18} />
      ) : (
        <ModalityAnimation doc={doc} />
      )}
    </div>
  );
}
```

**Step 4: Add CSS for rail-card__fields**

```css
.rail-card__fields {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  font-weight: 500;
  min-height: 16px;
}
```

**Step 5: Run tests**

```bash
npm test
```

**Verification Gate:**
1. Automated: Updated ProcessingRail tests pass
2. Manual: Upload a document — watch title ghost-type after classification, then vendor/amount/date ghost-type after extraction
3. Regression: `npm test` all pass
4. Review: RailCard changes scoped to rendering logic only

---

### Task 5: Completion transition — card slides into document feed

**Chunk estimate:** ~15 min (Sonnet)

**Context:** When processing completes, the RailCard currently shows a brief CompletionReceipt then disappears. For Metamorfos, the completion should feel like the card "delivers" itself — a visual transition from rail to feed.

**Files:**
- Modify: `src/index.css` — enhanced completion animation
- Modify: `src/components/ProcessingRail.tsx` — CompletionReceipt shows final typed card

**Step 1: Update CompletionReceipt**

Replace the current simple receipt with a richer version that shows the typed title + kind + key line (the document fully "formed"):

```typescript
function CompletionReceipt({ doc }: { doc: UiDocument }) {
  const isFailed = doc.status === "failed";
  const kindLabel = KIND_LABELS[doc.kind] ?? "Dokument";
  const keyLine = extractKeyLine(doc);

  return (
    <div
      className={`rail-card rail-card--done rail-card--${doc.kind ?? "generic"}`}
      data-testid="rail-card-done"
    >
      <div className="flex items-center gap-2">
        <span style={{ color: isFailed ? "var(--invoice-color)" : "var(--receipt-color)", fontSize: 16 }}>
          {isFailed ? "✕" : "✓"}
        </span>
        <span className="rail-card__title">{doc.title}</span>
      </div>
      <div className="rail-card__stage" style={{ color: isFailed ? "var(--invoice-color)" : "var(--receipt-color)" }}>
        {isFailed ? "Misslyckades" : kindLabel}
      </div>
      {keyLine && !isFailed && (
        <div className="rail-card__fields">{keyLine}</div>
      )}
    </div>
  );
}
```

**Step 2: Enhance the completion CSS animation**

```css
@keyframes rail-card-done {
  0% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
  40% {
    opacity: 1;
    transform: scale(1.03) translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  }
  100% {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
  }
}
```

**Step 3: Run tests**

```bash
npm test
```

**Verification Gate:**
1. Automated: ProcessingRail tests pass
2. Manual: Completed card briefly "lifts" with a glow, then slides down and fades
3. Regression: `npm test` all pass
4. Review: CSS animation only, no logic changes

---

### Task 6: Inline field editing — click to correct extracted data

**Chunk estimate:** ~30 min (Sonnet)

**Context:** When AI gets a field wrong, the user should click it to edit inline. No modal, no form. This applies to the completed document in the feed (DocumentRow + DetailPanel), not the processing rail.

**Files:**
- Create: `src/components/InlineEdit.tsx`
- Create: `src/components/InlineEdit.test.tsx`
- Modify: `src/components/DetailPanel.tsx` — extraction fields become InlineEdit
- Modify: `src/index.css` — inline edit styles
- Modify: `server/api/routes.py` — PATCH endpoint for field corrections (if not already present)
- Modify: `src/lib/api.ts` — `updateDocumentField()` function

**Step 1: Write failing tests for InlineEdit**

```typescript
describe("InlineEdit", () => {
  it("renders value as text by default", () => {
    render(<InlineEdit value="Telia" onSave={vi.fn()} />);
    expect(screen.getByText("Telia")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("switches to input on click", async () => {
    const user = userEvent.setup();
    render(<InlineEdit value="Telia" onSave={vi.fn()} />);
    await user.click(screen.getByText("Telia"));
    expect(screen.getByRole("textbox")).toHaveValue("Telia");
  });

  it("calls onSave on Enter and exits edit mode", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InlineEdit value="Telia" onSave={onSave} />);
    await user.click(screen.getByText("Telia"));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Tele2{Enter}");
    expect(onSave).toHaveBeenCalledWith("Tele2");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("reverts on Escape", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InlineEdit value="Telia" onSave={onSave} />);
    await user.click(screen.getByText("Telia"));
    await user.type(screen.getByRole("textbox"), "wrong");
    await user.keyboard("{Escape}");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Telia")).toBeInTheDocument();
  });
});
```

**Step 2: Implement InlineEdit**

```typescript
// src/components/InlineEdit.tsx
import { useEffect, useRef, useState } from "react";

type InlineEditProps = {
  value: string;
  onSave: (newValue: string) => void;
  className?: string;
};

export function InlineEdit({ value, onSave, className }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <span
        className={`inline-edit ${className ?? ""}`}
        onClick={() => { setDraft(value); setEditing(true); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") { setDraft(value); setEditing(true); } }}
      >
        {value}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      className={`inline-edit inline-edit--active ${className ?? ""}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onSave(draft);
          setEditing(false);
        }
        if (e.key === "Escape") {
          setEditing(false);
        }
      }}
      onBlur={() => setEditing(false)}
    />
  );
}
```

**Step 3: Add inline edit CSS**

```css
.inline-edit {
  cursor: pointer;
  border-bottom: 1px dashed transparent;
  transition: border-color var(--transition-fast);
  padding: 1px 2px;
  border-radius: 3px;
}

.inline-edit:hover {
  border-bottom-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 5%, transparent);
}

.inline-edit--active {
  background: var(--glass-bg-strong);
  border: 1px solid var(--accent-primary);
  border-radius: 4px;
  padding: 2px 6px;
  font: inherit;
  color: inherit;
  outline: none;
}
```

**Step 4: Integrate into DetailPanel**

Wire InlineEdit into the extraction fields display in DetailPanel. When onSave fires, call a new `updateDocumentField()` API function (or update local store optimistically). Backend PATCH endpoint is a follow-up if not already present — start with local-only editing.

**Step 5: Run tests**

```bash
npm test
```

**Verification Gate:**
1. Automated: InlineEdit tests pass (4 tests)
2. Manual: Open a completed document in DetailPanel, click a field value, edit it, press Enter
3. Regression: `npm test` all pass
4. Review: Self-contained component + DetailPanel wiring

---

### Task 7: Final verification + polish

**Chunk estimate:** ~15 min (Sonnet)

**Files:**
- All modified files from Tasks 1-6

**Steps:**

1. Run full backend tests: `PYTHONPATH=. pytest server/tests -q`
2. Run full frontend tests: `npm test`
3. Build: `npm run build`
4. Visual smoke test: `npm run dev` → upload a PDF, image, and audio file:
   - Observe card morphing (shape change after classification)
   - Observe ghost typing (title appears character by character)
   - Observe extraction fields ghost-typing
   - Observe completion animation (lift + slide)
   - Click a field in DetailPanel to edit inline
5. Swedish audit: all user-visible strings in Swedish
6. Remove any dead code from pre-Metamorfos RailCard

**Verification Gate:**
1. Automated: `PYTHONPATH=. pytest server/tests -q && npm test && npm run build` — all pass
2. Manual: Full visual flow for all 3 modalities (text, image, audio)
3. Regression: No existing tests broken
4. Review: Clean diff, no leftover debug code

---

## Dependency Graph

```
Task 1 (Backend events) ──┐
                           ├──→ Task 4 (Wire GhostTyper into RailCard)
Task 3 (GhostTyper) ──────┘          │
                                      ├──→ Task 5 (Completion transition)
Task 2 (CSS morphing) ───────────────┘          │
                                                 ├──→ Task 7 (Final verification)
Task 6 (InlineEdit) ────────────────────────────┘
```

Tasks 1, 2, 3, and 6 are independent — can run in parallel.
Task 4 requires Tasks 1 + 3.
Task 5 requires Task 4 + 2.
Task 7 requires all.
