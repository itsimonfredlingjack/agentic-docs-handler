# Metamorfos — Dokumentet som bygger sig självt

## Produktfilosofi

- Dokument är levande miniappar, inte döda filer
- AI-magi sker vid uppladdning, inte vid sökning
- Väntetid är en show — processing ska kännas visuellt magisk
- Felkorrigering är inline, friktionsfritt, ett klick

## Vision

När ett dokument laddas upp startar en visuell metamorfos i ProcessingRail:

### Fas 1: Scan
- Ett tomt, halvgenomskinligt kort dyker upp
- Originaldokumentet syns som en suddig spökbild inuti kortet
- En ljusstråle sveper över — OCR/läsning pågår

### Fas 2: Klassificering
- Kortets kanter börjar skifta färg (orange/blå/grön fladdrar)
- Kortet bestämmer sig — färgen LÅSER
- Kortet byter fysisk form baserat på typ:
  - Kvitto: smalt och långt (termopapper)
  - Kontrakt: brett och formellt
  - Faktura: standardformat med framträdande belopp
  - Ljud: vågformssilhuett

### Fas 3: Extraktion — Ghost Typing
- Ovanpå spökbilden skriver extraherade fält sig själva
- Ghost-typing, tecken för tecken med markör
- "Telia · 4 200 kr · 2026-03-01" materialiseras
- Varje fält glöder svagt vid ankomst
- För ljud: live-transkriptionsord dyker upp i takt

### Fas 4: Komplett
- Spökbilden tonar bort
- Kvar: ett rent, designat kort — AI:ns förståelse renderad visuellt
- Kort "completion receipt"-animation
- Kortet glider från ProcessingRail ner i dokumentflödet

### Fas 5: Inline felkorrigering
- Tryck på valfritt extraherat fält → redigerbart inline
- Tryck på typbadge → radialmeny med alternativa typer
- Ett klick, klart — inget formulär, inget modalt fönster

## Tekniska förutsättningar

- ProcessingRail finns redan med modality-animationer
- WebSocket-events levererar stage-by-stage progress (job.started → job.progress → job.completed)
- CSS keyframe-animationer och custom properties finns i designsystemet
- Zustand store har stageHistory per requestId
- Backend extraherar fält som redan skickas till frontend

## Vad som behöver byggas

- Ghost typing animation-system (tecken-för-tecken reveal)
- Formskiftande kortvarianter per dokumenttyp (CSS morphing)
- Spökbild/thumbnail av originaldokument (kräver backend-stöd för thumbnail)
- Radialmeny för typkorrigering
- Inline fältredigering i dokumentkort
- Utökade WebSocket-events för fält-för-fält extraktion (om möjligt)
