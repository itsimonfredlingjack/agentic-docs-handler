# Agentic Docs Handler — Design Specification v1

**Visuell design, UX-arkitektur och interaktionsmönster**
*Baserad på "Frost & Fluidity"-konceptet, nerskalad till verklighet*

---

## 0. Designfilosofi

### Kärnprincip

> Användaren ska aldrig känna att de arbetar i en databas eller ett filsystem.
> De ska känna att de har en hyperintelligent assistent som tar emot papper,
> sorterar dem i perfekta pärmar, och ger dem en post-it med exakt vad de behöver veta.

### Vad det betyder i praktiken

- **Noll konfiguration synlig.** Ollama, FastAPI, VRAM — det existerar inte i UI:t.
- **Resultat före process.** Visa "Kvitto, ICA, 342 kr" — inte "Klassificering pågår med Qwen 3.5 9B Q4_K_M via Ollama..."
- **Handlingar, inte data.** Varje vy ska leda till en action, inte bara visa information.
- **Snabbhet framför spektakel.** Animationer ska vara 150–300ms. Aldrig över 500ms. Aldrig blockerande.

### Designspråk: "Frost Glass" — Ljust tema, macOS-native känsla

| Egenskap | Beslut | VARFÖR |
|----------|--------|--------|
| Tema | **Ljust first** (dark mode som option) | Matchar macOS, bättre läsbarhet, det Simon valde |
| Material | Frosted glass — `backdrop-filter: blur(40px)` | Ger djup utan tyngd, skrivbordsbakgrund lyser igenom |
| Färgpalett | Varm neutral bas + färgkodade dokumenttyper | Inte sterilt vitt, inte mörkt — varmt och levande |
| Typografi | SF Pro Display (system) + SF Mono (metadata) | Native macOS-känsla, noll externa fonts att ladda |
| Hörn | 14–16px border-radius | Apple-konsekvent, mjukt utan att vara bubbligt |
| Skuggor | Mjuka, diffusa — aldrig hårda drop shadows | `box-shadow: 0 4px 24px rgba(0,0,0,0.04)` |
| Borders | 1px, `rgba(0,0,0,0.06)` — knappt synliga | Struktur utan visuellt brus |
| Ikoner | Outlined, 1.5px stroke, Lucide-style | Rent, modernt, matchar Apple HIG |

---

## 1. Färgpalett

### Bas — "Warm Frost"

```
Bakgrund (gradient):    linear-gradient(145deg, #f5f0ec, #e8e3f3, #dce8f5, #f0ece5)
Panel-glas:             rgba(255, 255, 255, 0.65)  →  hover: rgba(255, 255, 255, 0.82)
Panel-border:           rgba(255, 255, 255, 0.45)
Blur:                   backdrop-filter: blur(40px) saturate(1.8)

Text primär:            #1d1d1f
Text sekundär:          #6e6e73
Text muted:             #86868b
Text disabled:          #aeaeb2
```

### Dokumenttyp-färger

Varje dokumenttyp har en egen färg. Används konsekvent i badges, ikoner, dots och card-accenter.

```
Receipt (kvitto):       #34c759  (Apple Green)
  bg: rgba(52,199,89, 0.10)   border: rgba(52,199,89, 0.22)   light: #f0faf2

Contract (avtal):       #5856d6  (Apple Indigo)
  bg: rgba(88,86,214, 0.10)   border: rgba(88,86,214, 0.22)   light: #f3f2fd

Invoice (faktura):      #ff375f  (Apple Pink)
  bg: rgba(255,55,95, 0.10)   border: rgba(255,55,95, 0.22)   light: #fef1f3

Meeting (möte):         #ff9f0a  (Apple Orange)
  bg: rgba(255,159,10, 0.10)  border: rgba(255,159,10, 0.22)  light: #fff8ed

Report (rapport):       #8e8e93  (Apple Gray)
  bg: rgba(142,142,147, 0.10) border: rgba(142,142,147, 0.22) light: #f4f4f5

Audio (ljud):           #30b0c7  (Apple Teal)
  bg: rgba(48,176,199, 0.10)  border: rgba(48,176,199, 0.22)  light: #eef9fb
```

### Tillstånds-färger

```
Processing (AI jobbar): #5856d6 → #af52de  (indigo → lila gradient)
Success (klart):        #34c759
Warning (bekräfta):     #ff9f0a
Error:                  #ff375f
```

### App-accent

```
Primär accent:          linear-gradient(135deg, #5856d6, #af52de)
Används i:              Logo, primära knappar, aktiv processing-indikator
```

---

## 2. Typografi

### Font-stack

```css
--font-body:  'SF Pro Display', -apple-system, 'Helvetica Neue', sans-serif;
--font-mono:  'SF Mono', 'Menlo', 'Consolas', monospace;
```

**VARFÖR systemfonts?** Noll laddtid. Native macOS-känsla. Perfekt rendering på Retina.
Inga Google Fonts, inga FOUT-blinkar.

### Skala

| Användning | Storlek | Vikt | Font | Tracking |
|------------|---------|------|------|----------|
| Sidtitel | 22px | 700 (Bold) | Body | -0.03em |
| Korttitel | 14px | 600 (Semibold) | Body | -0.01em |
| Brödtext | 13–14px | 400 (Regular) | Body | 0 |
| Label / sektion | 11px | 700 (Bold) | Body | 0.06em, UPPERCASE |
| Badge | 11px | 600 (Semibold) | Mono | 0.01em |
| Metadata | 11–12px | 500 (Medium) | Mono | 0 |
| Filsökväg | 12px | 400 (Regular) | Mono | 0 |
| Keyboard shortcut | 10–11px | 500 (Medium) | Mono | 0 |

---

## 3. Komponenter

### 3.1 Glass Panel — Grundbausten

Allt i appen byggs av GlassPanels. Kort, sidebar, detaljpanel, dropzone — alla är varianter.

```
┌─────────────────────────────────────┐
│  rgba(255,255,255, 0.65)            │  ← Halvtransparent vit
│  backdrop-filter: blur(40px)        │  ← Frostat glas
│  border: 1px solid rgba(…, 0.45)   │  ← Knappt synlig kant
│  border-radius: 16px               │  ← Mjukt runt
│  box-shadow: 0 4px 24px …0.04      │  ← Diffus skugga
│                                     │
│  Hover: bg → 0.82, skugga → 0.08   │  ← Subtil lift
│  Selected: border → accent, glow   │  ← Tydlig markering
└─────────────────────────────────────┘
```

### 3.2 Document Card

Varje dokument visas som ett kort i grid-vyn. Tre tillstånd:

**Idle (klassificerat):**
```
┌─────────────────────────────────────┐
│  [ikon]  ICA Maxi Kvitto      97%  │  ← Typ-färgad ikon + confidence
│                                     │
│  Matvarukvitto, 342 kr inkl moms    │  ← AI-genererad summary
│                                     │
│  [● receipt]              2026-03-01│  ← Badge + datum
│                           ✓ Sorted  │  ← Filstatus
└─────────────────────────────────────┘
```

**Processing (AI jobbar):**
```
┌─────────────────────────────────────┐
│  [ikon]  q1_rapport.docx           │
│                                     │
│  ◉ Classifying...                   │  ← Pulserande dot
│  ▓▓▓▓▓▓▓░░░░░░░░░░░░░░            │  ← Aurora gradient progress
└─────────────────────────────────────┘
```

**Hover:**
```
Background: rgba(255,255,255, 0.82)
Shadow: 0 8px 40px rgba(0,0,0, 0.08)
Transition: 250ms cubic-bezier(0.4, 0, 0.2, 1)
```

### 3.3 Badge

Liten pill som visar dokumenttyp. Alltid med färgad dot.

```
[● receipt]    →  grön dot + grön text + grön/transparent bg
[● contract]   →  lila dot + lila text + lila/transparent bg
```

Storlek: 11px, padding 3px 9px, border-radius 7px.

### 3.4 Toast / Notification

Visar filflyttningar. Dyker upp nere till höger, försvinner efter 6 sekunder.

```
┌─────────────────────────────────────────┐
│  [✓]  kvitto_ica.jpg sorted             │
│       ~/Kvitton/2026/03/ · 342 kr  [Undo]│
└─────────────────────────────────────────┘
```

- Frosted glass bakgrund
- Slide-up animation (350ms)
- Undo-knapp alltid synlig
- Stackar vertikalt om flera filer processas samtidigt

### 3.5 Prompt Bar / Smart Search

Inte en vanlig sökruta. Det här är RAG-porten.

```
┌──────────────────────────────────────────────┐
│  🔍  Vad letar du efter?                 ⌘K  │
└──────────────────────────────────────────────┘
```

**VARFÖR "Vad letar du efter?" istället för "Sök filer"?**

Systemet har LanceDB + Qwen 3.5 RAG. Användaren kan skriva:
- "När går hyresavtalet ut?" → RAG-svar: "2029-01-31, Fastighets AB"
- "Kvitton över 500 kr" → Filtrerad lista
- "Sammanfatta sprint 14" → AI-genererat svar från mötesanteckningar

Sökrutan ska kommunicera att du kan **fråga**, inte bara **söka**.

Interaktion:
1. Klicka eller ⌘K → fokus
2. Skriv fråga → debounce 300ms → skicka till /search
3. Resultat dyker upp i dropdown ELLER ersätter grid-vyn
4. Escape → tillbaka till normal vy

---

## 4. Vyer och Layout

### Övergripande struktur

```
┌──────────┬──────────────────────────────────┐
│          │  Top Bar (sök + ⌘K)              │
│ Sidebar  ├──────────────────────────────────┤
│ (230px)  │                                  │
│          │  Content Area                    │
│          │  (scrollable)                    │
│          │                                  │
│          │                                  │
│          │                                  │
└──────────┴──────────────────────────────────┘
```

Sidebar: Frosted glass, fast bredd, navigation + typ-filter.
Top Bar: Sökruta, alltid synlig.
Content: Växlar beroende på aktiv vy.

### 4.1 Drop Zone

Primär interaktionsyta för att mata in dokument.

```
┌─────────────────────────────────────────────┐
│  Drop Zone                                   │
│  Drop files to classify and organize         │
│                                              │
│  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
│  │                                         │ │
│  │        [↑]  Drop files here             │ │
│  │        PDF, DOCX, images, audio         │ │
│  │                                         │ │
│  │   .pdf  .docx  .jpg  .png  .mp3  .wav  │ │
│  │                                         │ │
│  └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
│                                              │
│  RECENT ACTIVITY                             │
│  ┌──────────────────────────────────────────┐│
│  │ ✓  kvitto_ica.jpg → ICA Maxi Kvitto  🟢││
│  │ ✓  hyresavtal.pdf → Hyresavtal        🟣││
│  │ ✓  meeting.mp3 → Sprint Planning      🟠││
│  └──────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

**Drop-hover state:**
- Border: dashed → solid, accent-färg (indigo)
- Ikon: grå → indigo, bakgrund får subtil glow
- Hela dropzone lyfts visuellt (shadow ökar)

**Processing state (efter drop):**
- Dropzonen försvinner inte — den visar realtidsflöde:
  "Analyserar kvitto_ica.jpg..." med aurora-glow
- Varje fil som klaras får en ✓ i Recent Activity

### 4.2 Documents (Grid)

Alla klassificerade dokument i ett responsivt grid.

```
┌──────────────────────────────────────────────┐
│  Documents                                    │
│  5 documents                                  │
│                                               │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐│
│  │ ICA Kvitto │ │ Hyresavtal │ │ Sprint 14  ││
│  │ 342 kr     │ │ 36 mån     │ │ 5 actions  ││
│  │ ● receipt  │ │ ● contract │ │ ● meeting  ││
│  └────────────┘ └────────────┘ └────────────┘│
│                                               │
│  ┌────────────┐ ┌────────────┐               │
│  │ Telia Fakt │ │ Q1 Rapport │               │
│  │ 899 kr     │ │ ◉ Process… │               │
│  │ ● invoice  │ │ ▓▓▓░░░░░░░ │               │
│  └────────────┘ └────────────┘               │
└──────────────────────────────────────────────┘
```

**Grid-beteende:**
- Utan detail panel: 3 kolumner
- Med detail panel: 2 kolumner (animerad övergång)
- Responsivt: 1–3 kolumner beroende på fönsterbredd

**Filtrering via sidebar:**
- Klicka "Receipts" → grid visar bara kvitton
- Badge-count i sidebar uppdateras i realtid

### 4.3 Detail Panel

Glider in från höger när du klickar ett kort. 420px bred.

```
                            ┌──────────────────┐
                            │ [×]              │
                            │ ICA Maxi Kvitto  │
                            │ 2026-03-01       │
                            │ [● receipt]      │
                            │                  │
                            │ SUMMARY          │
                            │ Matvarukvitto... │
                            │                  │
                            │ EXTRACTED FIELDS │
                            │ ┌──────────────┐ │
                            │ │vendor  ICA   │ │
                            │ │amount  342kr │ │
                            │ │vat     68kr  │ │
                            │ └──────────────┘ │
                            │                  │
                            │ TAGS             │
                            │ [mat] [kvitto]   │
                            │                  │
                            │ FILE LOCATION    │
                            │ ┌──────────────┐ │
                            │ │✓ Auto-sorted │ │
                            │ │~/Kvitton/... │ │
                            │ └──────────────┘ │
                            │                  │
                            │ [Open] [Similar] │
                            └──────────────────┘
```

**Animation:** slideIn 300ms, cubic-bezier(0.4, 0, 0.2, 1)
**Bakgrund:** Frosted glass med tyngre blur (60px) och subtil vänster-skugga
**Stäng:** ×-knapp eller klick utanför

### 4.4 Activity Log

Tidsordnad logg över allt som hänt. Varje entry har tidsstämpel, färgad dot, och mono-formaterad detalj.

```
14:23  🟢  Classified    kvitto_ica.jpg     receipt → ~/Kvitton/2026/03/
14:22  🟢  Vision OCR    kvitto_ica.jpg     Read 4 fields from image
14:20  🟣  Classified    hyresavtal.pdf     contract → ~/Avtal/Fastighets-AB/
14:18  🟠  Transcribed   meeting.mp3        12 min, Swedish, RTX 2060
14:15  🔴  Classified    telia_feb.pdf      invoice → ~/Fakturor/2026/
14:10  ⚪  Indexed       4 documents        23 chunks → LanceDB
```

Hela loggen är en GlassPanel med tunna separatorer.

---

## 5. Animationer och Micro-interactions

### Principer

1. **Snabba.** 150–300ms. Aldrig blockerande.
2. **Meningsfulla.** Varje animation kommunicerar något: "klar", "jobbar", "ny".
3. **Subtila.** Användaren ska känna dem, inte se dem.
4. **CSS-first.** Inga tunga JS-animationsbibliotek. CSS transitions + keyframes.

### Specificerade animationer

| Trigger | Animation | Timing | Easing |
|---------|-----------|--------|--------|
| Card hover | Bakgrund ljusnar, skugga ökar | 250ms | ease-out |
| Card klick → detail panel | Panel glider in från höger | 300ms | cubic-bezier(0.4,0,0.2,1) |
| Toast dyker upp | Slide up + fade in | 350ms | cubic-bezier(0.4,0,0.2,1) |
| Toast försvinner | Fade out + slide down | 250ms | ease-in |
| Dropzone hover | Border-färg + ikon-färg + glow | 200ms | ease-out |
| Fil processas | Pulserande dot (opacity 1→0.3→1) | 1400ms loop | ease-in-out |
| Progress bar | Gradient sweep (translateX) | 2000ms loop | ease-in-out |
| Grid kolumn-byte (2↔3) | Smooth reflow | 250ms | ease |
| Sidebar nav active | Bakgrund fade | 150ms | ease |

### Aurora Processing Glow — Den enda "spektakulära" animationen

När AI:n jobbar (processing state) ska det synas — men subtilt.

**Koncept:** En mjuk gradient som sveper över progress-baren, inspirerad av norrsken.

```css
@keyframes aurora {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.processing-bar {
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    #5856d6 25%,
    #af52de 50%,
    #5856d6 75%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: aurora 2.5s ease-in-out infinite;
}
```

**VARFÖR bara progress-baren?** Gemini föreslog att hela appen skulle glöda som Siri.
Det är snyggt i en keynote-demo, men distraherande i verkligheten.
En 3px aurora-bar kommunicerar "AI jobbar" utan att skrika.

---

## 6. The Orb — Kompakt Läge (Fas 4+)

### Geminis idé, nedskalad till verklighet

Gemini föreslog en "Dynamic Island"-liknande flytande orb.
**Bra koncept, men:** Dynamic Island kräver OS-nivå integration som Tauri inte har.

### Realistisk implementation: System Tray + Hotkey

```
┌──────────────────────────────────────┐
│  STEG 1: App minimerad               │
│                                       │
│  System tray: [A] ikon                │
│  Hotkey: ⌘+Shift+D → öppna dropzone  │
│                                       │
│  STEG 2: Dra filer till tray-ikon     │
│  (Tauri 2.0 stödjer drag-to-tray)    │
│                                       │
│  STEG 3: Tray visar mini-notification │
│  "3 filer processas..."               │
│  "✓ 2 kvitton sorterade"              │
│                                       │
│  STEG 4: Klicka notification          │
│  → Appen öppnas med resultat          │
└──────────────────────────────────────┘
```

**VARFÖR inte en flytande widget?**
- macOS Sonoma+ begränsar overlay-fönster
- Tauri 2.0 har bra tray-stöd men begränsat "always-on-top" widget-stöd
- System tray är det som faktiskt funkar cross-platform

**Framtida upgrade:** Om Tauri får bättre widget-API → bygg "The Pill" som en
alltid-synlig mini-dropzone. Men det är v5+, inte v4.

---

## 7. Sök-resultat UX — Smart Search

### Tre typer av svar

Prompt Bar returnerar olika resultat beroende på frågan:

**Typ 1: Direkt svar (RAG)**
Fråga: "När går hyresavtalet ut?"

```
┌──────────────────────────────────────────────┐
│  💬  Hyresavtalet med Fastighets AB löper ut │
│      2029-01-31. Uppsägningstid: 6 månader.  │
│                                               │
│  Baserat på:                                  │
│  ┌──────────────────────────────────────────┐ │
│  │ [📄] Hyresavtal Fastighets AB           │ │
│  │      2026-01-15 · contract              │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**Typ 2: Filtrerad lista**
Fråga: "kvitton mars"

```
┌──────────────────────────────────────────────┐
│  3 results for "kvitton mars"                 │
│                                               │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐│
│  │ ICA 342kr  │ │ Coop 189kr │ │ Biltema 95 ││
│  └────────────┘ └────────────┘ └────────────┘│
└──────────────────────────────────────────────┘
```

**Typ 3: Sammanfattning**
Fråga: "sammanfatta sprint 14"

```
┌──────────────────────────────────────────────┐
│  💬  Sprint 14 Planning (2026-02-28)          │
│                                               │
│  3 beslut:                                    │
│  • Byta till Qwen 3.5 9B                  │
│  • Deadline för MVP: 15 mars                  │
│  • Anna ansvarar för testning                 │
│                                               │
│  5 action items tilldelade.                   │
│                                               │
│  Baserat på:                                  │
│  [🎤] Sprint Planning Notes                   │
└──────────────────────────────────────────────┘
```

---

## 8. Responsivt beteende

### Fönsterstorlekar

| Bredd | Grid-kolumner | Sidebar | Detail Panel |
|-------|--------------|---------|-------------|
| > 1400px | 3 | Synlig (230px) | Overlay (420px) |
| 1000–1400px | 2 | Synlig (230px) | Overlay (420px) |
| 800–1000px | 2 | Kompakt (ikoner, 60px) | Fullbredd |
| < 800px | 1 | Gömd (hamburger) | Fullbredd |

Tauri-appen har minimum-storlek 800×600.

---

## 9. Dark Mode (Sekundärt tema)

Inte prioriterat i v4, men designen ska stödja det via CSS-variabler.

```
Light (primary):
  --bg-gradient:    #f5f0ec → #e8e3f3 → #dce8f5
  --glass-bg:       rgba(255,255,255, 0.65)
  --glass-border:   rgba(255,255,255, 0.45)
  --text-primary:   #1d1d1f
  --text-secondary: #6e6e73

Dark (future):
  --bg-gradient:    #0a0a0c → #12101a → #0d1117
  --glass-bg:       rgba(30,30,34, 0.65)
  --glass-border:   rgba(255,255,255, 0.08)
  --text-primary:   #fafafa
  --text-secondary: #a1a1aa
```

**VARFÖR CSS-variabler från start?** Kostar noll effort nu, sparar en veckas refactor senare.

---

## 10. Geminis idéer — Vad som togs med, vad som sköts upp

| Geminis förslag | Status | Motivering |
|-----------------|--------|------------|
| Frosted Glass material | ✅ **Tagen** | Kärnan i vår design |
| "Midnight Frost" (mörkt tema) | ⏸️ **Uppskjuten** | Simon valde ljust. Dark mode som option, inte primary. |
| Aurora processing-glow | ✅ **Tagen (nedskalad)** | Bara på progress-bar, inte hela appen |
| "The Orb" / Dynamic Island | ⏸️ **Fas 4+ som System Tray** | Tauri saknar OS-widget API. Tray funkar. |
| "The Canvas" med Prompt Bar | ✅ **Tagen** | "Vad letar du efter?" — perfekt RAG-UX |
| Liquid UI Cards | ✅ **Tagen** | Vackra kort med typ-specifik layout |
| Focus View (split-screen) | ⏸️ **v5** | Scope creep. Detail panel räcker för v4. |
| AI-genererade action-knappar per dokument | ⏸️ **v5+** | Kräver n8n/kalender-integration. Cool men för tidigt. |
| Siri-liknande skärmkants-glow | ❌ **Struken** | Distraherande i daglig användning. |
| Ljudspelare med vågform i kort | ⏸️ **Fas 5** | Kräver Web Audio API, inte kritiskt för MVP. |
| Automatisk logotyp-visning (ICA, Telia) | ⏸️ **v5+** | Kräver logo-API eller bildmatchning. Nice-to-have. |

---

## 11. Implementation med Antigravity

Simon har tillgång till Google Antigravity som kan accelerera UI-bygget.

### Rekommenderat arbetsflöde

```
1. Ge Antigravity denna design-spec som kontext
2. Låt agenten scaffolda React-komponenter i Tauri-projektet
3. Iterera visuellt — agentens browser-agent kan testa i realtid
4. Finjustera manuellt — färger, spacing, timing

Antigravity gör:     Scaffolding, CSS-implementering, responsiv layout
Simon gör:           Design-beslut, UX-flöden, kvalitetskontroll
Claude/Qwen 3.5:    Backend-logik, API-integration, RAG-sökning
```

**VARNING:** Antigravity tenderar att överdesigna. Ge den denna spec som constraint.
Om den föreslår Three.js-bakgrunder eller partikelsystem — säg nej.

---

## 12. Designtokens — Redo för Implementation

```css
:root {
  /* Layout */
  --sidebar-width: 230px;
  --topbar-height: 54px;
  --detail-panel-width: 420px;
  --card-radius: 16px;
  --badge-radius: 7px;
  --button-radius: 10px;

  /* Glass */
  --glass-bg: rgba(255, 255, 255, 0.65);
  --glass-bg-hover: rgba(255, 255, 255, 0.82);
  --glass-border: rgba(255, 255, 255, 0.45);
  --glass-blur: blur(40px) saturate(1.8);
  --glass-shadow: 0 4px 24px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.04);
  --glass-shadow-hover: 0 8px 40px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.06);

  /* Background */
  --bg-gradient: linear-gradient(145deg, #f5f0ec 0%, #e8e3f3 30%, #dce8f5 55%, #f0ece5 80%, #ece5f0 100%);

  /* Text */
  --text-primary: #1d1d1f;
  --text-secondary: #6e6e73;
  --text-muted: #86868b;
  --text-disabled: #aeaeb2;

  /* Accent */
  --accent-gradient: linear-gradient(135deg, #5856d6, #af52de);
  --accent-primary: #5856d6;

  /* Document type colors */
  --receipt-color: #34c759;
  --contract-color: #5856d6;
  --invoice-color: #ff375f;
  --meeting-color: #ff9f0a;
  --report-color: #8e8e93;
  --audio-color: #30b0c7;

  /* Animation */
  --transition-fast: 150ms ease;
  --transition-normal: 250ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-smooth: 300ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slide: 350ms cubic-bezier(0.4, 0, 0.2, 1);

  /* Typography */
  --font-body: 'SF Pro Display', -apple-system, 'Helvetica Neue', sans-serif;
  --font-mono: 'SF Mono', 'Menlo', 'Consolas', monospace;
}
```

---

*Agentic Docs Handler — Design Specification v1*
*Frost Glass, ljust tema, macOS-native, inga drömmar — bara byggbart.*
