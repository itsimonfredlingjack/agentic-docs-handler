# AI-Docs — Tactical Canvas Design

> Transform AI-Docs from functional dark-mode into a tactile, premium AI interface where every surface is glass, every document type has a color presence, and typography splits cleanly between human (Inter) and machine (JetBrains Mono).

## Design Decisions

| Topic | Choice | Detail |
|-------|--------|--------|
| Type-lighting | Ambient bleed | Soft radial gradient + inset shadow in document-type color |
| Typography | Inter + JetBrains Mono | Sans for UI, mono for AI-extracted data with pill treatment |
| Layout | Floating panels | All panels have margins and border-radius, float over dark canvas |
| DetailPanel | Overlay HUD | Floats above app with deep blur, type-color accent line, scale entry |
| Document rows | Ambient on hover | Type-color gradient bleeds in on hover, neutral at rest |

## 1. Material & Glass System

### Canvas

The root window background is a deep near-black (`#0a0a0f`). No visible containers — all structure comes from floating glass panels.

### Glass Treatment

Every panel, card, and interactive surface uses:

```css
background: rgba(0, 0, 0, 0.4);
backdrop-filter: blur(20px);
box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
border: 1px solid rgba(255, 255, 255, 0.06);
border-radius: 16px;
```

Remove all solid borders (`border-zinc-*`, `border-white/10`, etc.) and replace with the near-invisible `rgba(255,255,255,0.06)` line. The inset top highlight provides depth without visible borders.

**Token migration:** The existing `:root` glass tokens (`--glass-bg`, `--glass-bg-strong`, `--glass-bg-hover`, `--glass-subtle`, `--glass-border`, `--glass-line`, `--glass-shadow`, `--glass-shadow-hover`, `--bg-gradient`, `--text-primary`, `--text-secondary`, `--text-muted`, `--text-disabled`) currently use light-on-dark values that are close but need aligning to the new deeper glass material. Update these tokens in-place so all components using them get the new material automatically.

### Ambient Type-Color Bleed

All elements tagged with a document type (rail cards, document rows on hover, detail panel) receive ambient color:

```css
/* Gradient bleed in corner */
background: linear-gradient(160deg, rgba(var(--type-color-rgb), 0.07) 0%, transparent 60%);

/* Inset highlight in type color */
box-shadow: inset 0 1px 0 rgba(var(--type-color-rgb), 0.1);

/* Bottom accent line */
&::after {
  background: linear-gradient(90deg, transparent, rgba(var(--type-color-rgb), 0.6), transparent);
  height: 1px;
}
```

Type color RGB values (existing variables, need RGB variants for use in `rgba()`):

| Type | Current Variable | Hex | RGB Variable | RGB Value |
|------|-----------------|-----|-------------|-----------|
| Receipt | `--receipt-color` | #34c759 | `--receipt-color-rgb` | `52, 199, 89` |
| Contract | `--contract-color` | #5856d6 | `--contract-color-rgb` | `88, 86, 214` |
| Invoice | `--invoice-color` | #ff375f | `--invoice-color-rgb` | `255, 55, 95` |
| Meeting notes | `--meeting-color` | #ff9f0a | `--meeting-color-rgb` | `255, 159, 10` |
| Report | `--report-color` | #8e8e93 | `--report-color-rgb` | `142, 142, 147` |
| Audio | `--audio-color` | #30b0c7 | `--audio-color-rgb` | `48, 176, 199` |

**Critical:** The `--*-color-rgb` variables MUST be defined as bare comma-separated integers (e.g., `52, 199, 89`), NOT as hex or `rgb(...)` values. This is the only format that works inside `rgba(var(...), alpha)`. Getting this wrong produces a silent CSS failure where the color simply doesn't render.

## 2. Typography

### Font Pairing

**Inter** — the system's voice. All UI: headings, buttons, labels, navigation, body text.

**JetBrains Mono** — the AI's extracted data. All machine-produced values: amounts, dates, ID numbers, filenames, tags, JSON values.

### Installation

Import via Google Fonts in `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

Update Tailwind config (`tailwind.config.js` — note: `.js` not `.ts`):

```js
fontFamily: {
  body: ['Inter', 'system-ui', 'sans-serif'],  // replaces current SF Pro Display
  mono: ["'JetBrains Mono'", 'monospace'],      // replaces current SF Mono
}
```

The existing `font-body` Tailwind class continues to work. No class renames needed.

Update CSS tokens:

```css
--font-body: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

### Data Pill Treatment

AI-extracted values are wrapped in a pill to make them feel "stamped" from the UI:

```css
.data-pill {
  font-family: var(--font-mono);
  font-size: 0.875rem;           /* text-sm */
  padding: 2px 8px;              /* px-2 py-0.5 */
  border-radius: 6px;            /* rounded-md */
  background: rgba(var(--type-color-rgb), 0.1);
  color: rgb(var(--type-color-rgb));
}
```

The pill background and text color both derive from the document's type color. An invoice amount glows faintly red/pink, a receipt amount glows mint green. The machine color-codes its own data — each pill is a contextual data node, not generic monospace text.

### Design Rule

- All UI text (headings, buttons, labels, menus, body) → `font-sans` (Inter)
- All AI-extracted data (amounts, dates, IDs, tags, filenames, JSON) → `font-mono` (JetBrains Mono), ideally in a data-pill

## 3. Layout — Floating Panels

### Root Container

```css
.app-root {
  padding: 12px;
  gap: 12px;
  background: #0a0a0f;
}
```

### The Grain

The flat `#0a0a0f` background is "digitally dead". Add an extremely subtle SVG noise texture overlay to give the canvas a tactile, frosted-glass feel:

```css
.app-root::before {
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

Generate `noise.svg` as a small (200x200) `<feTurbulence>` SVG placed in `public/`. The grain must be barely perceptible — 2-3% opacity — but it makes the glass surfaces feel expensive and physical.

All children float with visible rounded corners and gaps between them. No edge-to-edge panels.

### Sidebar

- `border-radius: 16px`
- Full glass treatment (blur, inset shadow, thin border)
- Margins on all sides — does not touch window edges
- Content unchanged, just material upgrade

### Main Content Area

- `border-radius: 16px`
- Same glass treatment as sidebar
- Floats beside sidebar with 12px gap

### Net Effect

The app goes from "sidebar wall + content area" to "two glass islands floating over a dark void". This creates perceived depth and premium feel.

## 4. DetailPanel — Overlay HUD

### Position & Sizing

```css
.detail-panel {
  position: fixed;
  top: 24px;
  right: 24px;
  bottom: 24px;
  width: var(--detail-panel-width);  /* 468px */
  border-radius: 20px;
  z-index: 45;
}
```

Margins on all sides. Does not touch window edges.

### Material

Deeper than standard glass:

```css
background: rgba(0, 0, 0, 0.6);
backdrop-filter: blur(30px);
box-shadow:
  0 16px 64px rgba(0, 0, 0, 0.6),
  inset 0 1px 0 rgba(255, 255, 255, 0.06);
border: 1px solid rgba(255, 255, 255, 0.08);
```

### Type-Color Accent Line

A thin 1px line at the top of the panel in the document's type color:

```css
&::before {
  content: '';
  position: absolute;
  top: 0;
  left: 20%;
  right: 20%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--type-color), transparent);
}
```

### Entry Animation

Replace current `translateX(100%)` slide with a scale + fade:

```css
@keyframes hud-enter {
  from {
    opacity: 0;
    transform: scale(0.97) translateX(12px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateX(0);
  }
}
```

Duration: 300ms, ease-out.

### Backdrop

Stronger dim behind the panel:

```css
.detail-backdrop {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}
```

## 5. Document Rows — Ambient on Hover

### Resting State

Neutral glass — no type color visible. Subtle background:

```css
.document-row {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 12px;
}
```

### Hover State

Type-color gradient bleeds in:

```css
.document-row:hover {
  background: linear-gradient(160deg, rgba(var(--type-color-rgb), 0.06), transparent 60%);
  border-color: rgba(var(--type-color-rgb), 0.12);
  box-shadow: inset 0 1px 0 rgba(var(--type-color-rgb), 0.08);
}
```

A thin 2px left border in the type color fades in on hover for additional type identification.

### Transition

All hover changes use `transition: all 200ms ease` for smooth in/out.

## 6. Files to Modify

| File | Changes |
|------|---------|
| `public/noise.svg` | **New** — SVG noise texture (feTurbulence, ~200x200) for canvas grain |
| `index.html` | Add Google Fonts imports for Inter + JetBrains Mono |
| `tailwind.config.js` | Update `fontFamily.body` and `fontFamily.mono` values |
| `src/index.css` | Update `--font-body`, `--font-mono` tokens; update `.glass-panel` to new material; add `.data-pill`; add type-color RGB variants; update glass tokens; update `.detail-panel`, `.detail-backdrop` material; update `.document-row` hover; update canvas background; add `hud-enter` keyframe; update `prefers-reduced-motion` |
| `src/App.tsx` | Add padding + gap to root container; wrap sidebar and main in floating glass panels |
| `src/components/Sidebar.tsx` | Remove edge-to-edge assumptions; apply floating glass treatment |
| `src/components/DetailPanel.tsx` | Apply HUD positioning (margins, border-radius); add type-color accent line via style prop; update entry animation class; apply data-pill treatment to extraction fields |
| `src/components/DocumentRow.tsx` | Add type-color hover state via style prop or CSS class; apply data-pill to key-line values |
| `src/components/ProcessingRail.tsx` | Ensure rail-card glass material uses updated tokens; apply data-pill to extracted fields |
| `src/components/SearchBar.tsx` | Update glass material to match new system |
| `src/components/DropZone.tsx` | Update glass material to match new system |
| `src/components/FileMoveToast.tsx` | Update toast glass material to dark system |
| `src/components/MobileFilterSheet.tsx` | Update sheet glass material to dark system |

**Note:** All `@layer components` classes using light backgrounds (`.command-panel`, `.toast-panel`, `.mobile-sheet`, `.action-secondary`, `.sidebar-pill`, `.control-card`) must be updated to match the new dark glass system. The existing `body` mesh animation may become unnecessary with a solid `#0a0a0f` canvas — remove if so.

## 7. What Does NOT Change

- All existing animations (evaporation, classify-lock, morph-pulse, GhostTyper, waveform, scan-line, KineticNumber) stay untouched
- Component structure and state management unchanged
- WebSocket events, store actions, backend — completely untouched
- Responsive breakpoints stay the same
- Keyboard navigation stays the same
- Swedish localization stays the same

## 8. Accessibility

- `prefers-reduced-motion`: cover `hud-enter` animation
- All hover effects must have focus equivalents for keyboard navigation
- Contrast ratios must meet WCAG AA on the new glass backgrounds (check white text on dark glass)
- Type-color bleed must not be the sole indicator of document type (always paired with label text)
