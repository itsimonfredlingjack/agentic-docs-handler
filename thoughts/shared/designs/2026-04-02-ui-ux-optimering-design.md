---
date: 2026-04-02
topic: "UI/UX fullbordan för Brainfileing"
status: validated
---

## Problem Statement

Vi har en stark produktkärna (workspace-first, AI-stöd, realtidsflöden), men användarupplevelsen känns ännu inte helt sammanhållen i alla viktiga vardagsflöden.

Det största hindret är inte brist på funktioner, utan brist på konsekvens och tydlig feedback i gränssnittet.

Målet är att göra appen upplevt “klar”: tydlig, snabb, förutsägbar och trygg även när nätverk, klassificering eller bakgrundsjobb strular.

## Constraints

- Appen måste behålla regeln om **en och samma layout** i alla tillstånd.
- Backend-arkitekturen och pipeline-lagret ska inte ändras i onödan för UI/UX-arbetet.
- Lösningen ska fungera med nuvarande stack (React 19, Zustand, Tauri, FastAPI, WebSocket + SSE).
- Vi ska återanvända befintliga design tokens och undvika redesign från noll.
- Förändringar ska vara inkrementella så att vi kan leverera värde per steg.

## Approach

Vi valde en **”Foundation + Flöden”-strategi**: först standardiserar vi UI-grunderna, sedan förfinar vi de mest kritiska användarresorna.

### Alternativ vi övervägde

1. **Snabb kosmetisk polish**
   - Fördel: Snabb leverans och låg risk.
   - Nackdel: Löser inte de underliggande problemen med inkonsekvens och otydlig interaktion.

2. **Foundation + Flöden (valt)**
   - Fördel: Ger både snabb förbättring i upplevd kvalitet och långsiktig skalbarhet.
   - Nackdel: Kräver mer disciplin och tydlig prioritering.

3. **Total redesign**
   - Fördel: Kan ge maximalt visuellt lyft.
   - Nackdel: För hög risk, lång ledtid och onödigt stor förändring för nuvarande produktfas.

### Varför detta val

Den valda vägen ger bäst balans mellan leveranshastighet, risk och faktisk användarnytta.
Vi får en app som känns färdig utan att stoppa utvecklingstakten.

## Architecture

UX-arkitekturen delas i tre lager som bygger på befintlig kodbas:

1. **UI Foundation Layer**
   - Gemensamma regler för knappar, kort, tomlägen, statusindikatorer och fokusbeteenden.
   - En enda källa för visuella beslut via befintliga tokens.

2. **Interaction Layer**
   - Tydliga tillstånd för chat-läge (workspace vs dokument), sök, flytt-flöden och bakgrundsjobb.
   - Konsekvent feedback för loading, success, warning och failure.

3. **Experience Layer**
   - Prioriterade användarresor: Inbox triage, Workspace arbete, Chat/Search och Discovery.
   - Förutsägbara mikrointeraktioner och keyboard-first stöd.

## Components

### 1) Design System-primitiver

Ansvar: eliminera visuella variationer som inte tillför värde.

- Standard för knappvarianter och storlekar
- Standard för kort/paneler och tomlägen
- Standard för status badges och progressindikatorer

### 2) UX State Contract

Ansvar: göra tillstånd explicit och begripligt i UI.

- Tydlig markering av aktivt chat-läge
- Enhetliga regler för när vi visar placeholder, skeleton och resultat
- Förutsägbara transitions mellan “väntar”, “klart”, “fel”

### 3) Inbox Triage Flow

Ansvar: snabb och trygg organisering av dokument till workspaces.

- Tydlig destinationsfeedback före/efter flytt
- Undo-first mönster för felaktiga flyttar
- Klara nästa-steg-signaler efter varje åtgärd

### 4) Workspace Chat & Search Flow

Ansvar: minska kognitiv last och öka precision.

- Synlig kontext för vad svaret baseras på
- Tydlig skillnad mellan “inga dokument” och “inga träffar”
- Stabil återhämtning vid tillfälliga anslutningsproblem

### 5) Reliability & Accessibility Layer

Ansvar: robust användbarhet även under stress.

- Global anslutningsindikator med tydliga tillstånd
- Konsekventa keyboard-shortcuts och fokusordning
- Läslighets- och kontrastnivåer enligt tillgänglighetsmål

## Data Flow

Vi använder samma tekniska dataflöden, men med tydligare UX-kontrakt ovanpå:

1. **User Intent**
   - Användaren initierar handling i Inbox, Workspace, Chat eller Search.

2. **State Transition**
   - UI state uppdateras direkt till ett explicit “working” tillstånd.

3. **Backend Interaction**
   - HTTP används för kommandon/sökningar.
   - WebSocket/SSE används för progress, stream och återkoppling.

4. **Result Mapping**
   - Svaret mappas till tydligt resultat: success, partial, empty, failed.

5. **Recovery Path**
   - UI visar nästa bästa handling: retry, undo, byt kontext, eller fortsätt.

## Error Handling

Felhantering designas i tre nivåer med konsekventa UI-regler:

### 1) Action-level errors

När en specifik handling misslyckas (exempelvis flytt):

- Visa direkt fel vid handlingens yta
- Behåll användarens kontext
- Erbjud omedelbar retry eller undo

### 2) Flow-level errors

När ett helt flöde störs (exempelvis chat/sök):

- Tydlig statusrad för flödet
- Bevara tidigare innehåll i stället för tom skärm
- Visa rekommenderat nästa steg

### 3) System-level errors

När anslutning eller backend påverkas brett:

- Global anslutningsindikator med begriplig status
- Graceful degradation (läsbart läge i stället för trasigt läge)
- Automatisk återhämtning när tjänster kommer tillbaka

## Testing Strategy

Vi verifierar designen med en kombination av produktkvalitet, interaktionskvalitet och upplevd kvalitet.

### 1) UX Acceptance Matrix

- Inbox: flytt, undo, felhantering, nästa steg
- Workspace: tomläge, aktivt arbete, växling mellan dokument
- Chat/Search: kontexttydlighet, tomträffar, återhämtning

### 2) Consistency Audits

- Visuell audit av knapp-, kort-, badge- och empty state-mönster
- Kontroll av typografi, spacing och kontrast mot tokens
- Fokus- och keyboard-path audit för primära flöden

### 3) Reliability Scenarios

- Simulera tappad WebSocket/SSE
- Simulera långsam klassificering/stream
- Verifiera att användaren alltid får begriplig status och nästa steg

### 4) Outcome Metrics

- Kortare tid från ingest till korrekt workspace
- Färre felaktiga flyttar och färre omtag
- Högre andel lyckade chat/sök-interaktioner utan avbrott

## Open Questions

- Ska vi prioritera ett kompakt “power user”-läge tidigt eller senare?
- Hur mycket av statusdetaljer ska visas direkt vs i en fördjupad vy?
- Vilken nivå av mikroanimation ger bäst tydlighet utan visuell stress?
- Behöver vi ett lättviktigt onboarding-flöde för första workspace?
