# Tactical Canvas Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform AI-Docs from light-mode glass into a dark, tactile, premium AI interface with floating panels, ambient type-color bleed, Inter + JetBrains Mono typography, contextual data pills, and SVG grain texture.

**Architecture:** Pure CSS token migration + layout adjustments. Update `:root` variables to dark-mode values, swap font families, add floating layout padding, convert DetailPanel to overlay HUD. No new components, no state changes, no backend changes.

**Tech Stack:** CSS custom properties, Tailwind CSS 3, Google Fonts (Inter, JetBrains Mono), SVG (feTurbulence noise)

**Design Spec:** `docs/superpowers/specs/2026-03-13-tactical-canvas-design.md`

---

## Decomposition Strategy: Layer-based

Changes propagate from tokens → layout → components. Each task builds on the previous layer.

## Task Dependency Graph

```
Task 1 (Fonts + Tokens) ──► Task 2 (Noise + Layout) ──► Task 3 (Glass Components) ──► Task 4 (Document Rows) ──► Task 5 (DetailPanel HUD) ──► Task 6 (Data Pills) ──► Task 7 (Verification)
```

All tasks are sequential — each depends on the token/layout foundation from prior tasks.

---

## Task 1: Font Installation + CSS Token Migration

**Chunk estimate:** ~25 min (Sonnet)

**Files:**
- Modify: `index.html` (lines 3-8 — `<head>`)
- Modify: `tailwind.config.js` (lines 6-7 — fontFamily)
- Modify: `src/index.css` (lines 5-49 — `:root` tokens, lines 57-67 — `body`)

**What to build:**

Install Inter + JetBrains Mono via Google Fonts and migrate all CSS tokens from light-mode to dark-mode glass values.

### Step-by-step:

- [ ] **Step 1: Add Google Fonts imports to index.html**

Insert before the `<title>` tag in `index.html` (after line 5):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Update Tailwind config font families**

In `tailwind.config.js`, replace lines 6-7:

```js
fontFamily: {
  body: ['Inter', 'system-ui', 'sans-serif'],
  mono: ["'JetBrains Mono'", 'monospace'],
},
```

- [ ] **Step 3: Update CSS font tokens**

In `src/index.css` `:root` block, replace the font variables (lines 47-48):

```css
--font-body: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

- [ ] **Step 4: Add type-color RGB variants**

Add these immediately after the existing hex color variables (after line 39):

```css
--receipt-color-rgb: 52, 199, 89;
--contract-color-rgb: 88, 86, 214;
--invoice-color-rgb: 255, 55, 95;
--meeting-color-rgb: 255, 159, 10;
--report-color-rgb: 142, 142, 147;
--audio-color-rgb: 48, 176, 199;
```

**Critical:** These MUST be bare comma-separated integers. Not hex, not `rgb(...)`.

- [ ] **Step 5: Migrate glass tokens to dark-mode**

Replace the glass token block (lines 12-22) with:

```css
--glass-bg: rgba(0, 0, 0, 0.4);
--glass-bg-strong: rgba(0, 0, 0, 0.5);
--glass-bg-hover: rgba(0, 0, 0, 0.55);
--glass-subtle: rgba(255, 255, 255, 0.04);
--glass-border: rgba(255, 255, 255, 0.06);
--glass-line: rgba(255, 255, 255, 0.06);
--glass-blur: blur(20px);
--glass-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
--glass-shadow-hover: 0 12px 42px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);
```

- [ ] **Step 6: Migrate text + background tokens**

Replace the text and gradient tokens:

```css
--bg-gradient: #0a0a0f;
--text-primary: rgba(255, 255, 255, 0.92);
--text-secondary: rgba(255, 255, 255, 0.6);
--text-muted: rgba(255, 255, 255, 0.35);
--text-disabled: rgba(255, 255, 255, 0.2);
```

- [ ] **Step 7: Update body styles**

Replace `body` block (lines 57-67). Remove the mesh animation (no longer needed with solid dark canvas). Update background:

```css
body {
  margin: 0;
  font-family: var(--font-body);
  background: #0a0a0f;
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  overflow-x: hidden;
}
```

Remove the `animation: mesh 20s ease infinite` and `background-size: 200% 200%` properties. Also remove the `@keyframes mesh` block (lines 74-78) — it's now unused. Keep `--canvas-padding` for now (removed in Task 2 when its last consumer in App.tsx is also updated).

- [ ] **Step 8: Verify build compiles**

```bash
npm run build
```

Expected: Clean build with no errors. The UI will look broken at this point (white text on dark bg with mismatched component styles) — that's expected and gets fixed in subsequent tasks.

- [ ] **Step 9: Commit**

```bash
git add index.html tailwind.config.js src/index.css
git commit -m "feat: dark-mode token migration + Inter/JetBrains Mono fonts"
```

---

## Task 2: SVG Noise Texture + Floating Layout

**Chunk estimate:** ~20 min (Sonnet)

**Files:**
- Create: `public/noise.svg`
- Modify: `src/index.css` (body/root styles)
- Modify: `src/App.tsx` (lines 17-27 — root layout)

**What to build:**

Add the SVG grain texture and convert the root layout from edge-to-edge to floating panels with padding.

### Step-by-step:

- [ ] **Step 1: Create noise.svg**

Create `public/noise.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <filter id="noise">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" stitchTiles="stitch"/>
  </filter>
  <rect width="100%" height="100%" filter="url(#noise)" opacity="1"/>
</svg>
```

- [ ] **Step 2: Add noise overlay CSS**

Add after the `body` block in `src/index.css`:

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background: url('/noise.svg') repeat;
  opacity: 0.03;
  mix-blend-mode: overlay;
  pointer-events: none;
  z-index: 9999;
}
```

- [ ] **Step 3: Convert App.tsx to floating layout**

In `src/App.tsx`, update the root container (lines 18-19). Change:

```tsx
<div className="min-h-screen bg-frost text-[var(--text-primary)]">
  <div className="mx-auto flex min-h-screen max-w-[1720px] gap-6 px-[var(--canvas-padding)] py-[var(--canvas-padding)]">
```

To:

```tsx
<div className="min-h-screen text-[var(--text-primary)]" style={{ background: '#0a0a0f' }}>
  <div className="mx-auto flex min-h-screen max-w-[1720px] gap-3 p-3">
```

**Key changes:** Remove `bg-frost` (was the light gradient). Use inline style for the dark canvas color (avoids Tailwind purge issues). Change `gap-6` → `gap-3` (12px) and `px/py-[var(--canvas-padding)]` → `p-3` (12px all sides) for tighter floating layout. Also remove `--canvas-padding` from `:root` in `src/index.css` (line 8) — its last consumer is gone.

- [ ] **Step 4: Add glass-panel to main content area**

The sidebar already uses `.glass-panel` via `Sidebar.tsx`. The main content area needs it too. In `src/App.tsx`, change the current `<main>` (line 63):

Old:
```tsx
<main className="flex min-h-0 flex-1 flex-col gap-4">
```

New:
```tsx
<main className="glass-panel flex min-h-0 flex-1 flex-col gap-4 p-4">
```

Add `glass-panel` and `p-4` to main — gives it the floating glass treatment with interior padding.

**Note:** Sidebar.tsx uses `.glass-panel` class and inherits all new token values automatically. No changes needed to Sidebar.tsx — verify visually that it looks correct with the new dark glass tokens.

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add public/noise.svg src/index.css src/App.tsx
git commit -m "feat: SVG grain texture + floating panel layout"
```

---

## Task 3: Glass Component Migration

**Chunk estimate:** ~30 min (Sonnet)

**Files:**
- Modify: `src/index.css` — `.glass-panel`, `.glass-panel-hover`, `.control-card`, `.sidebar-pill`, `.command-panel`, `.upload-bar`, `.toast-panel`, `.mobile-sheet`, `.action-secondary`, `.rail-card`

**What to build:**

Update all component-level glass classes from light-mode to dark-mode values. These classes use hardcoded rgba values that override tokens.

### Step-by-step:

- [ ] **Step 1: Update .glass-panel (lines 130-158)**

Replace the `::before` shimmer overlay — light shimmer doesn't work on dark glass. Update:

```css
.glass-panel {
  position: relative;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--card-radius);
  backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-shadow);
  overflow: hidden;
}
```

Remove the `::before` pseudo-element entirely (the gradient shimmer is a light-mode effect).

- [ ] **Step 2: Update .glass-panel-hover (lines 160-176)**

```css
.glass-panel-hover {
  transition: background-color var(--transition-normal),
              box-shadow var(--transition-normal),
              transform var(--transition-normal);
}
.glass-panel-hover:hover {
  background: var(--glass-bg-hover);
  box-shadow: var(--glass-shadow-hover);
  transform: translateY(-2px);
}
.glass-panel-hover:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Update .control-card (lines 200-206)**

```css
.control-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  backdrop-filter: blur(26px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
```

- [ ] **Step 4: Update .sidebar-pill (lines 230-252)**

Replace hover/active states:

```css
.sidebar-pill:hover,
.sidebar-pill.is-active {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  border-color: rgba(255, 255, 255, 0.1);
}
```

- [ ] **Step 5: Update .command-panel (lines 538-544)**

```css
.command-panel {
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.5);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(24px);
}
```

- [ ] **Step 6: Update .upload-bar (lines 356-370)**

```css
.upload-bar {
  background: rgba(0, 0, 0, 0.3);
  border: 1px dashed rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: border-color var(--transition-fast), background-color var(--transition-fast);
}
.upload-bar--active {
  border-color: var(--accent-primary);
  background: var(--accent-surface);
}
```

- [ ] **Step 7: Update .toast-panel (lines 294-302)**

```css
.toast-panel {
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  backdrop-filter: blur(28px);
  box-shadow: 0 12px 42px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  padding: 1rem;
  animation: toast-in var(--transition-slide);
}
```

- [ ] **Step 8: Update .mobile-sheet (lines 561-593)**

```css
.mobile-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 60;
  border-radius: 24px 24px 0 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(24px);
  box-shadow: 0 -14px 32px rgba(0, 0, 0, 0.5);
  padding: 1.5rem 1rem 2rem;
  transform: translateY(100%);
  transition: transform var(--transition-slide);
}
.mobile-sheet.is-open {
  transform: translateY(0);
}
```

- [ ] **Step 9: Update .action-secondary (lines 610-624)**

```css
.action-secondary {
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  font-weight: 600;
  transition: background-color var(--transition-fast), border-color var(--transition-fast);
}
.action-secondary:hover {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.1);
}
```

- [ ] **Step 10: Update .document-row base (lines 308-342)**

Only update the base material and failed/review variants. Leave hover and focused states for Task 4 (which adds type-color ambient).

```css
.document-row {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-left: 2px solid transparent;
  border-radius: 12px;
  padding: 12px 14px 12px 13px;  /* 1px less left padding to compensate for thicker left border */
  transition: box-shadow var(--transition-normal), background var(--transition-normal), border-color var(--transition-normal);
  cursor: default;
}
.document-row[role="button"] { cursor: pointer; }
.document-row[role="button"]:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
.document-row--failed {
  border-left: 3px solid var(--invoice-color);
}
.document-row--review {
  border-left: 3px solid var(--meeting-color);
}
```

The `border-left: 2px solid transparent` in resting state prevents layout shift when the type-color left border fades in on hover.

- [ ] **Step 11: Update .rail-card base (lines 385-396)**

```css
.rail-card {
  flex: 0 0 auto;
  min-width: 220px;
  max-width: 320px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 14px;
  position: relative;
  overflow: hidden;
  animation: rail-card-in var(--transition-slide) both;
}
```

- [ ] **Step 12: Add ambient type-color bleed to rail-card variants**

The spec requires ambient type-color on rail cards (not just document rows). Add a bottom accent line to classified rail-card variants. In `src/index.css`, add after the existing rail-card variant blocks:

```css
.rail-card--receipt,
.rail-card--contract,
.rail-card--invoice,
.rail-card--meeting_notes,
.rail-card--audio {
  background: linear-gradient(160deg, rgba(var(--type-color-rgb, 142, 142, 147), 0.07), transparent 60%),
              rgba(0, 0, 0, 0.5);
  box-shadow: inset 0 1px 0 rgba(var(--type-color-rgb, 142, 142, 147), 0.1);
}
```

In `src/components/ProcessingRail.tsx`, set `--type-color-rgb` via style prop on the rail-card div in **both** `RailCard` and `CompletionReceipt` components (both render `rail-card--{kind}` classes). Define a local helper:

```typescript
function typeColorRgb(kind: string): string {
  return `var(--${kind === "meeting_notes" ? "meeting" : kind}-color-rgb)`;
}
```

Apply on both components' root divs:

```tsx
style={{ "--type-color-rgb": typeColorRgb(doc.kind) } as React.CSSProperties}
```

- [ ] **Step 13: Update remaining hardcoded light values in CSS**

Search `src/index.css` for any remaining `rgba(255, 255, 255, 0.8` or higher opacity white values in component classes and reduce them. Key targets:

- `.glass-badge` — update background from white-based to `rgba(255, 255, 255, 0.06)`, border to `rgba(255, 255, 255, 0.08)`
- `.hover-lift:hover` — update shadow from light to dark `rgba(0, 0, 0, 0.2)`

- [ ] **Step 14: Update hardcoded light values in component JSX**

Grep for `bg-white/` and `border-black/` across all `src/components/*.tsx` files and update for dark mode:

- `bg-white/60` → `bg-white/6` (e.g. SearchBar keyboard hint)
- `bg-white/40` → `bg-white/4` (e.g. SearchBar result badges)
- `border-black/10` → `border-white/8` (e.g. SearchBar badges, pills)

Also check `src/index.css` for `time-group-header__line` which uses fallback `#e2e5ea` — update to a dark-mode equivalent like `rgba(255, 255, 255, 0.06)`.

Run `grep -r "bg-white/" src/components/` and `grep -r "border-black/" src/components/` to find all instances.

- [ ] **Step 15: Verify build + visual spot check**

```bash
npm run build
```

- [ ] **Step 16: Commit**

```bash
git add src/index.css src/components/SearchBar.tsx src/components/ProcessingRail.tsx
git commit -m "feat: migrate all glass components to dark-mode material"
```

---

## Task 4: Document Row Ambient Type-Color Hover

**Chunk estimate:** ~20 min (Sonnet)

**Files:**
- Modify: `src/components/DocumentRow.tsx` (lines 13-28 — kindDotColor, lines 65-95 — JSX)
- Modify: `src/index.css` (`.document-row` hover states)

**What to build:**

Add ambient type-color gradient bleed on document row hover.

### Step-by-step:

- [ ] **Step 1: Add kindToRgbVar helper in DocumentRow.tsx**

Add a helper function (near `kindDotColor` at line 13) that maps document kind to the RGB CSS variable name:

```typescript
function kindRgbVar(kind: UiDocumentKind): string {
  const map: Record<string, string> = {
    receipt: "--receipt-color-rgb",
    contract: "--contract-color-rgb",
    invoice: "--invoice-color-rgb",
    meeting_notes: "--meeting-color-rgb",
    audio: "--audio-color-rgb",
  };
  return map[kind] ?? "--report-color-rgb";
}
```

- [ ] **Step 2: Apply CSS variable to document row element**

In the DocumentRow JSX, add a `style` prop to the root div that sets `--type-color-rgb`:

```tsx
style={{ "--type-color-rgb": `var(${kindRgbVar(document.kind)})` } as React.CSSProperties}
```

This passes the document's type-color RGB value into the row's CSS scope.

- [ ] **Step 3: Add ambient hover CSS**

In `src/index.css`, update the `.document-row[role="button"]:hover` rule:

```css
.document-row[role="button"]:hover {
  background: linear-gradient(160deg, rgba(var(--type-color-rgb), 0.06), transparent 60%);
  border-color: rgba(var(--type-color-rgb), 0.12);
  border-left: 2px solid rgba(var(--type-color-rgb), 0.5);
  box-shadow: inset 0 1px 0 rgba(var(--type-color-rgb), 0.08), 0 6px 20px rgba(0, 0, 0, 0.2);
}
```

Also add a focus-visible equivalent so keyboard navigation gets the same glow:

```css
.document-row--focused {
  background: linear-gradient(160deg, rgba(var(--type-color-rgb), 0.06), transparent 60%);
  border-color: rgba(var(--type-color-rgb), 0.12);
  border-left: 2px solid rgba(var(--type-color-rgb), 0.5);
  box-shadow: inset 0 1px 0 rgba(var(--type-color-rgb), 0.08);
  outline: 2px solid var(--accent-primary);
  outline-offset: -2px;
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Existing DocumentRow tests should still pass — we only added CSS and a style prop.

- [ ] **Step 6: Commit**

```bash
git add src/components/DocumentRow.tsx src/index.css
git commit -m "feat: ambient type-color hover on document rows"
```

---

## Task 5: DetailPanel Overlay HUD

**Chunk estimate:** ~25 min (Sonnet)

**Files:**
- Modify: `src/components/DetailPanel.tsx` (lines 97-110 — panel JSX, type-color accent line)
- Modify: `src/index.css` (`.detail-panel`, `.detail-backdrop`)

**What to build:**

Convert DetailPanel from edge-to-edge slide-in to floating HUD overlay with type-color accent, deeper glass, and scale+fade entry.

**Note:** The spec mentions a `@keyframes hud-enter` animation. We use CSS transitions instead (simpler, same effect). The `opacity` + `transform` transition on `.detail-panel`/`.detail-panel--open` achieves the same scale+fade result without an extra keyframe.

### Step-by-step:

- [ ] **Step 1: Update .detail-panel CSS**

Replace the `.detail-panel` block (lines 273-292):

```css
.detail-panel {
  position: fixed;
  z-index: 45;
  top: 24px;
  right: 24px;
  bottom: 24px;
  width: var(--detail-panel-width);
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  backdrop-filter: blur(30px);
  box-shadow: 0 16px 64px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transform: scale(0.97) translateX(12px);
  transition: opacity var(--transition-smooth), transform var(--transition-smooth);
}
.detail-panel--open {
  pointer-events: auto;
  opacity: 1;
  transform: scale(1) translateX(0);
}
```

**Key changes:** Remove `translateX(100%)` slide, replace with `scale(0.97) translateX(12px)` → `scale(1) translateX(0)`. Add `top/right/bottom: 24px` margins. Change `border-left` to full `border` with radius `20px`.

- [ ] **Step 2: Update .detail-backdrop CSS**

Replace the `.detail-backdrop` block (lines 254-272):

```css
.detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0);
  backdrop-filter: blur(0px);
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--transition-smooth), background-color var(--transition-smooth), backdrop-filter var(--transition-smooth);
}
.detail-backdrop--open {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  pointer-events: auto;
  opacity: 1;
}
```

- [ ] **Step 3: Add type-color accent line in DetailPanel.tsx**

In `DetailPanel.tsx`, the panel needs a `--type-color` CSS variable set to the document's color, and a `::before` accent line.

Add a helper (near the component):

```typescript
function kindColor(kind: UiDocumentKind): string {
  const map: Record<string, string> = {
    receipt: "var(--receipt-color)",
    contract: "var(--contract-color)",
    invoice: "var(--invoice-color)",
    meeting_notes: "var(--meeting-color)",
    audio: "var(--audio-color)",
  };
  return map[kind] ?? "var(--report-color)";
}
```

On the `.detail-panel` div, add a style prop:

```tsx
style={{ "--type-color": document ? kindColor(document.kind) : "var(--accent-primary)" } as React.CSSProperties}
```

- [ ] **Step 4: Add accent line CSS**

Add to `src/index.css` after the `.detail-panel--open` rule:

```css
.detail-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 20%;
  right: 20%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--type-color, var(--accent-primary)), transparent);
  z-index: 1;
}
```

- [ ] **Step 5: Add responsive rule for small screens**

At `720px` the detail panel currently goes full-width. Update for HUD margins:

```css
@media (max-width: 720px) {
  .detail-panel {
    top: 12px;
    right: 12px;
    bottom: 12px;
    left: 12px;
    width: auto;
    border-radius: 16px;
  }
}
```

This reduces margins on mobile and lets the panel fill the viewport minus 12px gutters. The spec says "responsive breakpoints stay the same" — this is the same breakpoint, just adapted for the new positioning model.

- [ ] **Step 6: Update prefers-reduced-motion**

In the `prefers-reduced-motion` block (lines 930-957), add:

```css
.detail-panel {
  transition-duration: 0.01ms !important;
}
```

- [ ] **Step 7: Verify build + tests**

```bash
npm run build && npm test
```

- [ ] **Step 8: Commit**

```bash
git add src/components/DetailPanel.tsx src/index.css
git commit -m "feat: DetailPanel overlay HUD with type-color accent line"
```

---

## Task 6: Data Pill Treatment

**Chunk estimate:** ~25 min (Sonnet)

**Files:**
- Modify: `src/index.css` — add `.data-pill` class
- Modify: `src/components/DetailPanel.tsx` — apply data-pill to extraction field values
- Modify: `src/components/DocumentRow.tsx` — apply data-pill to key-line values
- Modify: `src/components/ProcessingRail.tsx` — apply data-pill styling to rail-card fields

**What to build:**

Add the `.data-pill` CSS class and apply it to all AI-extracted data values across the app. Pills use the document's type color for background tinting.

### Step-by-step:

- [ ] **Step 1: Add .data-pill CSS class**

Add in `src/index.css` (in the `@layer components` section):

```css
.data-pill {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(var(--type-color-rgb, 142, 142, 147), 0.1);
  color: rgb(var(--type-color-rgb, 142, 142, 147));
  display: inline-block;
}
```

The fallback `142, 142, 147` is `--report-color-rgb` (grey) for contexts without a type-color.

- [ ] **Step 2: Apply data-pill to DetailPanel extraction fields**

In `DetailPanel.tsx`, the `InlineEditField` component (lines 59-80) wraps `InlineEdit`. The current className is `"text-sm font-medium text-[var(--text-primary)]"`. **Replace it entirely** with `"data-pill"` — the data-pill class already handles font-size, font-family, and color:

```tsx
<InlineEdit
  value={value}
  onSave={handleSave}
  className="data-pill"
/>
```

The parent `<section>` that wraps extraction fields already has access to the document. Set `--type-color-rgb` on the extraction fields section:

```tsx
<section
  className="control-card p-4"
  style={{ "--type-color-rgb": `var(${kindRgbVar(document.kind)})` } as React.CSSProperties}
>
```

Add the same `kindRgbVar` helper used in DocumentRow (or extract to a shared utility in `src/lib/document-colors.ts`).

- [ ] **Step 3: Apply data-pill to DocumentRow key-line**

In `DocumentRow.tsx`, the key-line span (around line 85) that displays extracted values like "Telia · 2 847 kr · 2026-03-08" — wrap the entire key-line value in `data-pill` class:

```tsx
<span className="data-pill text-[13px]">{keyLine}</span>
```

The `--type-color-rgb` variable is already set on the row from Task 4.

- [ ] **Step 4: Apply data-pill styling to ProcessingRail fields**

In `ProcessingRail.tsx`, the `.rail-card__fields` class (line ~425 in CSS) renders the extracted key line via GhostTyper. Update the CSS for `.rail-card__fields`:

```css
.rail-card__fields {
  font-family: var(--font-mono);
  font-size: 12px;
  color: rgb(var(--type-color-rgb, 142, 142, 147));
  margin-top: 4px;
  font-weight: 500;
  min-height: 16px;
}
```

Set `--type-color-rgb` on the rail-card element via style prop (similar pattern to DocumentRow).

- [ ] **Step 5: Extract shared kindRgbVar helper**

If `kindRgbVar` is now used in 3+ components, extract it to `src/lib/document-colors.ts`:

```typescript
import type { UiDocumentKind } from "@/types/documents";

const KIND_RGB_MAP: Record<string, string> = {
  receipt: "--receipt-color-rgb",
  contract: "--contract-color-rgb",
  invoice: "--invoice-color-rgb",
  meeting_notes: "--meeting-color-rgb",
  audio: "--audio-color-rgb",
};

export function kindRgbVar(kind: UiDocumentKind): string {
  return KIND_RGB_MAP[kind] ?? "--report-color-rgb";
}

export function kindColor(kind: UiDocumentKind): string {
  const map: Record<string, string> = {
    receipt: "var(--receipt-color)",
    contract: "var(--contract-color)",
    invoice: "var(--invoice-color)",
    meeting_notes: "var(--meeting-color)",
    audio: "var(--audio-color)",
  };
  return map[kind] ?? "var(--report-color)";
}
```

Update imports in DocumentRow.tsx, DetailPanel.tsx, and ProcessingRail.tsx.

- [ ] **Step 6: Verify build + tests**

```bash
npm run build && npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/lib/document-colors.ts src/components/DetailPanel.tsx src/components/DocumentRow.tsx src/components/ProcessingRail.tsx
git commit -m "feat: contextual data-pill treatment for AI-extracted values"
```

---

## Task 7: Final Verification + Polish

**Chunk estimate:** ~15 min (Sonnet)

**Files:** All previously modified files

**What to verify:**

### Step-by-step:

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

All 254+ frontend tests must pass.

- [ ] **Step 2: Run production build**

```bash
npm run build
```

Clean build, no warnings about unused vars or type errors.

- [ ] **Step 3: Visual audit checklist**

Run `npm run dev` and verify in browser:

- [ ] Canvas is dark (#0a0a0f) with visible grain texture
- [ ] Sidebar is a floating glass panel with rounded corners and gap from edges
- [ ] Main content area is a floating glass panel
- [ ] Document rows show ambient type-color gradient on hover
- [ ] DetailPanel opens as floating HUD (not edge-to-edge)
- [ ] DetailPanel has type-color accent line at top
- [ ] DetailPanel entry is scale+fade (not slide)
- [ ] Extraction field values use JetBrains Mono in data pills
- [ ] Data pills have type-color tinting
- [ ] Toast notifications use dark glass
- [ ] Search bar uses dark glass
- [ ] Drop zone uses dark glass with dashed border
- [ ] All text is legible (white on dark glass)
- [ ] Headings use Inter font
- [ ] Monospace values use JetBrains Mono

- [ ] **Step 4: Accessibility check**

- [ ] Keyboard navigation still works (arrows, j/k, Enter, Escape)
- [ ] Focus rings are visible on dark background
- [ ] `prefers-reduced-motion` disables new transitions

- [ ] **Step 5: Swedish text audit**

Verify no English text was accidentally introduced.

- [ ] **Step 6: Dead code cleanup**

- Remove `@keyframes mesh` if unused
- Remove any orphaned light-mode CSS values
- Remove unused imports

- [ ] **Step 7: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "fix: final polish and dead code cleanup"
```

---

## Files Summary

| File | Tasks | Change |
|------|-------|--------|
| `index.html` | 1 | Google Fonts imports |
| `tailwind.config.js` | 1 | Font family values |
| `public/noise.svg` | 2 | **New** — feTurbulence grain texture |
| `src/index.css` | 1, 2, 3, 4, 5, 6 | Token migration, glass classes, data-pill, HUD styles |
| `src/App.tsx` | 2 | Dark canvas + floating layout padding |
| `src/lib/document-colors.ts` | 6 | **New** — shared kindRgbVar/kindColor helpers |
| `src/components/Sidebar.tsx` | — | No changes (inherits via glass-panel tokens) |
| `src/components/DocumentRow.tsx` | 4, 6 | Type-color hover + data-pill key-line |
| `src/components/DetailPanel.tsx` | 5, 6 | HUD positioning + accent line + data-pill fields |
| `src/components/ProcessingRail.tsx` | 6 | Type-color on rail-cards + data-pill fields |
| `src/components/SearchBar.tsx` | 3 | Inherits via command-panel token update |
| `src/components/DropZone.tsx` | 3 | Inherits via upload-bar token update |
| `src/components/FileMoveToast.tsx` | 3 | Inherits via toast-panel token update |
| `src/components/MobileFilterSheet.tsx` | 3 | Inherits via mobile-sheet token update |
