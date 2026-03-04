# Agentic Docs Handler — Arkitektur-Blueprint v4.1

**Lokal AI-driven dokumenthantering med generativt gränssnitt + automatisk filsortering**
*Stack: Tauri 2.0 · React · LanceDB · Qwen 3.5 9B via Ollama · RTX 4070 + RTX 2060*

---

## 0. Designbeslut

### En LLM, Två GPU:er, En Enkel Runtime

| Komponent | Modell | Runtime | Maskin | VRAM |
|-----------|--------|---------|--------|------|
| LLM + Vision (klassificering + extraktion + RAG + OCR) | **Qwen 3.5 9B** Q4_K_M | **Ollama** | RTX 4070 | **~6.6GB** |
| Embedding (sökning) | nomic-embed-text v1.5 | **sentence-transformers** (Python) | RTX 4070 CPU | ~300MB RAM |
| Audio-transkription | Whisper large-v3-turbo | **faster-whisper** | RTX 2060 | ~1.5GB |

**Alla modeller körs lokalt. LLM är `qwen3.5:9b` via Ollama, embeddings är `nomic-embed-text`, och audio körs via Whisper på separat nod.**

### v3 → v4: Vad ändrades och VARFÖR

| Ändring | v3 | v4 | VARFÖR |
|---------|----|----|--------|
| LLM | GPT-OSS 20B (OpenAI) | **Qwen 3.5 9B** | Inbyggd vision, native JSON, mindre VRAM |
| OCR | Tesseract (separat steg) | **Eliminerad** — vision-modellen läser bilder direkt | Enklare pipeline, bättre precision |
| JSON output | GBNF grammar (workaround) | **Native function calling** + GBNF som säkerhetsnät | Qwen 3.5 har inbyggt stöd |
| Runtime | llama-server (krävdes pga GPT-OSS) | **Ollama 0.13.1+** (enklare, vision funkar direkt) | Färre rörliga delar, snabbare setup |
| VRAM | ~11GB (1GB marginal) | **~6.6GB (god marginal)** | Mer headroom för samtidiga andra workloads |
| Filsortering | Saknas | **Ny: automatisk filorganisering** | Klassificering → flytta fil till rätt mapp |
| Driftmodell | Extern modellstack | **Lokal Ollama-modell** | Enklare drift och lägre latency |

### VARFÖR Qwen 3.5 9B?

1. **Vision-modell**: 13.5B language + 0.4B Vision Transformer = native bildförståelse
   - Läser kvitton, skannade kontrakt, fotografier direkt
   - Eliminerar Tesseract OCR helt — en komponent mindre att underhålla
2. **Native function calling**: Designad för agentic tasks med strukturerad JSON-output
   - Inget behov av GBNF grammar-workarounds (behålls som backup)
3. **Effektiv**: Q4_K_M kvantisering → ~6.6GB VRAM
   - Lägre VRAM-tryck än tidigare 14B-spåret och bättre fit för RTX 4070
4. **Lokalt körbar**: En lättare modell gör att resten av stacken får bättre headroom
5. **40+ språk**: Native svenska, engelska, och mer

### VARFÖR Ollama istället för llama-server?

I v3 var llama-server nödvändigt pga GPT-OSS 20B:s buggiga structured output via Ollama.
Qwen 3.5 9B har **native function calling** — Ollamas structured output funkar korrekt.

| Feature | Ollama | llama-server |
|---------|--------|-------------|
| Vision-stöd | ✅ Direkt (fused GGUF) | ✅ Via llama-mtmd-cli |
| JSON output | ✅ `format: json` + native tool calling | ✅ GBNF grammar |
| Setup-komplexitet | `ollama pull qwen3.5:9b` | Bygg från source, ladda GGUF manuellt |
| API-kompatibilitet | OpenAI-kompatibelt | OpenAI-kompatibelt |
| Model management | Inbyggt | Manuellt |
| **Vinnare** | **✅ Enklare, allt funkar** | Mer kontroll, men onödigt för denna modell |

**Fallback**: Om Ollamas JSON-output visar sig opålitligt → byt till llama-server med GBNF.
Arkitekturen är identisk — bara base_url ändras.

### VARFÖR sentence-transformers istället för Ollama?

Oförändrad från v3: Orchestratorn är Python (FastAPI). Att köra embedding direkt i Python
eliminerar HTTP-overhead. LanceDB har inbyggd integration med sentence-transformers.

### VARFÖR RTX 2060 som dedikerad Whisper-nod?

Oförändrad från v3: Whisper large-v3-turbo drar ~1.5GB VRAM. RTX 2060 (6GB) har marginal.
Frigör RTX 4070 helt för LLM — parallell bearbetning av ljud + dokument.

---

## 1. Systemarkitektur — Dual Server + Filorganisering + ChatGPT MCP

```
┌──────────────────────────────────────────────────────┐
│  TAURI APP (MacOS)                                    │
│  React Frontend + Rust Backend                        │
└──────────────────────┬───────────────────────────────┘
                       │ WebSocket
                       │
┌──────────────────────────────────────────────────────┐
│  ChatGPT / MCP Client                                 │
│  docsgpt.fredlingautomation.dev/mcp                   │
└──────────────────────┬───────────────────────────────┘
                       │ MCP (Streamable HTTP)
                       │
┌──────────────────────▼───────────────────────────────┐
│  PRIMÄR SERVER — RTX 4070 (12GB VRAM, Linux)          │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Ollama (port 11434)                            │ │
│  │  └─ Qwen 3.5 9B Instruct Q4_K_M (~9GB)     │ │
│  │     • Native vision (bilder direkt)             │ │
│  │     • Native function calling (JSON)            │ │
│  │     • OpenAI-compatible /v1/chat/completions    │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  FastAPI Orchestrator (Python, port 9000)        │ │
│  │  ├─ /process    → klassificera + extrahera       │ │
│  │  ├─ /search     → hybrid RAG-sökning             │ │
│  │  ├─ /mcp        → ChatGPT tools                  │ │
│  │  ├─ /transcribe → proxy till Whisper-server      │ │
│  │  ├─ /organize   → flytta fil till rätt mapp      │ │
│  │  ├─ /action     → utför action (mail, kalender)  │ │
│  │  └─ /ws         → WebSocket status-streaming     │ │
│  │                                                   │ │
│  │  In-process:                                      │ │
│  │  ├─ sentence-transformers (nomic-embed-text, CPU) │ │
│  │  ├─ LanceDB (embedded, disk)                      │ │
│  │  └─ FileOrganizer (regelbaserad filflyttning)     │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
                       │
                       │ HTTP (intern, LAN)
                       │
┌──────────────────────▼───────────────────────────────┐
│  AUDIO SERVER — RTX 2060 (6GB VRAM, Linux)            │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  faster-whisper API (port 8090)                  │ │
│  │  └─ Whisper large-v3-turbo  (~1.5GB VRAM)       │ │
│  │     • Svenska + Engelska                         │ │
│  │     • Returnerar: text, timestamps, language     │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Nätverkstopologi

```
Mac (Tauri) ──WebSocket──▶ RTX 4070:9000 (FastAPI)
ChatGPT ──MCP──▶ docsgpt.fredlingautomation.dev/mcp ──▶ RTX 4070:9000/mcp
                                  │
                                  ├──HTTP──▶ localhost:11434 (Ollama)
                                  ├──Python──▶ sentence-transformers (in-process)
                                  ├──Python──▶ LanceDB (in-process)
                                  ├──Python──▶ FileOrganizer (in-process)
                                  └──HTTP──▶ RTX 2060:8090 (faster-whisper)
```

**Både Tauri och ChatGPT pratar BARA med FastAPI på 4070.** Orchestratorn routar internt.

### 1.1 ChatGPT MCP Tool Surface

| Tool | Typ | Wrappar pipeline/service |
|------|-----|--------------------------|
| `search` | Read | Repo-kunskapsdokument i `AppServices.documents` |
| `search_documents` | Read | `server/pipelines/search.py` |
| `fetch` | Read | Repo-kunskapsdokument i `AppServices.documents` |
| `classify_text` | Read | `server/pipelines/classifier.py` |
| `classify_image` | Read | `server/pipelines/classifier.py` |
| `extract_fields` | Read | `server/pipelines/extractor.py` |
| `preview_document_processing` | Read | `server/pipelines/process_pipeline.py` |
| `list_file_rules` | Read | `server/pipelines/file_organizer.py` |
| `get_system_status` | Read | FastAPI readiness + config |
| `get_validation_report` | Read | Valideringsrapport från disk |
| `get_activity_log` | Read | Logg-loader i `AppServices` |
| `organize_file` | Write | `server/pipelines/process_pipeline.py` + `file_organizer.py` |

**Arkitekturregel:** `mcp/*` importerar från `pipelines/*`. `pipelines/*` importerar aldrig från `mcp/*` eller `main.py`.

---

## 2. Qwen 3.5 9B via Ollama

### Setup

```bash
# Installera/uppdatera Ollama (kräver 0.13.1+)
curl -fsSL https://ollama.ai/install.sh | sh

# Dra ner modellen — EN modell för ALLA uppgifter
ollama pull qwen3.5:9b

# Verifiera vision
ollama run qwen3.5:9b "beskriv vad du ser" ./test_kvitto.jpg
```

**VARFÖR qwen3.5:9b?**
- Fused GGUF: text + vision-vikter i samma fil
- ~9GB VRAM med Q4_K_M kvantisering
- 3GB marginal på RTX 4070 (12GB) för KV-cache

### En modell, många uppgifter — via system-prompts

Du behöver INTE kopiera modellen. Samma vikter i VRAM hanterar alla uppgifter.
Det som bestämmer beteendet är **system-prompten** vid varje API-anrop:

```
EN modell i VRAM (~9GB)
  │
  ├── Anrop 1: system_prompt = "Klassificera dokument → JSON"
  │   → KLASSIFICERING
  │
  ├── Anrop 2: system_prompt = "Extrahera alla fält → JSON"
  │   → EXTRAKTION
  │
  ├── Anrop 3: system_prompt = "Analysera sökresultat → svar"
  │   → RAG-SVAR
  │
  └── Anrop 4: system_prompt = "Beskriv bilden → JSON"
      → VISION/OCR
```

### Valfritt: Ollama Modelfile-alias

Om du vill ha namngivna "roller" (noll extra diskutrymme — delar vikter):

```dockerfile
# classifier.Modelfile
FROM qwen3.5:9b
SYSTEM """Du är en dokumentklassificerare. Analysera dokumentet och returnera JSON med:
document_type, template, title, summary, tags, language, confidence.
Svara BARA med JSON, inget annat."""
PARAMETER temperature 0.1
PARAMETER num_predict 2048
```

```dockerfile
# extractor.Modelfile
FROM qwen3.5:9b
SYSTEM """Du extraherar strukturerad data från dokument. Returnera JSON med alla
relevanta fält baserat på dokumenttyp. Var noggrann med datum, belopp, namn."""
PARAMETER temperature 0.1
PARAMETER num_predict 4096
```

```bash
ollama create classifier -f classifier.Modelfile
ollama create extractor -f extractor.Modelfile

# Dessa delar SAMMA vikter — noll extra VRAM eller disk
# Ollama laddar bara en modell åt gången i VRAM
```

### Python-klient — Vision + Text

```python
from openai import OpenAI
import base64
import json

# Ollama exponerar OpenAI-kompatibelt API
llm = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")


def classify_document(text: str) -> dict:
    """Klassificera textdokument via Qwen 3.5."""
    response = llm.chat.completions.create(
        model="qwen3.5:9b",
        messages=[
            {
                "role": "system",
                "content": (
                    "Du klassificerar dokument. Svara BARA med JSON.\n"
                    "Schema: {document_type, template, title, summary, "
                    "tags[], language, confidence, extracted_fields{}, "
                    "suggested_actions[]}"
                )
            },
            {
                "role": "user",
                "content": f"Klassificera detta dokument:\n\n{text[:4000]}"
            }
        ],
        response_format={"type": "json_object"},  # Native JSON mode
        temperature=0.1,
    )
    return json.loads(response.choices[0].message.content)


def classify_image(image_bytes: bytes) -> dict:
    """Klassificera bild via Qwen 3.5 Vision — INGEN Tesseract behövs."""
    b64 = base64.b64encode(image_bytes).decode("utf-8")

    response = llm.chat.completions.create(
        model="qwen3.5:9b",
        messages=[
            {
                "role": "system",
                "content": (
                    "Du analyserar bilder av dokument. Läs ALL text i bilden. "
                    "Klassificera och extrahera alla fält. Svara BARA med JSON.\n"
                    "Schema: {document_type, template, title, summary, "
                    "tags[], language, confidence, extracted_fields{}, "
                    "ocr_text, suggested_actions[]}"
                )
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{b64}"
                        }
                    },
                    {
                        "type": "text",
                        "text": "Analysera denna bild. Läs all text och klassificera dokumentet."
                    }
                ]
            }
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    return json.loads(response.choices[0].message.content)


def extract_fields(text: str, doc_type: str) -> dict:
    """Djup extraktion med typ-specifik prompt."""
    prompts = {
        "receipt": "Extrahera: amount, currency, date, vendor, category, vat_amount, items[]",
        "contract": "Extrahera: parties[], start_date, end_date, termination_clause, value",
        "invoice": "Extrahera: invoice_number, amount, due_date, sender, recipient, items[]",
        "meeting_notes": "Extrahera: date, participants[], decisions[], action_items[], next_meeting",
    }

    response = llm.chat.completions.create(
        model="qwen3.5:9b",
        messages=[
            {
                "role": "system",
                "content": "Du extraherar strukturerad data. Svara BARA med JSON."
            },
            {
                "role": "user",
                "content": f"{prompts.get(doc_type, 'Extrahera alla nyckelfält.')}\n\n{text}"
            }
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    return json.loads(response.choices[0].message.content)
```

### GBNF Grammar — Säkerhetsnät (valfritt)

Om du vill ha 100% garanterad JSON (belt-and-suspenders):

```bash
# Byt till llama-server istället för Ollama
# Ladda ner fused GGUF
./llama-server \
  -hf unsloth/Qwen 3.5-3-14B-Instruct-2512-GGUF:Q4_K_XL \
  --ctx-size 32768 \
  --jinja \
  -ngl 99 \
  -fa \
  --temp 0.15 \
  --port 8080

# Använd GBNF grammar vid anrop (samma som v3)
# extra_body={"grammar_file": "grammars/document_classification.gbnf"}
```

Arkitekturen är identisk — bara `base_url` ändras från Ollama till llama-server.

---

## 3. Automatisk Filorganisering — NYTT i v4

### VARFÖR?

Klassificering utan handling är bara metadata. Användaren droppar en fil →
systemet vet att det är ett kvitto → systemet FLYTTAR filen till rätt mapp.

### Flöde

```
DROPZONE: kvitto_ica_mars.jpg
  ↓
Qwen 3.5 9B (vision + klassificering)
  ↓
Klassificering: {
  document_type: "receipt",
  extracted_fields: {
    vendor: "ICA Maxi",
    date: "2026-03-01",
    amount: 342.50,
    currency: "SEK"
  }
}
  ↓
FILE ORGANIZER (regelbaserat)
  ↓
Destination: ~/Dokument/Kvitton/2026/03/2026-03-01_ICA-Maxi_342kr.jpg
  ↓
WebSocket → Tauri: {action: "file_moved", from: "...", to: "..."}
```

### Konfiguration — YAML-regler

```yaml
# file_rules.yaml — Användaren konfigurerar i appen
base_path: ~/Dokument

rules:
  receipt:
    pattern: "{base_path}/Kvitton/{year}/{month}/{date}_{vendor}_{amount}kr.{ext}"
    auto_move: true          # Flytta automatiskt utan bekräftelse
    
  invoice:
    pattern: "{base_path}/Fakturor/{year}/{date}_{sender}_{amount}kr.{ext}"
    auto_move: true
    
  contract:
    pattern: "{base_path}/Avtal/{vendor}/{date}_{title}.{ext}"
    auto_move: false          # Fråga användaren först
    
  meeting_notes:
    pattern: "{base_path}/Möten/{year}/{month}/{date}_{title}.{ext}"
    auto_move: true
    
  report:
    pattern: "{base_path}/Rapporter/{year}/{title}.{ext}"
    auto_move: false
    
  letter:
    pattern: "{base_path}/Brev/{year}/{date}_{title}.{ext}"
    auto_move: true
    
  unknown:
    pattern: "{base_path}/Osorterat/{original_filename}"
    auto_move: true           # Samla i en mapp istället för att ligga kvar

defaults:
  create_dirs: true           # Skapa mappar automatiskt
  overwrite: false            # Aldrig skriv över — lägg till suffix
  keep_original: false        # Ta bort original efter flytt
  log_moves: true             # Logga alla filflyttar
```

### Python Implementation

```python
# server/pipelines/file_organizer.py
import yaml
import shutil
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass
import re
import logging

logger = logging.getLogger(__name__)


@dataclass
class MoveResult:
    success: bool
    source: str
    destination: str
    auto_moved: bool
    needs_confirmation: bool = False
    error: str | None = None


class FileOrganizer:
    def __init__(self, config_path: str = "file_rules.yaml"):
        with open(config_path) as f:
            self.config = yaml.safe_load(f)
        self.base_path = Path(self.config["base_path"]).expanduser()
    
    def plan_move(self, source_path: str, classification: dict) -> MoveResult:
        """Planera var filen ska hamna baserat på klassificering."""
        doc_type = classification.get("document_type", "unknown")
        fields = classification.get("extracted_fields", {})
        
        rule = self.config["rules"].get(doc_type, self.config["rules"]["unknown"])
        pattern = rule["pattern"]
        
        # Bygg destination från pattern + extraherade fält
        source = Path(source_path)
        replacements = {
            "base_path": str(self.base_path),
            "year": self._extract_year(fields),
            "month": self._extract_month(fields),
            "date": fields.get("date", datetime.now().strftime("%Y-%m-%d")),
            "vendor": self._sanitize(fields.get("vendor", "okänd")),
            "sender": self._sanitize(fields.get("sender", "okänd")),
            "amount": str(int(float(fields.get("amount", 0)))),
            "title": self._sanitize(classification.get("title", source.stem)),
            "ext": source.suffix.lstrip("."),
            "original_filename": source.name,
        }
        
        dest_path = pattern
        for key, value in replacements.items():
            dest_path = dest_path.replace(f"{{{key}}}", value)
        
        dest = Path(dest_path)
        
        # Hantera namnkonflikter
        if dest.exists() and not self.config["defaults"].get("overwrite", False):
            dest = self._unique_name(dest)
        
        return MoveResult(
            success=True,
            source=str(source),
            destination=str(dest),
            auto_moved=rule.get("auto_move", False),
            needs_confirmation=not rule.get("auto_move", False),
        )
    
    def execute_move(self, plan: MoveResult) -> MoveResult:
        """Utför filflyttningen."""
        try:
            dest = Path(plan.destination)
            
            # Skapa mappar
            if self.config["defaults"].get("create_dirs", True):
                dest.parent.mkdir(parents=True, exist_ok=True)
            
            # Flytta
            shutil.move(plan.source, str(dest))
            
            # Logga
            if self.config["defaults"].get("log_moves", True):
                logger.info(f"Moved: {plan.source} → {plan.destination}")
            
            return MoveResult(
                success=True,
                source=plan.source,
                destination=plan.destination,
                auto_moved=plan.auto_moved,
            )
        except Exception as e:
            return MoveResult(
                success=False,
                source=plan.source,
                destination=plan.destination,
                auto_moved=False,
                error=str(e),
            )
    
    def _extract_year(self, fields: dict) -> str:
        date_str = fields.get("date", "")
        if date_str and len(date_str) >= 4:
            return date_str[:4]
        return str(datetime.now().year)
    
    def _extract_month(self, fields: dict) -> str:
        date_str = fields.get("date", "")
        if date_str and len(date_str) >= 7:
            return date_str[5:7]
        return f"{datetime.now().month:02d}"
    
    def _sanitize(self, name: str) -> str:
        """Rensa filnamn från otillåtna tecken."""
        clean = re.sub(r'[<>:"/\\|?*]', '', name)
        clean = clean.strip('. ')
        return clean[:60] if clean else "namnlös"
    
    def _unique_name(self, path: Path) -> Path:
        """Lägg till suffix om filen redan finns."""
        counter = 1
        stem = path.stem
        while path.exists():
            path = path.with_stem(f"{stem}_{counter}")
            counter += 1
        return path
```

### Integration i Processing Pipeline

```python
# I FastAPI orchestratorn
organizer = FileOrganizer("file_rules.yaml")

@app.post("/process")
async def process_file(file: UploadFile):
    content = await file.read()
    mime = detect_mime(content)
    
    # Steg 1: Klassificera (text eller vision)
    if mime.startswith("image/"):
        classification = classify_image(content)
    elif mime.startswith("audio/"):
        transcript = await transcribe_audio(content, file.filename)
        classification = classify_document(transcript["text"])
        classification["transcript"] = transcript
    else:
        text = extract_text(content, mime)
        classification = classify_document(text)
    
    # Steg 2: Planera filflyttning
    move_plan = organizer.plan_move(file.filename, classification)
    
    # Steg 3: Auto-flytt eller fråga användaren
    if move_plan.auto_moved:
        move_result = organizer.execute_move(move_plan)
        classification["file_action"] = {
            "type": "auto_moved",
            "destination": move_result.destination,
            "success": move_result.success,
        }
    else:
        classification["file_action"] = {
            "type": "needs_confirmation",
            "suggested_destination": move_plan.destination,
        }
    
    # Steg 4: Embeddea + spara i LanceDB
    text_to_embed = classification.get("ocr_text") or classification.get("summary", "")
    if text_to_embed:
        await ingest_document(
            doc_id=generate_id(),
            text=text_to_embed,
            doc_type=classification["document_type"],
            file_path=move_plan.destination,
            metadata=classification,
        )
    
    return classification
```

---

## 4. Embedding — sentence-transformers (Python, In-Process)

Oförändrad från v3. Se v3-blueprint sektion 3.

```python
from sentence_transformers import SentenceTransformer
import lancedb

embedder = SentenceTransformer("nomic-ai/nomic-embed-text-v1.5", trust_remote_code=True)

def embed_text(text: str) -> list[float]:
    return embedder.encode(f"search_document: {text}").tolist()

def embed_query(query: str) -> list[float]:
    return embedder.encode(f"search_query: {query}").tolist()

def embed_batch(texts: list[str]) -> list[list[float]]:
    prefixed = [f"search_document: {t}" for t in texts]
    return embedder.encode(prefixed, batch_size=32, show_progress_bar=True).tolist()
```

### LanceDB + Hybrid Search

Oförändrad från v3. Samma schema, chunk-strategi, och smart_search.
Enda skillnaden: `model` parameter pekar nu på `qwen3.5:9b`.

---

## 5. Whisper — RTX 2060 Dedikerad Audio-nod

Oförändrad från v3. Se v3-blueprint sektion 4.

| Scenario | Utan 2060 | Med 2060 |
|----------|-----------|----------|
| Transkribera + klassificera | Seriellt | **Parallellt** |
| VRAM-konflikt | 9GB + 1.5GB = ok, men tight | **Noll**: varsitt kort |
| Throughput | 1 pipeline | **2 pipelines** parallellt |

**Not:** Med Qwen 3.5 (9GB) hade Whisper tekniskt fått plats på 4070 (9+1.5=10.5 av 12GB).
Men dedikerad GPU ger bättre parallellism och noll risk för VRAM-spikes.

---

## 6. Processing Pipeline v4 — Komplett Flöde

```
FIL DROPPAS I APPEN
    │
    ▼
┌─ RUST CORE (instant) ─────────────────────┐
│ 1. MIME-type detection                      │
│ 2. Förbearbetning:                          │
│    • PDF  → pypdf / pdftotext               │
│    • DOCX → python-docx                     │
│    • TXT  → direkt                          │
│    • Bild → SKICKAS DIREKT TILL LLM (vision)│  ← NYTT i v4
│    • Ljud → markera som audio               │
│ 3. Skicka via WebSocket → FastAPI           │
└──────────────┬──────────────────────────────┘
               │
    ┌──────────▼──────────┐
    │   TEXT?              │────── JA ──▶ Qwen 3.5: klassificera text
    │   BILD?              │────── JA ──▶ Qwen 3.5: vision-klassificera  ← NYTT
    │   LJUD?              │────── JA ──▶ RTX 2060 → Qwen 3.5
    └─────────────────────┘

┌─ RTX 4070: FASTAPI ORCHESTRATOR ──────────┐
│ 4. Qwen 3.5: Klassificera               │
│    → native JSON mode                      │
│    → vision för bilder (ingen OCR-steg)    │
│                                             │
│ 5. Qwen 3.5: Extrahera fält             │
│    → typ-specifik prompt                    │
│    → JSON: fält, actions, sammanfattning   │
│                                             │
│ 6. FileOrganizer: Planera filflyttning     │  ← NYTT i v4
│    → Regelbaserat: typ → mapp              │
│    → Auto-flytt eller fråga användaren     │
│                                             │
│ 7. sentence-transformers: chunk + embed    │
│    → nomic-embed-text, in-process          │
│                                             │
│ 8. LanceDB: spara chunks + vektorer        │
│                                             │
│ 9. WebSocket → Tauri: resultat + filstatus │
└─────────────────────────────────────────────┘

┌─ RTX 2060: WHISPER SERVER ────────────────┐
│ A. faster-whisper: transkribera            │
│    → text, timestamps, språk               │
│ B. Returnera till orchestrator → steg 4    │
└─────────────────────────────────────────────┘
```

### Parallell Pipeline — Nu Ännu Bättre

```
ANVÄNDARE DROPPAR 3 FILER SAMTIDIGT:
  ├── faktura.pdf   ──▶ RTX 4070: Qwen 3.5 klassificerar text
  ├── kvitto.jpg    ──▶ RTX 4070: Qwen 3.5 vision-analyserar direkt  ← NYTT!
  └── möte.mp3      ──▶ RTX 2060: Whisper transkriberar
                         └──▶ RTX 4070: Qwen 3.5 klassificerar transkription

I v3 hade kvitto.jpg gått: Tesseract OCR → GPT-OSS text → JSON (2 steg)
I v4 går det: Qwen 3.5 vision → JSON (1 steg, bättre resultat)
```

---

## 7. Liquid UI — Template Selection

Oförändrad från v3 — alla templates fungerar lika.

| Template | Trigger | Visar |
|----------|---------|-------|
| `contract_card` | Avtal, SLA | Parter, deadlines, uppsägning |
| `receipt_card` | Kvitton, utlägg | Belopp, datum, moms |
| `invoice_card` | Fakturor | Betalstatus, förfallodatum |
| `meeting_notes` | Protokoll, transkription | Beslut, action items |
| `audio_transcript` | Ljudfiler | Klickbara tidsstämplar, sammanfattning |
| `generic_document` | Allt annat / fallback | AI-sammanfattning, nyckelord |
| `search_result` | Sökresultat | Svar, diagram, källor |
| `file_moved` | **NYT** Efter filflyttning | Källsökväg → destination, ångra-knapp |

---

## 8. Projektstruktur v4

```
agentic-docs-handler/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # Tauri setup
│   │   ├── file_watcher.rs      # notify crate
│   │   ├── text_extractor.rs    # pdf, docx, txt (INGEN Tesseract)
│   │   └── ws_client.rs         # WebSocket → 4070-server
│   └── Cargo.toml
│
├── src/                          # React frontend
│   ├── App.tsx
│   ├── components/
│   │   ├── DropZone.tsx
│   │   ├── SearchBar.tsx
│   │   ├── FileGrid.tsx
│   │   ├── ProcessingCard.tsx
│   │   └── FileMoveToast.tsx     # NY: visar filflyttning
│   ├── templates/
│   │   ├── ContractCard.tsx
│   │   ├── ReceiptCard.tsx
│   │   ├── InvoiceCard.tsx
│   │   ├── MeetingNotes.tsx
│   │   ├── AudioTranscript.tsx
│   │   ├── GenericDocument.tsx
│   │   ├── SearchResult.tsx
│   │   └── FileMovedCard.tsx     # NY: filflyttningsresultat
│   ├── hooks/
│   │   ├── useWebSocket.ts
│   │   └── useSearch.ts
│   └── store/
│       └── documentStore.ts      # Zustand
│
├── server/                        # Python backend — RTX 4070
│   ├── main.py                    # FastAPI + WebSocket
│   ├── pipelines/
│   │   ├── classifier.py         # Qwen 3.5 via Ollama (text + vision)
│   │   ├── extractor.py          # Qwen 3.5 djup extraktion
│   │   ├── embedder.py           # sentence-transformers + LanceDB
│   │   ├── file_organizer.py     # NY: regelbaserad filflyttning
│   │   └── whisper_proxy.py      # HTTP proxy → RTX 2060
│   ├── search.py                  # Hybrid RAG
│   ├── schemas.py                 # Pydantic-modeller
│   ├── file_rules.yaml           # NY: filsorterings-regler
│   └── requirements.txt
│
├── whisper-server/                # Python — RTX 2060
│   ├── whisper_server.py          # FastAPI + faster-whisper
│   └── requirements.txt
│
├── package.json
├── tailwind.config.js
└── README.md
```

### Borttaget vs v3

- ❌ `ocr.py` — Tesseract eliminerad, vision-modellen hanterar bilder
- ❌ `grammars/` — Inte primärt behövt (native JSON mode), behålls som fallback

### Nytt i v4

- ✅ `file_organizer.py` — Regelbaserad filsortering
- ✅ `file_rules.yaml` — Konfigurerbar mappstruktur
- ✅ `FileMoveToast.tsx` — UI-feedback vid filflyttning
- ✅ `FileMovedCard.tsx` — Template för filflyttningsresultat

---

## 9. Teknik-stack — Komplett

| Komponent | Teknik | Licens | Ursprung |
|-----------|--------|--------|----------|
| Desktop App | Tauri 2.0 + React 19 | MIT | Open source |
| State | Zustand | MIT | Open source |
| Styling | Tailwind CSS | MIT | Open source |
| **LLM + Vision** | **Qwen 3.5 9B** | **Apache 2.0** | **Qwen Team / Alibaba** |
| LLM Runtime | Ollama 0.13.1+ | MIT | Open source |
| Embedding | nomic-embed-text v1.5 | Apache 2.0 | Nomic AI (USA) |
| Embedding Runtime | sentence-transformers | Apache 2.0 | Open source |
| Audio | Whisper large-v3-turbo | MIT | OpenAI (USA) |
| Audio Runtime | faster-whisper | MIT | Open source |
| Vector DB | LanceDB | Apache 2.0 | LanceDB Inc (USA) |
| Text-extraktion | pypdf + python-docx | MIT / MIT | Open source |
| Server | FastAPI | MIT | Open source |
| IPC | WebSocket | — | Standard |

**All inferens sker lokalt i den egna miljön via Ollama och lokala GPU-noder.**
**Tesseract OCR: ELIMINERAD — vision-modellen ersätter.**
**LLM: `qwen3.5:9b` via lokal Ollama-runtime på RTX 4070.**

---

## 10. Byggordning v4.1

### Fas 1: Validera Qwen 3.5 + Vision + JSON (vecka 1)
**Mål: Fungerar vision? Fungerar JSON mode?**

```bash
# Dag 1: Setup
# Installera Ollama 0.13.1+
# Dra qwen3.5:9b
# Verifiera att den kör (~9GB VRAM)

# Dag 2: Vision-test
# 20 bilder: kvitton, fakturor, visitkort, kontrakt-skanningar
# Testa: ollama run qwen3.5:9b "beskriv" ./bild.jpg
# Mät: Kan den läsa text? Rätt belopp? Rätt datum?
# KRITISKT: Om vision inte funkar → fallback: Tesseract + text-only

# Dag 3: JSON-test
# 50 dokument (text + bilder mixed)
# response_format={"type": "json_object"}
# Logga: success rate, JSON-kvalitet, latency
# Om <95% valid JSON → byt till llama-server + GBNF grammar

# Dag 4-5: Extraktions-prompts + filsortering
# Typ-specifika prompts: receipt, contract, invoice, meeting_notes
# Testa file_organizer.py med 20 klassificerade dokument
# Verifiera: hamnar filerna rätt?
# MCP: lägg read/write tools som wrappar samma pipeline, inte duplicerad logik
```

### Fas 2: Search Engine (vecka 2)
```bash
# sentence-transformers + LanceDB
# Ingest 100 dokument (inklusive vision-klassificerade bilder)
# Hybrid search + query reformulation via Qwen 3.5
# Smart search: svar istället för fillista
# MCP: exponera search_documents direkt mot search-pipelinen
```

### Fas 3: Whisper-nod (vecka 2, parallellt)
```bash
# Setup faster-whisper på RTX 2060
# FastAPI endpoint
# Testa med svenska + engelska ljudfiler
# Proxy i orchestratorn
# MCP: lägg transcribe-läsverktyg när pipeline finns
```

### Fas 4: Tauri App Shell (vecka 3)
```bash
# Scaffolda Tauri 2 + React + Tailwind
# DropZone + WebSocket
# 5 templates (receipt, contract, audio_transcript, file_moved, generic)
# FileMoveToast — visar "Kvitto flyttat till Kvitton/2026/03/..."
# Processing-animation
# MCP lever kvar som parallell klientyta
```

### Fas 5: Full Integration + Widget UI (vecka 4-5+)
```bash
# Alla templates + action-knappar
# Parallell pipeline (ljud + text + bilder samtidigt)
# Filsortering med ångra-funktion
# Error handling + retry UI
# Polish
# Framtida ChatGPT Widget UI ovanpå samma MCP-tools
```

---

## 11. Risker

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Qwen 3.5 vision-kvalitet** | HÖG | Fas 1 validerar. Fallback: lägg till Tesseract som OCR-backup enbart för dåliga bilder. |
| **Ollama JSON mode** | MEDEL | Qwen 3.5 har native stöd. Fallback: byt till llama-server + GBNF grammar (arkitekturen ändras minimalt). |
| **Ollama 0.13.1 stabilitet** | MEDEL | Pre-release krävs. Uppdatera löpande. Alt: llama-server om instabilt. |
| **LAN-latency 4070→2060** | LÅG | Ljud-filer är ~MB, överföring <1s på LAN. |
| **VRAM 9GB av 12GB** | LÅG | 3GB marginal — bättre än v3:s 1GB. Rum för längre kontext. |
| **Whisper swe-kvalitet** | LÅG | large-v3-turbo har bra svensk-stöd. VAD-filter hjälper. |
| **Filsortering edge cases** | LÅG | Regler i YAML, användaren kan override. Ångra-funktion i UI. |

---

## 12. Framtida Upgrade-paths

| Upgrade | Ändring | Effekt |
|---------|---------|--------|
| Bättre LLM | Byt Qwen 3.5 → nyare modell | Bättre resonerande |
| Reasoning-variant | Qwen 3.5 9B Reasoning 2512 | Djupare analys, långsammare |
| Cloud fallback | Lägg till Claude API | Perfekt JSON, bäst-i-klass vision |
| Fler GPU:er | Lägg till GPU-nod i kluster | Mer parallell kapacitet |
| n8n integration | Action-knappar → n8n workflows | Automatisera mail, kalender |
| Smart file rules | ML-baserade regler istället för YAML | Lär sig från användarens mönster |

Varje upgrade byter EN komponent — resten av arkitekturen påverkas inte.

---

## 13. v3 → v4 Sammanfattning

```
ELIMINERAT:
  ✗ Tesseract OCR          → Vision-modellen läser bilder direkt
  ✗ GBNF grammar (primärt) → Native JSON mode (GBNF behålls som fallback)
  ✗ llama-server (primärt)  → Ollama (enklare, allt funkar)

NYTT:
  ✓ Qwen 3.5 9B        → Vision + text + JSON i EN modell
  ✓ Automatisk filsortering → Klassificering → flytta fil till rätt mapp
  ✓ YAML-baserade regler    → Konfigurerbar mappstruktur
  ✓ 3GB VRAM-marginal       → Bättre headroom (var 1GB i v3)
  ✓ EU-modell               → Perfekt för svensk enterprise-portfölj

RESULTAT:
  Färre komponenter. Enklare pipeline. Bättre resultat.
  Bild-pipeline: 2 steg → 1 steg.
  Text-pipeline: oförändrad.
  Ljud-pipeline: oförändrad.
  + Automatisk filsortering på köpet.
```

---

*Agentic Docs Handler — Blueprint v4.1*
*Dual-server: RTX 4070 (Qwen 3.5 Vision + embedding) + RTX 2060 (Whisper)*
*Stack: Tauri 2.0 · React · LanceDB · Qwen 3.5 9B · nomic-embed-text · Whisper*
*Runtime: Ollama + sentence-transformers + faster-whisper*
*Ny: Automatisk filsortering med konfigurerbara regler*
