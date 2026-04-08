# Per-File Chat Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot the app's center of gravity from workspace-centric file management to per-file AI chat, where switching files with `j`/`k` instantly re-contexts the chat to the new file.

**Architecture:** Two-column root layout (file rail + chat stream) replaces the old three-column (sidebar + workspace view + inspector). Chat becomes always-visible main content. Workspace-level features (brief, entities, discovery, insights, action queues) move into a modal accessed via a workspace filter chip. Backend pipeline reuses the existing `_prepare_document_context` mode in `WorkspaceChatPipeline`; only a new per-file system prompt is added. Inbox view remains unchanged and is the one exception to the new layout.

**Tech Stack:** React 19 + Zustand + Tailwind + Tauri 2 (frontend), FastAPI + Ollama (Qwen 3.5) + LanceDB + SQLite (backend), Vitest + jsdom + Testing Library (frontend tests), pytest (backend tests).

**Spec:** `docs/superpowers/specs/2026-04-08-per-file-chat-pivot-design.md`

---

## Pre-work: Create isolated worktree

- [ ] **Step P.1: Create feature branch in a worktree**

```bash
cd /Users/coffeedev/Projects/02_AUTOMATION-PIPELINES/agentic-docs-handler
git worktree add ../agentic-docs-handler-per-file-chat -b feature/per-file-chat-pivot main
cd ../agentic-docs-handler-per-file-chat
```

- [ ] **Step P.2: Install dependencies in the worktree**

```bash
npm install
python3.14 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
```

- [ ] **Step P.3: Baseline verification (must pass before any changes)**

```bash
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all tests pass, build succeeds, cargo check clean. If anything fails here, stop and diagnose — do not proceed with pivot on a broken baseline.

- [ ] **Step P.4: Record baseline test count**

```bash
npm test 2>&1 | tail -5
```

Expected output contains "Tests  XXX passed" (e.g., 172). Note this number — it is the floor for the coverage requirement.

---

## Phase 1 — Backend prompt and pipeline wiring

Backend changes are deliberately tiny. The existing `WorkspaceChatPipeline` already supports pure single-document mode. We only add a new system prompt and wire it through as a second prompt injected at construction time.

### Task 1: Create Swedish per-file chat prompt

**Files:**
- Create: `server/prompts/sv/file_chat_system.txt`

- [ ] **Step 1.1: Write the prompt file**

```
Du är en hjälpsam AI-assistent som svarar på frågor om ett specifikt dokument.
Användaren tittar just nu på en enskild fil och vill förstå innehållet snabbt.

Regler:
- Svara kortfattat och konkret. Undvik långa inledningar.
- Hänvisa till specifika delar av filen (belopp, datum, personer, paragrafer) när det är relevant.
- Om frågan inte kan besvaras utifrån filen, säg det tydligt istället för att gissa.
- Skriv på samma språk som användaren använder i sin fråga.
- Prata aldrig om andra filer — du har bara tillgång till denna enskilda fil.
```

- [ ] **Step 1.2: Commit**

```bash
git add server/prompts/sv/file_chat_system.txt
git commit -m "feat(prompts): add Swedish per-file chat system prompt"
```

### Task 2: Create English per-file chat prompt

**Files:**
- Create: `server/prompts/en/file_chat_system.txt`

- [ ] **Step 2.1: Write the English version**

```
You are a helpful AI assistant answering questions about a specific document.
The user is currently looking at a single file and wants to understand its content quickly.

Rules:
- Answer concisely and concretely. Skip long preambles.
- Reference specific parts of the file (amounts, dates, people, paragraphs) when relevant.
- If the question cannot be answered from the file, say so clearly rather than guessing.
- Reply in the same language the user uses in their question.
- Never refer to other files — you only have access to this single file.
```

- [ ] **Step 2.2: Commit**

```bash
git add server/prompts/en/file_chat_system.txt
git commit -m "feat(prompts): add English per-file chat system prompt"
```

### Task 3: Register the new prompt in AppConfig.PROMPT_NAMES

**Files:**
- Modify: `server/config.py` (the `PROMPT_NAMES` list, around line 79–94)

- [ ] **Step 3.1: Write the failing test**

Create `server/tests/test_file_chat_prompt_registration.py`:

```python
from server.config import AppConfig


def test_file_chat_system_prompt_is_registered():
    config = AppConfig()
    assert "file_chat_system.txt" in config.PROMPT_NAMES


def test_file_chat_system_prompt_resolves_swedish_by_default():
    config = AppConfig()
    path = config.resolve_prompt_path("file_chat_system.txt")
    assert path.name == "file_chat_system.txt"
    assert "sv" in str(path)


def test_file_chat_system_prompt_resolves_english_when_locale_en():
    config = AppConfig(locale="en")
    path = config.resolve_prompt_path("file_chat_system.txt")
    assert path.name == "file_chat_system.txt"
    assert "en" in str(path)
```

- [ ] **Step 3.2: Run to confirm failure**

```bash
PYTHONPATH=. pytest server/tests/test_file_chat_prompt_registration.py -v
```

Expected: first test FAILS with `file_chat_system.txt` not in PROMPT_NAMES.

- [ ] **Step 3.3: Add the prompt to the list**

In `server/config.py`, modify the `PROMPT_NAMES` class attribute to include `"file_chat_system.txt"` as a new entry (add it after `"workspace_suggest_system.txt"`):

```python
    PROMPT_NAMES: list[str] = [
        "classifier_system.txt",
        "image_classifier_system.txt",
        "entity_system.txt",
        "workspace_system.txt",
        "workspace_brief_system.txt",
        "workspace_suggest_system.txt",
        "file_chat_system.txt",
        "extractors/receipt.txt",
        "extractors/contract.txt",
        "extractors/invoice.txt",
        "extractors/meeting_notes.txt",
        "extractors/report.txt",
        "extractors/letter.txt",
        "extractors/tax_document.txt",
        "extractors/generic.txt",
    ]
```

- [ ] **Step 3.4: Run to confirm pass**

```bash
PYTHONPATH=. pytest server/tests/test_file_chat_prompt_registration.py -v
```

Expected: all three tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add server/config.py server/tests/test_file_chat_prompt_registration.py
git commit -m "feat(config): register file_chat_system prompt in PROMPT_NAMES"
```

### Task 4: Inject per-file system prompt into WorkspaceChatPipeline

Goal: the pipeline should use `file_chat_system.txt` when scoped to a single document, and the existing `workspace_system.txt` in all other cases. We add a new optional constructor parameter `file_chat_system_prompt` that defaults to the main `system_prompt` for backward compatibility.

**Files:**
- Modify: `server/pipelines/workspace_chat.py` (the `__init__` and `_prepare_document_context` methods)
- Modify: `server/main.py` (the `WorkspaceChatPipeline(...)` construction around line 277)

- [ ] **Step 4.1: Write the failing test**

Create `server/tests/test_file_chat_mode.py`:

```python
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import pytest

from server.pipelines.workspace_chat import WorkspaceChatPipeline


@dataclass
class _FakeRecord:
    id: str
    title: str
    summary: str
    kind: str = "receipt"
    workspace_id: str | None = None
    extraction: Any = None
    transcription: Any = None


class _FakeRegistry:
    def __init__(self, record: _FakeRecord) -> None:
        self._record = record

    def list_documents(self, **kwargs):
        raise AssertionError("list_documents must not be called in document-only mode")

    def list_documents_by_workspace(self, **kwargs):
        raise AssertionError("list_documents_by_workspace must not be called in document-only mode")

    def get_document(self, *, record_id: str):
        return self._record if record_id == self._record.id else None


class _FakeSearch:
    async def search(self, *args, **kwargs):
        raise AssertionError("search must not be called in document-only mode")


class _FakeLLM:
    async def chat_text_stream(self, **kwargs):
        for token in []:
            yield token


def test_document_only_mode_uses_file_chat_system_prompt():
    record = _FakeRecord(id="doc-1", title="Receipt A", summary="ICA 412 kr")
    pipeline = WorkspaceChatPipeline(
        ollama_client=_FakeLLM(),
        search_pipeline=_FakeSearch(),
        document_registry=_FakeRegistry(record),
        system_prompt="WORKSPACE-PROMPT",
        file_chat_system_prompt="FILE-CHAT-PROMPT",
    )
    context = asyncio.run(
        pipeline.prepare_context(
            workspace_id=None,
            category=None,
            message="What does it say?",
            history=[],
            document_id="doc-1",
        )
    )
    system_message = next(m for m in context.messages if m["role"] == "system")
    assert "FILE-CHAT-PROMPT" in system_message["content"]
    assert "WORKSPACE-PROMPT" not in system_message["content"]


def test_workspace_only_mode_still_uses_workspace_prompt():
    record = _FakeRecord(id="doc-1", title="Receipt A", summary="ICA 412 kr", workspace_id="ws-1")

    class _ListingRegistry(_FakeRegistry):
        def list_documents_by_workspace(self, **kwargs):
            return [record]

        def get_document(self, *, record_id: str):
            return record if record_id == record.id else None

    class _OkSearch:
        async def search(self, *args, **kwargs):
            from types import SimpleNamespace
            return SimpleNamespace(results=[])

    pipeline = WorkspaceChatPipeline(
        ollama_client=_FakeLLM(),
        search_pipeline=_OkSearch(),
        document_registry=_ListingRegistry(record),
        system_prompt="WORKSPACE-PROMPT",
        file_chat_system_prompt="FILE-CHAT-PROMPT",
    )
    context = asyncio.run(
        pipeline.prepare_context(
            workspace_id="ws-1",
            category=None,
            message="Hello",
            history=[],
            document_id=None,
        )
    )
    system_message = next(m for m in context.messages if m["role"] == "system")
    assert "WORKSPACE-PROMPT" in system_message["content"]
    assert "FILE-CHAT-PROMPT" not in system_message["content"]


def test_file_chat_prompt_defaults_to_system_prompt_when_unset():
    """Backward compat: if constructor omits file_chat_system_prompt, reuse system_prompt."""
    record = _FakeRecord(id="doc-1", title="Receipt A", summary="ICA 412 kr")
    pipeline = WorkspaceChatPipeline(
        ollama_client=_FakeLLM(),
        search_pipeline=_FakeSearch(),
        document_registry=_FakeRegistry(record),
        system_prompt="ONLY-PROMPT",
    )
    context = asyncio.run(
        pipeline.prepare_context(
            workspace_id=None,
            category=None,
            message="?",
            history=[],
            document_id="doc-1",
        )
    )
    system_message = next(m for m in context.messages if m["role"] == "system")
    assert "ONLY-PROMPT" in system_message["content"]
```

- [ ] **Step 4.2: Run to confirm failure**

```bash
PYTHONPATH=. pytest server/tests/test_file_chat_mode.py -v
```

Expected: all three tests FAIL. First two because `file_chat_system_prompt` is not a known kwarg; third because the distinction doesn't exist yet.

- [ ] **Step 4.3: Update `WorkspaceChatPipeline.__init__` to accept the new prompt**

In `server/pipelines/workspace_chat.py`, modify the class:

```python
class WorkspaceChatPipeline:
    def __init__(
        self,
        *,
        ollama_client: StreamingLLM,
        search_pipeline: SearchPipeline,
        document_registry: DocumentSource,
        system_prompt: str,
        file_chat_system_prompt: str | None = None,
        temperature: float = 0.3,
        num_ctx: int = DEFAULT_NUM_CTX,
        conversation_registry: Any | None = None,
    ) -> None:
        self.ollama_client = ollama_client
        self.search_pipeline = search_pipeline
        self.document_registry = document_registry
        self.system_prompt = system_prompt
        self.file_chat_system_prompt = file_chat_system_prompt or system_prompt
        self.temperature = temperature
        self.num_ctx = num_ctx
        self.conversation_registry = conversation_registry
```

- [ ] **Step 4.4: Update `_prepare_document_context` to use the new prompt**

In the same file, modify `_prepare_document_context` (around line 530) to use `self.file_chat_system_prompt` instead of `self.system_prompt`:

```python
    def _prepare_document_context(
        self,
        *,
        document_id: str,
        category: str | None,
        workspace_id: str | None,
        message: str,
        history: list[dict[str, str]],
        request_id: str,
    ) -> WorkspaceContext:
        record = self.document_registry.get_document(record_id=document_id)
        if record is None:
            raise ValueError(f"Document {document_id} not found")
        if workspace_id is not None and getattr(record, "workspace_id", None) != workspace_id:
            raise ValueError(f"Document {document_id} is not in workspace {workspace_id}")

        title = getattr(record, "title", _msg("chat.unknown_document"))
        summary = getattr(record, "summary", "") or ""
        extraction = getattr(record, "extraction", None)
        fields = extraction.fields if extraction is not None else {}

        parts = [f"DOKUMENTTITEL: {title}"]
        if summary:
            parts.append(f"SAMMANFATTNING: {summary}")
        if fields:
            fields_str = "\n".join(f"  {k}: {v}" for k, v in fields.items() if v)
            parts.append(f"EXTRAHERADE FÄLT:\n{fields_str}")

        transcription = getattr(record, "transcription", None)
        if transcription is not None:
            text = getattr(transcription, "text", None)
            if text:
                parts.append(f"TRANSKRIBERING:\n{text}")

        doc_context = "\n\n".join(parts)

        resolved_category = category or getattr(record, "kind", "dokument")
        label = _category_labels().get(resolved_category, resolved_category)
        system_msg = (
            f"{self.file_chat_system_prompt}\n\n"
            f"Du svarar på frågor om ett specifikt dokument av typen {label}.\n\n"
            f"{doc_context}"
        )

        messages: list[dict[str, str]] = [{"role": "system", "content": system_msg}]
        for turn in history[-MAX_HISTORY_TURNS * 2 :]:
            messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": message})

        return WorkspaceContext(
            source_count=1,
            messages=messages,
            request_id=request_id,
            sources=[{"id": document_id, "title": title}],
        )
```

(The only real change is `self.system_prompt` → `self.file_chat_system_prompt` at the start of the `system_msg` assignment.)

- [ ] **Step 4.5: Run to confirm pass**

```bash
PYTHONPATH=. pytest server/tests/test_file_chat_mode.py -v
```

Expected: all three tests PASS.

- [ ] **Step 4.6: Wire the new prompt in `server/main.py`**

Find the `WorkspaceChatPipeline(...)` construction (around line 278) and add the `file_chat_system_prompt` kwarg:

```python
        from server.pipelines.workspace_chat import WorkspaceChatPipeline, DEFAULT_NUM_CTX
        workspace_chat_service = WorkspaceChatPipeline(
            ollama_client=workspace_llm,
            search_pipeline=search_service,
            document_registry=document_registry,
            system_prompt=read_prompt(config.resolve_prompt_path("workspace_system.txt")),
            file_chat_system_prompt=read_prompt(config.resolve_prompt_path("file_chat_system.txt")),
            num_ctx=config.resolve_num_ctx("workspace_chat") or DEFAULT_NUM_CTX,
            conversation_registry=conversation_registry,
        )
```

- [ ] **Step 4.7: Run the full existing backend test suite to confirm nothing regressed**

```bash
PYTHONPATH=. pytest server/tests -q
```

Expected: all existing tests still pass plus the three new ones.

- [ ] **Step 4.8: Commit**

```bash
git add server/pipelines/workspace_chat.py server/main.py server/tests/test_file_chat_mode.py
git commit -m "feat(chat): inject per-file system prompt into WorkspaceChatPipeline"
```

---

## Phase 2 — Frontend types and state foundation

This phase extends the workspace store with per-file chat state and modal state, and introduces the type needed for the new components to hold their data. No components yet — this is foundation only.

### Task 5: Extend workspaceStore with active file and modal state

**Files:**
- Modify: `src/store/workspaceStore.ts`

- [ ] **Step 5.1: Write the failing test**

Create `src/store/workspaceStore.test.ts` (if one doesn't exist — otherwise append to it):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";

describe("workspaceStore per-file chat state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      activeWorkspaceTab: "documents",
      loading: false,
      error: null,
      backendStatus: "checking",
      activeFileIdByWorkspace: {},
      workspaceModalOpen: false,
      workspaceModalTab: "overview",
    });
  });

  it("tracks active file id per workspace", () => {
    useWorkspaceStore.getState().setActiveFile("ws-1", "file-a");
    useWorkspaceStore.getState().setActiveFile("ws-2", "file-x");
    expect(useWorkspaceStore.getState().activeFileIdByWorkspace["ws-1"]).toBe("file-a");
    expect(useWorkspaceStore.getState().activeFileIdByWorkspace["ws-2"]).toBe("file-x");
  });

  it("clears active file for a workspace when passed null", () => {
    useWorkspaceStore.getState().setActiveFile("ws-1", "file-a");
    useWorkspaceStore.getState().setActiveFile("ws-1", null);
    expect(useWorkspaceStore.getState().activeFileIdByWorkspace["ws-1"]).toBeUndefined();
  });

  it("opens and closes the workspace modal", () => {
    useWorkspaceStore.getState().openWorkspaceModal("overview");
    expect(useWorkspaceStore.getState().workspaceModalOpen).toBe(true);
    expect(useWorkspaceStore.getState().workspaceModalTab).toBe("overview");
    useWorkspaceStore.getState().closeWorkspaceModal();
    expect(useWorkspaceStore.getState().workspaceModalOpen).toBe(false);
  });

  it("switches modal tab while open", () => {
    useWorkspaceStore.getState().openWorkspaceModal("overview");
    useWorkspaceStore.getState().setWorkspaceModalTab("discoveries");
    expect(useWorkspaceStore.getState().workspaceModalTab).toBe("discoveries");
  });
});
```

- [ ] **Step 5.2: Run to confirm failure**

```bash
npm test -- src/store/workspaceStore.test.ts
```

Expected: tests FAIL — `setActiveFile`, `openWorkspaceModal`, etc. don't exist yet.

- [ ] **Step 5.3: Extend the store**

In `src/store/workspaceStore.ts`, modify the type and implementation:

```typescript
import { create } from "zustand";

import type { WorkspaceResponse } from "../types/workspace";
import {
  checkHealth,
  fetchWorkspaces as apiFetchWorkspaces,
  createWorkspace as apiCreateWorkspace,
  updateWorkspace as apiUpdateWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
} from "../lib/api";

type WorkspaceTab = "documents" | "insights";

export type WorkspaceModalTab =
  | "overview"
  | "people"
  | "discoveries"
  | "insights"
  | "todos"
  | "ask_workspace";

type WorkspaceStoreState = {
  workspaces: WorkspaceResponse[];
  activeWorkspaceId: string | null;
  activeWorkspaceTab: WorkspaceTab;
  loading: boolean;
  error: string | null;
  backendStatus: "checking" | "online" | "offline";
  activeFileIdByWorkspace: Record<string, string>;
  workspaceModalOpen: boolean;
  workspaceModalTab: WorkspaceModalTab;

  checkBackend: () => Promise<void>;
  fetchWorkspaces: () => Promise<void>;
  setActiveWorkspace: (id: string) => void;
  setActiveWorkspaceTab: (tab: WorkspaceTab) => void;
  setActiveFile: (workspaceId: string, fileId: string | null) => void;
  openWorkspaceModal: (tab?: WorkspaceModalTab) => void;
  closeWorkspaceModal: () => void;
  setWorkspaceModalTab: (tab: WorkspaceModalTab) => void;
  createWorkspace: (name: string) => Promise<WorkspaceResponse>;
  updateWorkspace: (id: string, fields: { name?: string; description?: string; cover_color?: string }) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
};

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  activeWorkspaceTab: "documents",
  loading: false,
  error: null,
  backendStatus: "checking",
  activeFileIdByWorkspace: {},
  workspaceModalOpen: false,
  workspaceModalTab: "overview",

  checkBackend: async () => {
    set({ backendStatus: "checking" });
    const healthy = await checkHealth();
    if (healthy) {
      set({ backendStatus: "online" });
      await get().fetchWorkspaces();
      return;
    }
    set({ backendStatus: "offline" });
    let delay = 1000;
    const maxDelay = 8000;
    const retry = async () => {
      const ok = await checkHealth();
      if (ok) {
        set({ backendStatus: "online" });
        await get().fetchWorkspaces();
        return;
      }
      delay = Math.min(delay * 2, maxDelay);
      setTimeout(() => void retry(), delay);
    };
    setTimeout(() => void retry(), delay);
  },

  fetchWorkspaces: async () => {
    set({ loading: true, error: null });
    try {
      const list = await apiFetchWorkspaces();
      const workspaces = list.workspaces;
      set((state) => {
        const nextActive =
          state.activeWorkspaceId !== null
            ? state.activeWorkspaceId
            : (workspaces.find((w) => w.is_inbox)?.id ?? null);
        return { workspaces, activeWorkspaceId: nextActive, loading: false };
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        backendStatus: "offline",
      });
    }
  },

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id, activeWorkspaceTab: "documents" }),

  setActiveWorkspaceTab: (tab) => set({ activeWorkspaceTab: tab }),

  setActiveFile: (workspaceId, fileId) =>
    set((state) => {
      const next = { ...state.activeFileIdByWorkspace };
      if (fileId === null) {
        delete next[workspaceId];
      } else {
        next[workspaceId] = fileId;
      }
      return { activeFileIdByWorkspace: next };
    }),

  openWorkspaceModal: (tab = "overview") =>
    set({ workspaceModalOpen: true, workspaceModalTab: tab }),

  closeWorkspaceModal: () => set({ workspaceModalOpen: false }),

  setWorkspaceModalTab: (tab) => set({ workspaceModalTab: tab }),

  createWorkspace: async (name) => {
    const created = await apiCreateWorkspace(name);
    await get().fetchWorkspaces();
    set({ activeWorkspaceId: created.id });
    return created;
  },

  updateWorkspace: async (id, fields) => {
    await apiUpdateWorkspace(id, fields);
    await get().fetchWorkspaces();
  },

  deleteWorkspace: async (id) => {
    await apiDeleteWorkspace(id);
    const { activeWorkspaceId } = get();
    if (activeWorkspaceId === id) {
      await get().fetchWorkspaces();
      const inbox = get().workspaces.find((w) => w.is_inbox);
      set({ activeWorkspaceId: inbox?.id ?? null });
    } else {
      await get().fetchWorkspaces();
    }
  },

}));
```

- [ ] **Step 5.4: Run to confirm pass**

```bash
npm test -- src/store/workspaceStore.test.ts
```

Expected: all four tests PASS.

- [ ] **Step 5.5: Run the full frontend suite to confirm no regressions**

```bash
npm test
```

Expected: no previously-passing test breaks. Count equals baseline + 4.

- [ ] **Step 5.6: Commit**

```bash
git add src/store/workspaceStore.ts src/store/workspaceStore.test.ts
git commit -m "feat(store): add active file tracking and workspace modal state"
```

---

## Phase 3 — New components (TDD, in isolation)

Each new component is written test-first and developed in isolation, without touching `App.tsx` yet. After this phase, all four new components exist, are tested, and compile — but they are not yet rendered anywhere. That lets us verify each component independently before the big switch in Phase 5.

### Task 6: FileRail component

`FileRail` is the left-column file list. It renders files scoped to the current workspace, supports `j`/`k` keyboard navigation, and calls `setActiveFile` when selection changes. It implements focus guards so that typing in an input doesn't trigger navigation.

**Files:**
- Create: `src/components/FileRail.tsx`
- Create: `src/components/FileRail.test.tsx`

- [ ] **Step 6.1: Write the failing test**

```typescript
// src/components/FileRail.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileRail } from "./FileRail";
import type { UiDocument } from "../types/documents";

function makeDoc(id: string, title: string): UiDocument {
  return {
    id,
    title,
    summary: "",
    kind: "receipt",
    classification: {
      document_type: "receipt",
      template: "receipt",
      title,
      summary: "",
      tags: [],
      language: "sv",
      confidence: 0.9,
      ocr_text: null,
      suggested_actions: [],
    },
    mimeType: "application/pdf",
    sourceModality: "text",
    documentType: "receipt",
    template: "receipt",
    sourcePath: null,
    createdAt: "2026-04-08T10:00:00Z",
    updatedAt: "2026-04-08T10:00:00Z",
    requestId: `req-${id}`,
    status: "completed",
    tags: [],
    warnings: [],
    retryable: false,
    errorCode: null,
    undoToken: null,
    moveStatus: "not_requested",
    extraction: null,
    transcription: null,
    movePlan: null,
    moveResult: null,
    diagnostics: null,
    thumbnailData: null,
  } as unknown as UiDocument;
}

describe("FileRail", () => {
  const docs = [
    makeDoc("a", "File A"),
    makeDoc("b", "File B"),
    makeDoc("c", "File C"),
  ];

  it("renders all files", () => {
    render(<FileRail files={docs} activeFileId="a" onSelectFile={() => {}} />);
    expect(screen.getByText("File A")).toBeInTheDocument();
    expect(screen.getByText("File B")).toBeInTheDocument();
    expect(screen.getByText("File C")).toBeInTheDocument();
  });

  it("highlights the active file", () => {
    render(<FileRail files={docs} activeFileId="b" onSelectFile={() => {}} />);
    const active = screen.getByText("File B").closest("[data-active]");
    expect(active).toHaveAttribute("data-active", "true");
  });

  it("calls onSelectFile when clicking a row", () => {
    const onSelect = vi.fn();
    render(<FileRail files={docs} activeFileId="a" onSelectFile={onSelect} />);
    fireEvent.click(screen.getByText("File B"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("advances selection with j key", () => {
    const onSelect = vi.fn();
    render(<FileRail files={docs} activeFileId="a" onSelectFile={onSelect} />);
    fireEvent.keyDown(window, { key: "j" });
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("retreats selection with k key", () => {
    const onSelect = vi.fn();
    render(<FileRail files={docs} activeFileId="b" onSelectFile={onSelect} />);
    fireEvent.keyDown(window, { key: "k" });
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("wraps neither at top nor bottom", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<FileRail files={docs} activeFileId="a" onSelectFile={onSelect} />);
    fireEvent.keyDown(window, { key: "k" });
    expect(onSelect).not.toHaveBeenCalled();
    rerender(<FileRail files={docs} activeFileId="c" onSelectFile={onSelect} />);
    fireEvent.keyDown(window, { key: "j" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ignores j/k while focus is in an input", () => {
    const onSelect = vi.fn();
    render(
      <div>
        <input data-testid="text-input" />
        <FileRail files={docs} activeFileId="a" onSelectFile={onSelect} />
      </div>
    );
    const input = screen.getByTestId("text-input");
    input.focus();
    fireEvent.keyDown(input, { key: "j" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders an empty state when there are no files", () => {
    render(<FileRail files={[]} activeFileId={null} onSelectFile={() => {}} />);
    expect(screen.getByText(/inga filer/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6.2: Run to confirm failure**

```bash
npm test -- src/components/FileRail.test.tsx
```

Expected: tests FAIL — `FileRail` module does not exist.

- [ ] **Step 6.3: Implement FileRail**

```typescript
// src/components/FileRail.tsx
import { useEffect, useRef } from "react";
import type { UiDocument } from "../types/documents";

type FileRailProps = {
  files: UiDocument[];
  activeFileId: string | null;
  onSelectFile: (fileId: string) => void;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function FileRail({ files, activeFileId, onSelectFile }: FileRailProps) {
  const filesRef = useRef(files);
  const activeRef = useRef(activeFileId);
  filesRef.current = files;
  activeRef.current = activeFileId;

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (isTextTarget(event.target)) return;
      if (event.key !== "j" && event.key !== "k" && event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      const currentFiles = filesRef.current;
      if (currentFiles.length === 0) return;
      const currentIndex = currentFiles.findIndex((file) => file.id === activeRef.current);
      if (currentIndex < 0) {
        onSelectFile(currentFiles[0].id);
        return;
      }
      const forward = event.key === "j" || event.key === "ArrowDown";
      const nextIndex = forward ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex < 0 || nextIndex >= currentFiles.length) return;
      event.preventDefault();
      onSelectFile(currentFiles[nextIndex].id);
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onSelectFile]);

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-xs-ui text-[var(--text-muted)]">
        Inga filer i detta workspace ännu
      </div>
    );
  }

  return (
    <nav aria-label="File list" className="flex h-full flex-col overflow-y-auto">
      <ul className="flex flex-col">
        {files.map((file) => {
          const isActive = file.id === activeFileId;
          return (
            <li key={file.id}>
              <button
                type="button"
                data-active={isActive ? "true" : "false"}
                className={cx(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm-ui transition-colors",
                  isActive
                    ? "bg-[var(--surface-10)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-4)]"
                )}
                onClick={() => onSelectFile(file.id)}
              >
                <span className="truncate">{file.title || "Untitled"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 6.4: Run to confirm pass**

```bash
npm test -- src/components/FileRail.test.tsx
```

Expected: all eight tests PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/components/FileRail.tsx src/components/FileRail.test.tsx
git commit -m "feat(ui): add FileRail component with keyboard navigation"
```

### Task 7: FileContextCard component

`FileContextCard` shows the current file's metadata above the chat stream: thumbnail, title, AI summary, type badge, and classification tags as pills.

**Files:**
- Create: `src/components/FileContextCard.tsx`
- Create: `src/components/FileContextCard.test.tsx`

- [ ] **Step 7.1: Write the failing test**

```typescript
// src/components/FileContextCard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileContextCard } from "./FileContextCard";
import type { UiDocument } from "../types/documents";

function makeDoc(overrides: Partial<UiDocument> = {}): UiDocument {
  return {
    id: "doc-1",
    title: "Telia faktura mars 2024",
    summary: "Faktura från Telia på 412 kr, förfaller 2024-04-15.",
    kind: "invoice",
    documentType: "invoice",
    template: "invoice",
    mimeType: "application/pdf",
    sourceModality: "text",
    sourcePath: null,
    createdAt: "2026-04-08T10:00:00Z",
    updatedAt: "2026-04-08T10:00:00Z",
    requestId: "req-1",
    status: "completed",
    tags: [],
    warnings: [],
    retryable: false,
    errorCode: null,
    undoToken: null,
    moveStatus: "not_requested",
    classification: {
      document_type: "invoice",
      template: "invoice",
      title: "Telia faktura mars 2024",
      summary: "Faktura från Telia på 412 kr, förfaller 2024-04-15.",
      tags: ["telia", "412 kr", "mars"],
      language: "sv",
      confidence: 0.95,
      ocr_text: null,
      suggested_actions: [],
    },
    extraction: null,
    transcription: null,
    movePlan: null,
    moveResult: null,
    diagnostics: null,
    thumbnailData: null,
    ...overrides,
  } as unknown as UiDocument;
}

describe("FileContextCard", () => {
  it("renders the file title", () => {
    render(<FileContextCard file={makeDoc()} />);
    expect(screen.getByText("Telia faktura mars 2024")).toBeInTheDocument();
  });

  it("renders the AI summary", () => {
    render(<FileContextCard file={makeDoc()} />);
    expect(screen.getByText(/förfaller 2024-04-15/)).toBeInTheDocument();
  });

  it("renders classification tags as pills", () => {
    render(<FileContextCard file={makeDoc()} />);
    expect(screen.getByText("telia")).toBeInTheDocument();
    expect(screen.getByText("412 kr")).toBeInTheDocument();
    expect(screen.getByText("mars")).toBeInTheDocument();
  });

  it("renders the document type badge", () => {
    render(<FileContextCard file={makeDoc()} />);
    expect(screen.getByText(/invoice/i)).toBeInTheDocument();
  });

  it("shows skeleton loader when status is processing", () => {
    render(<FileContextCard file={makeDoc({ status: "classified" })} />);
    expect(screen.getByTestId("file-context-skeleton")).toBeInTheDocument();
  });

  it("renders a null-state when no file is provided", () => {
    render(<FileContextCard file={null} />);
    expect(screen.getByText(/välj en fil/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7.2: Run to confirm failure**

```bash
npm test -- src/components/FileContextCard.test.tsx
```

Expected: tests FAIL — module does not exist.

- [ ] **Step 7.3: Implement FileContextCard**

```typescript
// src/components/FileContextCard.tsx
import type { UiDocument } from "../types/documents";
import { SkeletonLoader } from "./ui/SkeletonLoader";

type FileContextCardProps = {
  file: UiDocument | null;
};

function isReady(file: UiDocument): boolean {
  return file.status === "completed" || file.status === "ready";
}

export function FileContextCard({ file }: FileContextCardProps) {
  if (!file) {
    return (
      <div className="flex min-h-[120px] items-center justify-center rounded-[var(--card-radius)] border border-[var(--surface-4)] bg-[var(--surface-4)] p-4 text-sm-ui text-[var(--text-muted)]">
        Välj en fil från listan till vänster för att börja
      </div>
    );
  }

  if (!isReady(file)) {
    return (
      <div
        data-testid="file-context-skeleton"
        className="flex flex-col gap-2 rounded-[var(--card-radius)] border border-[var(--surface-4)] bg-[var(--surface-4)] p-4"
      >
        <SkeletonLoader className="h-4 w-1/2" />
        <SkeletonLoader className="h-3 w-full" />
        <SkeletonLoader className="h-3 w-3/4" />
      </div>
    );
  }

  const tags = file.classification?.tags ?? [];
  const typeLabel = file.classification?.document_type ?? file.documentType ?? "document";

  return (
    <div className="flex flex-col gap-3 rounded-[var(--card-radius)] border border-[var(--surface-4)] bg-[var(--surface-4)] p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="truncate text-lg-ui font-medium text-[var(--text-primary)]">
          {file.title || "Untitled"}
        </h2>
        <span className="shrink-0 rounded-full bg-[var(--surface-8)] px-2 py-0.5 text-xs-ui uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          {typeLabel}
        </span>
      </div>
      {file.summary && (
        <p className="text-sm-ui text-[var(--text-secondary)]">{file.summary}</p>
      )}
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-[var(--surface-6)] px-2 py-0.5 text-xs-ui text-[var(--text-secondary)]"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7.4: Run to confirm pass**

```bash
npm test -- src/components/FileContextCard.test.tsx
```

Expected: all six tests PASS.

- [ ] **Step 7.5: Commit**

```bash
git add src/components/FileContextCard.tsx src/components/FileContextCard.test.tsx
git commit -m "feat(ui): add FileContextCard component for per-file header"
```

### Task 8: WorkspaceFilterChip component

Dropdown chip at the top of the left column. Lists Inbox first, then all workspaces, then an "Open workspace overview" action that opens the modal. Reads from `useWorkspaceStore`.

**Files:**
- Create: `src/components/WorkspaceFilterChip.tsx`
- Create: `src/components/WorkspaceFilterChip.test.tsx`

- [ ] **Step 8.1: Write the failing test**

```typescript
// src/components/WorkspaceFilterChip.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { WorkspaceFilterChip } from "./WorkspaceFilterChip";

function seed(state: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeWorkspaceTab: "documents",
    loading: false,
    error: null,
    backendStatus: "online",
    activeFileIdByWorkspace: {},
    workspaceModalOpen: false,
    workspaceModalTab: "overview",
    ...state,
  });
}

const workspaces = [
  {
    id: "inbox",
    name: "Inbox",
    description: "",
    ai_brief: "",
    ai_entities: [],
    ai_topics: [],
    cover_color: "",
    is_inbox: true,
    file_count: 3,
    created_at: "2026-04-08",
    updated_at: "2026-04-08",
  },
  {
    id: "ws-tax",
    name: "Tax 2025",
    description: "",
    ai_brief: "",
    ai_entities: [],
    ai_topics: [],
    cover_color: "",
    is_inbox: false,
    file_count: 23,
    created_at: "2026-04-08",
    updated_at: "2026-04-08",
  },
  {
    id: "ws-legal",
    name: "Legal Case",
    description: "",
    ai_brief: "",
    ai_entities: [],
    ai_topics: [],
    cover_color: "",
    is_inbox: false,
    file_count: 12,
    created_at: "2026-04-08",
    updated_at: "2026-04-08",
  },
];

describe("WorkspaceFilterChip", () => {
  beforeEach(() => {
    seed({ workspaces, activeWorkspaceId: "ws-tax" });
  });

  it("shows the active workspace name", () => {
    render(<WorkspaceFilterChip />);
    expect(screen.getByRole("button", { name: /Tax 2025/ })).toBeInTheDocument();
  });

  it("opens dropdown and lists inbox first", () => {
    render(<WorkspaceFilterChip />);
    fireEvent.click(screen.getByRole("button", { name: /Tax 2025/ }));
    const options = screen.getAllByRole("menuitem");
    expect(options[0]).toHaveTextContent(/Inbox/);
  });

  it("switches active workspace when selecting another option", () => {
    render(<WorkspaceFilterChip />);
    fireEvent.click(screen.getByRole("button", { name: /Tax 2025/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Legal Case/ }));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-legal");
  });

  it("opens the workspace modal when choosing the overview action", () => {
    render(<WorkspaceFilterChip />);
    fireEvent.click(screen.getByRole("button", { name: /Tax 2025/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Öppna workspace-översikt/i }));
    expect(useWorkspaceStore.getState().workspaceModalOpen).toBe(true);
  });

  it("hides the overview action when the Inbox workspace is active", () => {
    seed({ workspaces, activeWorkspaceId: "inbox" });
    render(<WorkspaceFilterChip />);
    fireEvent.click(screen.getByRole("button", { name: /Inbox/ }));
    expect(screen.queryByRole("menuitem", { name: /Öppna workspace-översikt/i })).toBeNull();
  });
});
```

- [ ] **Step 8.2: Run to confirm failure**

```bash
npm test -- src/components/WorkspaceFilterChip.test.tsx
```

Expected: tests FAIL — component does not exist.

- [ ] **Step 8.3: Implement WorkspaceFilterChip**

```typescript
// src/components/WorkspaceFilterChip.tsx
import { useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";

export function WorkspaceFilterChip() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActive = useWorkspaceStore((s) => s.setActiveWorkspace);
  const openModal = useWorkspaceStore((s) => s.openWorkspaceModal);
  const [open, setOpen] = useState(false);

  const active = workspaces.find((w) => w.id === activeId);
  const sorted = [...workspaces].sort((a, b) => {
    if (a.is_inbox) return -1;
    if (b.is_inbox) return 1;
    return a.name.localeCompare(b.name);
  });

  function handleSelect(id: string) {
    setActive(id);
    setOpen(false);
  }

  function handleOpenOverview() {
    openModal("overview");
    setOpen(false);
  }

  return (
    <div className="relative px-3 pt-3">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-[var(--button-radius)] bg-[var(--surface-6)] px-3 py-2 text-left text-sm-ui text-[var(--text-primary)] hover:bg-[var(--surface-8)]"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{active?.name ?? "Välj workspace"}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul
          role="menu"
          className="absolute left-3 right-3 top-full z-10 mt-1 flex flex-col gap-0.5 rounded-[var(--card-radius)] bg-[var(--surface-10)] p-1 shadow-lg"
        >
          {sorted.map((ws) => (
            <li key={ws.id}>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center justify-between rounded-[var(--button-radius)] px-2 py-1.5 text-left text-sm-ui text-[var(--text-primary)] hover:bg-[var(--surface-4)]"
                onClick={() => handleSelect(ws.id)}
              >
                <span className="truncate">
                  {ws.is_inbox ? "📥 Inbox" : ws.name}
                </span>
                <span className="text-xs-ui text-[var(--text-muted)]">{ws.file_count}</span>
              </button>
            </li>
          ))}
          {active && !active.is_inbox && (
            <li className="mt-1 border-t border-[var(--surface-4)] pt-1">
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-[var(--button-radius)] px-2 py-1.5 text-left text-sm-ui text-[var(--text-secondary)] hover:bg-[var(--surface-4)]"
                onClick={handleOpenOverview}
              >
                Öppna workspace-översikt
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 8.4: Run to confirm pass**

```bash
npm test -- src/components/WorkspaceFilterChip.test.tsx
```

Expected: all five tests PASS.

- [ ] **Step 8.5: Commit**

```bash
git add src/components/WorkspaceFilterChip.tsx src/components/WorkspaceFilterChip.test.tsx
git commit -m "feat(ui): add WorkspaceFilterChip dropdown with overview action"
```

### Task 9: WorkspaceModal component

Slide-in panel that hosts the workspace-overview content. For this task we build the shell with tabs and placeholder body — the actual inner content (WorkspaceHeader, DiscoveryCards, etc.) is wired in Task 14 during cleanup since those components need to be re-tested for their new context.

**Files:**
- Create: `src/components/WorkspaceModal.tsx`
- Create: `src/components/WorkspaceModal.test.tsx`

- [ ] **Step 9.1: Write the failing test**

```typescript
// src/components/WorkspaceModal.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { WorkspaceModal } from "./WorkspaceModal";

function seed(overrides: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState({
    workspaces: [
      {
        id: "ws-1",
        name: "Legal Case",
        description: "",
        ai_brief: "Detta workspace innehåller material från den pågående tvisten.",
        ai_entities: [],
        ai_topics: [],
        cover_color: "",
        is_inbox: false,
        file_count: 7,
        created_at: "2026-04-08",
        updated_at: "2026-04-08",
      },
    ],
    activeWorkspaceId: "ws-1",
    activeWorkspaceTab: "documents",
    loading: false,
    error: null,
    backendStatus: "online",
    activeFileIdByWorkspace: {},
    workspaceModalOpen: true,
    workspaceModalTab: "overview",
    ...overrides,
  });
}

describe("WorkspaceModal", () => {
  beforeEach(() => seed({}));

  it("renders nothing when modal is closed", () => {
    seed({ workspaceModalOpen: false });
    render(<WorkspaceModal />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the active workspace name as title", () => {
    render(<WorkspaceModal />);
    expect(screen.getByRole("dialog", { name: /Legal Case/ })).toBeInTheDocument();
  });

  it("renders all six tabs", () => {
    render(<WorkspaceModal />);
    expect(screen.getByRole("tab", { name: /Översikt/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Personer/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Upptäckter/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Insikter/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Att göra/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Fråga workspace/ })).toBeInTheDocument();
  });

  it("shows the overview tab content by default", () => {
    render(<WorkspaceModal />);
    expect(screen.getByText(/pågående tvisten/)).toBeInTheDocument();
  });

  it("switches active tab when clicked", () => {
    render(<WorkspaceModal />);
    fireEvent.click(screen.getByRole("tab", { name: /Upptäckter/ }));
    expect(useWorkspaceStore.getState().workspaceModalTab).toBe("discoveries");
  });

  it("closes when Escape is pressed", () => {
    render(<WorkspaceModal />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useWorkspaceStore.getState().workspaceModalOpen).toBe(false);
  });

  it("closes when backdrop is clicked", () => {
    render(<WorkspaceModal />);
    fireEvent.click(screen.getByTestId("workspace-modal-backdrop"));
    expect(useWorkspaceStore.getState().workspaceModalOpen).toBe(false);
  });
});
```

- [ ] **Step 9.2: Run to confirm failure**

```bash
npm test -- src/components/WorkspaceModal.test.tsx
```

Expected: tests FAIL — component does not exist.

- [ ] **Step 9.3: Implement WorkspaceModal shell**

```typescript
// src/components/WorkspaceModal.tsx
import { useEffect } from "react";
import { useWorkspaceStore, type WorkspaceModalTab } from "../store/workspaceStore";

const TAB_LABELS: Array<{ id: WorkspaceModalTab; label: string }> = [
  { id: "overview", label: "Översikt" },
  { id: "people", label: "Personer & saker" },
  { id: "discoveries", label: "Upptäckter" },
  { id: "insights", label: "Insikter" },
  { id: "todos", label: "Att göra" },
  { id: "ask_workspace", label: "Fråga workspace" },
];

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function WorkspaceModal() {
  const open = useWorkspaceStore((s) => s.workspaceModalOpen);
  const activeTab = useWorkspaceStore((s) => s.workspaceModalTab);
  const setTab = useWorkspaceStore((s) => s.setWorkspaceModalTab);
  const close = useWorkspaceStore((s) => s.closeWorkspaceModal);
  const activeWorkspace = useWorkspaceStore((s) => {
    const id = s.activeWorkspaceId;
    if (!id) return null;
    return s.workspaces.find((w) => w.id === id) ?? null;
  });

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, close]);

  if (!open || !activeWorkspace) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        data-testid="workspace-modal-backdrop"
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={close}
      />
      <aside
        role="dialog"
        aria-label={activeWorkspace.name}
        aria-modal="true"
        className="flex h-full w-[min(720px,60vw)] flex-col bg-[var(--surface-8)] shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--surface-4)] px-6 py-4">
          <h2 className="text-xl-ui text-[var(--text-primary)]">{activeWorkspace.name}</h2>
          <button
            type="button"
            aria-label="Stäng"
            className="rounded-[var(--button-radius)] p-1 text-[var(--text-secondary)] hover:bg-[var(--surface-4)]"
            onClick={close}
          >
            ×
          </button>
        </header>

        <nav role="tablist" className="flex gap-1 border-b border-[var(--surface-4)] px-4">
          {TAB_LABELS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={cx(
                "px-3 py-2 text-sm-ui",
                activeTab === tab.id
                  ? "border-b-2 border-[var(--accent-primary)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
              onClick={() => setTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section className="flex-1 overflow-y-auto px-6 py-4 text-sm-ui text-[var(--text-secondary)]">
          {activeTab === "overview" && (
            <div>
              <h3 className="mb-2 text-base-ui text-[var(--text-primary)]">AI-brief</h3>
              <p>{activeWorkspace.ai_brief || "Ingen brief tillgänglig ännu."}</p>
              <p className="mt-4 text-xs-ui text-[var(--text-muted)]">
                {activeWorkspace.file_count} filer
              </p>
            </div>
          )}
          {activeTab === "people" && <p>Personer och saker (flyttas in i Task 14).</p>}
          {activeTab === "discoveries" && <p>Upptäckter (flyttas in i Task 14).</p>}
          {activeTab === "insights" && <p>Insikter (flyttas in i Task 14).</p>}
          {activeTab === "todos" && <p>Att göra (flyttas in i Task 14).</p>}
          {activeTab === "ask_workspace" && <p>Fråga workspace (flyttas in i Task 14).</p>}
        </section>
      </aside>
    </div>
  );
}
```

- [ ] **Step 9.4: Run to confirm pass**

```bash
npm test -- src/components/WorkspaceModal.test.tsx
```

Expected: all seven tests PASS.

- [ ] **Step 9.5: Commit**

```bash
git add src/components/WorkspaceModal.tsx src/components/WorkspaceModal.test.tsx
git commit -m "feat(ui): add WorkspaceModal shell with tab navigation"
```

---

## Phase 4 — Refactor useWorkspaceChat for file-scoped mode

This is the highest-risk refactor in the plan. The existing hook is workspace-scoped with persistent memory hydration. The new version supports two modes: **file mode** (scoped to `selectedDocumentId`, ephemeral, no memory) and **workspace mode** (legacy behavior, used by the workspace modal). We add the file mode without removing the workspace mode.

### Task 10: Refactor useWorkspaceChat to support file-scoped mode

**Files:**
- Modify: `src/hooks/useWorkspaceChat.ts`
- Create: `src/hooks/useWorkspaceChat.test.ts` (if it doesn't exist — skim `src/hooks/` first to check)

- [ ] **Step 10.1: Check for existing test file**

```bash
ls src/hooks/useWorkspaceChat.test.ts 2>/dev/null || echo "not present"
```

If present, append to it. If not, create it fresh as described below.

- [ ] **Step 10.2: Write the failing test**

Replace or create `src/hooks/useWorkspaceChat.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkspaceChat } from "./useWorkspaceChat";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";

vi.mock("../lib/api", async () => {
  return {
    streamWorkspaceChat: vi.fn(async function* () {
      yield { type: "context" as const, data: { source_count: 1, sources: [{ id: "doc-1", title: "Doc 1" }] } };
      yield { type: "token" as const, data: { text: "hello" } };
    }),
    fetchConversation: vi.fn(async () => ({ entries: [] })),
    saveConversationEntry: vi.fn(async () => {}),
  };
});

import { streamWorkspaceChat, fetchConversation } from "../lib/api";

function seedWorkspaceStore(activeId: string | null) {
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: activeId,
    activeWorkspaceTab: "documents",
    loading: false,
    error: null,
    backendStatus: "online",
    activeFileIdByWorkspace: activeId && activeId !== "inbox" ? { [activeId]: "doc-1" } : {},
    workspaceModalOpen: false,
    workspaceModalTab: "overview",
  });
}

function resetDocStore() {
  useDocumentStore.setState({
    ...useDocumentStore.getState(),
    selectedDocumentId: "doc-1",
    conversations: {},
  });
}

describe("useWorkspaceChat file-scoped mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedWorkspaceStore("ws-1");
    resetDocStore();
  });

  it("keys conversation on selectedDocumentId in file mode", () => {
    const { result } = renderHook(() => useWorkspaceChat({ mode: "file" }));
    expect(result.current.conversationKey).toBe("doc-1");
  });

  it("sends only document_id, no workspace_id in file mode", async () => {
    const { result } = renderHook(() => useWorkspaceChat({ mode: "file" }));
    await act(async () => {
      await result.current.sendMessage("What does it say?");
    });
    const call = (streamWorkspaceChat as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = call[3];
    expect(options.document_id).toBe("doc-1");
    expect(options.workspace_id).toBeUndefined();
  });

  it("does not hydrate persisted memory in file mode", () => {
    renderHook(() => useWorkspaceChat({ mode: "file" }));
    expect(fetchConversation).not.toHaveBeenCalled();
  });

  it("keys conversation on activeWorkspaceId in workspace mode", () => {
    const { result } = renderHook(() => useWorkspaceChat({ mode: "workspace" }));
    expect(result.current.conversationKey).toBe("ws-1");
  });

  it("sends workspace_id in workspace mode", async () => {
    const { result } = renderHook(() => useWorkspaceChat({ mode: "workspace" }));
    await act(async () => {
      await result.current.sendMessage("Summarize all files");
    });
    const call = (streamWorkspaceChat as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = call[3];
    expect(options.workspace_id).toBe("ws-1");
    expect(options.document_id).toBeUndefined();
  });

  it("clears messages when selectedDocumentId changes in file mode", () => {
    useDocumentStore.setState({
      ...useDocumentStore.getState(),
      selectedDocumentId: "doc-1",
      conversations: {
        "doc-1": {
          entries: [{ id: "e1", query: "q", response: "r", timestamp: "t", sourceCount: 0, sources: [], errorMessage: null }],
          isStreaming: false,
          streamingText: "",
        },
      },
    });
    const { result, rerender } = renderHook(() => useWorkspaceChat({ mode: "file" }));
    expect(result.current.conversation?.entries.length).toBe(1);

    act(() => {
      useDocumentStore.setState({
        ...useDocumentStore.getState(),
        selectedDocumentId: "doc-2",
      });
    });
    rerender();
    expect(result.current.conversation?.entries.length ?? 0).toBe(0);
  });
});
```

- [ ] **Step 10.3: Run to confirm failure**

```bash
npm test -- src/hooks/useWorkspaceChat.test.ts
```

Expected: tests FAIL — hook doesn't accept a `mode` option and always hydrates.

- [ ] **Step 10.4: Rewrite `useWorkspaceChat` to support file mode**

Replace the existing hook with:

```typescript
// src/hooks/useWorkspaceChat.ts
import { useCallback, useEffect, useRef } from "react";
import { useDocumentStore } from "../store/documentStore";
import { fetchConversation, saveConversationEntry, streamWorkspaceChat } from "../lib/api";
import { useWorkspaceStore } from "../store/workspaceStore";
import { t } from "../lib/locale";

type ChatMode = "file" | "workspace";

type UseWorkspaceChatOptions = {
  mode?: ChatMode;
};

export function useWorkspaceChat(options: UseWorkspaceChatOptions = {}) {
  const mode: ChatMode = options.mode ?? "file";

  const conversations = useDocumentStore((s) => s.conversations);
  const startQuery = useDocumentStore((s) => s.startWorkspaceQuery);
  const appendToken = useDocumentStore((s) => s.appendStreamingToken);
  const finalize = useDocumentStore((s) => s.finalizeStreamingEntry);
  const hydrate = useDocumentStore((s) => s.hydrateConversation);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const selectedDocumentId = useDocumentStore((s) => s.selectedDocumentId);

  const abortRef = useRef<AbortController | null>(null);

  const conversationKey: string | null =
    mode === "file" ? selectedDocumentId : activeWorkspaceId;

  const workspaceIdForRequest = mode === "workspace" ? activeWorkspaceId ?? undefined : undefined;
  const documentIdForRequest = mode === "file" ? selectedDocumentId ?? undefined : undefined;

  const conversation = conversationKey ? conversations[conversationKey] : undefined;
  const isStreaming = conversation?.isStreaming ?? false;

  // Hydrate persisted conversation only in workspace mode. File mode is ephemeral.
  useEffect(() => {
    if (mode !== "workspace") return;
    if (!conversationKey) return;
    const existing = useDocumentStore.getState().conversations[conversationKey];
    if (existing && existing.entries.length > 0) return;

    let cancelled = false;
    fetchConversation(conversationKey)
      .then((data) => {
        if (cancelled || !data.entries.length) return;
        hydrate(
          conversationKey,
          data.entries.map((e) => ({
            id: e.id,
            query: e.query,
            response: e.response,
            timestamp: e.timestamp,
            sourceCount: e.sourceCount,
            sources: e.sources,
            errorMessage: e.errorMessage,
          }))
        );
      })
      .catch(() => {
        // Hydration failure is non-fatal
      });
    return () => {
      cancelled = true;
    };
  }, [mode, conversationKey, hydrate]);

  // Abort any in-flight stream when context changes or component unmounts
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [conversationKey]);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!conversationKey) return;
      const currentConv = useDocumentStore.getState().conversations[conversationKey];
      if (currentConv?.isStreaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      startQuery(conversationKey, message);

      const conv = useDocumentStore.getState().conversations[conversationKey];
      const history: Array<{ role: string; content: string }> = [];
      if (conv) {
        for (const entry of conv.entries.slice(0, -1)) {
          if (entry.query) history.push({ role: "user", content: entry.query });
          if (entry.response) history.push({ role: "assistant", content: entry.response });
        }
      }

      let sourceCount = 0;
      let sources: Array<{ id: string; title: string }> = [];
      let errorMessage: string | null = null;
      let tokenCount = 0;
      try {
        for await (const event of streamWorkspaceChat(undefined, message, history, {
          signal: controller.signal,
          ...(workspaceIdForRequest ? { workspace_id: workspaceIdForRequest } : {}),
          ...(documentIdForRequest ? { document_id: documentIdForRequest } : {}),
        })) {
          if (event.type === "context") {
            sourceCount = event.data.source_count;
            sources = event.data.sources ?? [];
          } else if (event.type === "token") {
            appendToken(conversationKey, event.data.text);
            tokenCount++;
          } else if (event.type === "error") {
            console.error("workspace.chat.failed", event.data.error);
            errorMessage = event.data.error || t("chat.unknown_error");
            break;
          }
        }
        if (!errorMessage && tokenCount === 0) {
          errorMessage = t("chat.empty_response");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          finalize(conversationKey, sourceCount, sources, null);
          return;
        }
        errorMessage = error instanceof Error ? error.message : t("chat.connection_error");
      }
      finalize(conversationKey, sourceCount, sources, errorMessage);

      // Persist the finalized entry only in workspace mode. File mode is ephemeral.
      if (mode === "workspace") {
        const finalConv = useDocumentStore.getState().conversations[conversationKey];
        if (finalConv && finalConv.entries.length > 0) {
          const lastEntry = finalConv.entries[finalConv.entries.length - 1];
          saveConversationEntry(conversationKey, {
            query: lastEntry.query,
            response: lastEntry.response,
            sourceCount: lastEntry.sourceCount,
            sources: lastEntry.sources,
            errorMessage: lastEntry.errorMessage,
          }).catch(() => {
            // Non-fatal
          });
        }
      }
    },
    [mode, conversationKey, workspaceIdForRequest, documentIdForRequest, startQuery, appendToken, finalize]
  );

  return { conversation, isStreaming, sendMessage, conversationKey, selectedDocumentId };
}
```

- [ ] **Step 10.5: Run to confirm pass**

```bash
npm test -- src/hooks/useWorkspaceChat.test.ts
```

Expected: all six tests PASS.

- [ ] **Step 10.6: Run the full frontend suite to check for regressions from existing hook callers**

```bash
npm test
```

Expected: existing callers of `useWorkspaceChat()` (for example `ChatDrawer`, `WorkspaceNotebook`, `WorkspaceView`) were relying on workspace-scoped behavior. The new default is `"file"`, so these callers will now use per-file scope unless updated. To keep them working until they are deleted in Task 14, find each call site and explicitly pass `{ mode: "workspace" }`:

```bash
grep -rn "useWorkspaceChat(" src/components src/hooks | grep -v "mode:" | grep -v "test"
```

For every hit, edit the call to `useWorkspaceChat({ mode: "workspace" })`. This is a temporary stabilization — those components are deleted in Task 14, so this edit is scoped to the cleanup bridge only. Do NOT update the new `FileChatView` (it correctly uses `{ mode: "file" }`).

Re-run `npm test` until green.

- [ ] **Step 10.7: Commit**

```bash
git add src/hooks/useWorkspaceChat.ts src/hooks/useWorkspaceChat.test.ts
git commit -m "feat(hooks): add file-scoped mode to useWorkspaceChat"
```

---

## Phase 5 — Root layout swap

With all new components built and tested, we now swap `App.tsx` to render the new two-column File-Chat view for non-inbox workspaces, keeping the Inbox view intact for the inbox workspace.

### Task 11: Build the FileChatView container

This is the container that composes `FileRail`, `FileContextCard`, and the chat stream (which currently lives inside `ChatDrawer` / `WorkspaceNotebook`). For this task, we inline a minimal chat surface into `FileChatView` and wire it to `useWorkspaceChat({ mode: "file" })`.

**Files:**
- Create: `src/components/FileChatView.tsx`
- Create: `src/components/FileChatView.test.tsx`

- [ ] **Step 11.1: Write the failing test**

```typescript
// src/components/FileChatView.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileChatView } from "./FileChatView";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import type { UiDocument } from "../types/documents";

vi.mock("../lib/api", async () => ({
  streamWorkspaceChat: vi.fn(async function* () {}),
  fetchConversation: vi.fn(async () => ({ entries: [] })),
  saveConversationEntry: vi.fn(async () => {}),
}));

function makeDoc(id: string, title: string): UiDocument {
  return {
    id,
    title,
    summary: `${title} summary`,
    kind: "receipt",
    documentType: "receipt",
    template: "receipt",
    mimeType: "application/pdf",
    sourceModality: "text",
    sourcePath: null,
    createdAt: "2026-04-08",
    updatedAt: "2026-04-08",
    requestId: `req-${id}`,
    status: "completed",
    tags: [],
    warnings: [],
    retryable: false,
    errorCode: null,
    undoToken: null,
    moveStatus: "not_requested",
    classification: {
      document_type: "receipt",
      template: "receipt",
      title,
      summary: `${title} summary`,
      tags: [],
      language: "sv",
      confidence: 0.9,
      ocr_text: null,
      suggested_actions: [],
    },
    extraction: null,
    transcription: null,
    movePlan: null,
    moveResult: null,
    diagnostics: null,
    thumbnailData: null,
  } as unknown as UiDocument;
}

describe("FileChatView", () => {
  beforeEach(() => {
    const docs = [makeDoc("a", "File A"), makeDoc("b", "File B")];
    useDocumentStore.setState({
      ...useDocumentStore.getState(),
      documents: Object.fromEntries(docs.map((d) => [d.id, d])),
      documentOrder: docs.map((d) => d.id),
      selectedDocumentId: "a",
      conversations: {},
    });
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "ws-1",
          name: "Legal Case",
          description: "",
          ai_brief: "",
          ai_entities: [],
          ai_topics: [],
          cover_color: "",
          is_inbox: false,
          file_count: 2,
          created_at: "2026-04-08",
          updated_at: "2026-04-08",
        },
      ],
      activeWorkspaceId: "ws-1",
      activeWorkspaceTab: "documents",
      loading: false,
      error: null,
      backendStatus: "online",
      activeFileIdByWorkspace: { "ws-1": "a" },
      workspaceModalOpen: false,
      workspaceModalTab: "overview",
    });
  });

  it("renders the file rail with workspace files", () => {
    render(<FileChatView />);
    expect(screen.getByText("File A")).toBeInTheDocument();
    expect(screen.getByText("File B")).toBeInTheDocument();
  });

  it("renders the file context card for the selected file", () => {
    render(<FileChatView />);
    expect(screen.getByText("File A summary")).toBeInTheDocument();
  });

  it("renders the chat input", () => {
    render(<FileChatView />);
    expect(screen.getByPlaceholderText(/fråga något/i)).toBeInTheDocument();
  });

  it("renders the workspace filter chip", () => {
    render(<FileChatView />);
    expect(screen.getByRole("button", { name: /Legal Case/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 11.2: Run to confirm failure**

```bash
npm test -- src/components/FileChatView.test.tsx
```

Expected: tests FAIL — component does not exist.

- [ ] **Step 11.3: Implement FileChatView**

```typescript
// src/components/FileChatView.tsx
import { useState } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkspaceChat } from "../hooks/useWorkspaceChat";
import { FileRail } from "./FileRail";
import { FileContextCard } from "./FileContextCard";
import { WorkspaceFilterChip } from "./WorkspaceFilterChip";

export function FileChatView() {
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);
  const selectedDocumentId = useDocumentStore((s) => s.selectedDocumentId);
  const setSelected = useDocumentStore((s) => s.setSelectedDocument);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveFile = useWorkspaceStore((s) => s.setActiveFile);

  const files = documentOrder.map((id) => documents[id]).filter(Boolean);
  const selectedFile = selectedDocumentId ? documents[selectedDocumentId] ?? null : null;

  const { conversation, isStreaming, sendMessage } = useWorkspaceChat({ mode: "file" });
  const [draft, setDraft] = useState("");

  function handleSelectFile(fileId: string) {
    setSelected(fileId);
    if (activeWorkspaceId) {
      setActiveFile(activeWorkspaceId, fileId);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || isStreaming) return;
    const text = draft;
    setDraft("");
    await sendMessage(text);
  }

  return (
    <div className="flex h-full w-full min-h-0">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--surface-4)]">
        <WorkspaceFilterChip />
        <div className="mt-3 flex-1 overflow-y-auto">
          <FileRail
            files={files}
            activeFileId={selectedDocumentId}
            onSelectFile={handleSelectFile}
          />
        </div>
        <div className="border-t border-[var(--surface-4)] px-3 py-2 text-xs-ui text-[var(--text-muted)]">
          j/k = byt fil · ⌘K = sök
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col p-4">
        <div className="mb-3 shrink-0">
          <FileContextCard file={selectedFile} />
        </div>

        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[var(--card-radius)] border border-[var(--surface-4)] bg-[var(--surface-4)] p-4"
          aria-live="polite"
        >
          {conversation?.entries.map((entry) => (
            <div key={entry.id} className="mb-3 last:mb-0">
              <p className="text-sm-ui text-[var(--text-primary)]">
                <span className="mr-2 text-xs-ui uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Du
                </span>
                {entry.query}
              </p>
              {entry.response && (
                <p className="mt-1 text-sm-ui text-[var(--text-secondary)]">
                  <span className="mr-2 text-xs-ui uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    AI
                  </span>
                  {entry.response}
                </p>
              )}
              {entry.errorMessage && (
                <p className="mt-1 text-sm-ui text-red-400">{entry.errorMessage}</p>
              )}
            </div>
          ))}
          {conversation?.isStreaming && conversation.streamingText && (
            <p className="text-sm-ui text-[var(--text-secondary)]">{conversation.streamingText}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-3 shrink-0">
          <input
            type="text"
            placeholder={
              selectedFile
                ? `Fråga något om ${selectedFile.title}…`
                : "Fråga något om den här filen…"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!selectedFile || isStreaming}
            className="w-full rounded-[var(--button-radius)] bg-[var(--surface-6)] px-4 py-2 text-sm-ui text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </form>
      </main>
    </div>
  );
}
```

- [ ] **Step 11.4: Run to confirm pass**

```bash
npm test -- src/components/FileChatView.test.tsx
```

Expected: all four tests PASS.

- [ ] **Step 11.5: Commit**

```bash
git add src/components/FileChatView.tsx src/components/FileChatView.test.tsx
git commit -m "feat(ui): add FileChatView composing rail, context card, and chat stream"
```

### Task 12: Build the InboxView container

The existing Inbox flow lives inside the current `WorkspaceView`. We extract the inbox-only path into a dedicated `InboxView` component so that `App.tsx` can route explicitly between the two top-level views.

**Files:**
- Create: `src/components/InboxView.tsx`

- [ ] **Step 12.1: Confirm WorkspaceView still exists and renders the inbox flow**

```bash
ls src/components/WorkspaceView.tsx
```

The `WorkspaceView` file is not deleted by this pivot. It continues to host the inbox-specific layout (workspace-suggester badges, triage progress, bulk move actions). Task 14 only deletes `ChatDrawer`, `WorkspaceSidebar`, and `InspectorPane` — not `WorkspaceView`.

- [ ] **Step 12.2: Create the InboxView shell that re-uses existing primitives**

For the initial pivot, `InboxView` is a thin wrapper that re-uses the existing `WorkspaceView` for the inbox case. This means `WorkspaceView` is NOT deleted in Task 14 — instead, Task 14 renames it to `InboxView` or splits out only the inbox-relevant code. Given the size of `WorkspaceView`, the pragmatic move is:

```typescript
// src/components/InboxView.tsx
// Temporary: delegates to the legacy WorkspaceView while the inbox-specific
// layout continues to use its current implementation. A future cleanup task
// can extract the inbox-only code path once the pivot is stable.
import { WorkspaceView } from "./WorkspaceView";

export function InboxView() {
  return <WorkspaceView />;
}
```

**Rationale:** Extracting inbox code from `WorkspaceView` is a multi-day refactor. For this pivot, the goal is simply to stop rendering `WorkspaceView` for non-inbox workspaces — not to re-architect the inbox flow. Task 14's cleanup therefore keeps `WorkspaceView.tsx` around as the Inbox implementation but renames any exported `WorkspaceView` usages in the codebase as dead references.

- [ ] **Step 12.3: Commit**

```bash
git add src/components/InboxView.tsx
git commit -m "feat(ui): add InboxView delegating to legacy workspace view"
```

### Task 13: Swap App.tsx to the new layout

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 13.1: Rewrite App.tsx**

```typescript
// src/App.tsx
import { useEffect, useState, startTransition } from "react";

import { CommandPalette } from "./components/CommandPalette";
import { FileMoveToast } from "./components/FileMoveToast";
import { WindowDropZone } from "./components/WindowDropZone";
import { ToastContainer } from "./components/ui/ToastContainer";
import { FileChatView } from "./components/FileChatView";
import { InboxView } from "./components/InboxView";
import { WorkspaceModal } from "./components/WorkspaceModal";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { fetchWorkspaceFiles } from "./lib/api";
import { getClientId } from "./lib/tauri-events";
import { useDocumentStore } from "./store/documentStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { useWebSocket } from "./hooks/useWebSocket";

export default function App() {
  const bootstrap = useDocumentStore((s) => s.bootstrap);
  const setClientId = useDocumentStore((s) => s.setClientId);
  const setFilesLoading = useDocumentStore((s) => s.setFilesLoading);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const checkBackend = useWorkspaceStore((s) => s.checkBackend);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  useWebSocket();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const clientId = await getClientId();
        if (cancelled) return;
        setClientId(clientId);
        await checkBackend();
      } catch (error) {
        if (!cancelled) console.error("app.bootstrap.failed", error);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [setClientId, checkBackend]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    setFilesLoading(true);
    async function loadFiles() {
      try {
        const payload = await fetchWorkspaceFiles(activeWorkspaceId!, 50);
        if (cancelled) return;
        startTransition(() => {
          bootstrap(
            payload.documents,
            {
              all: payload.total,
              processing: 0,
              receipt: 0,
              contract: 0,
              invoice: 0,
              meeting_notes: 0,
              report: 0,
              letter: 0,
              tax_document: 0,
              audio: 0,
              generic: 0,
              moved: 0,
            },
            []
          );
        });
      } catch (error) {
        if (!cancelled) console.error("workspace.files.failed", error);
      } finally {
        if (!cancelled) setFilesLoading(false);
      }
    }
    void loadFiles();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, bootstrap, setFilesLoading]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && e.metaKey) {
        e.preventDefault();
        setCmdkOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const showInbox = activeWorkspace?.is_inbox ?? false;

  return (
    <div
      className="flex h-full flex-col overflow-hidden text-[var(--text-primary)]"
      style={{ background: "#111118" }}
    >
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showInbox ? <InboxView /> : <FileChatView />}
      </div>

      <WorkspaceModal />
      <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} />
      <FileMoveToast />
      <WindowDropZone />
      <ToastContainer />
    </div>
  );
}
```

- [ ] **Step 13.2: Run frontend tests to check for regressions**

```bash
npm test
```

Expected: tests that imported from `WorkspaceSidebar`, `InspectorPane`, or `WorkspaceView` as indirect dependencies may break. Fix them by updating imports or removing tests that no longer apply (those are handled in Task 14).

If tests fail because of compile errors (e.g., missing imports), resolve them here by removing the stale imports in test files. Do not delete tests yet — that's Task 14.

- [ ] **Step 13.3: Run the type-check and build**

```bash
npm run build
```

Expected: build succeeds. If it fails because of unused imports, remove them.

- [ ] **Step 13.4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): swap App root to FileChatView/InboxView layout"
```

---

## Phase 6 — Cleanup: delete orphaned components

At this point the new layout is live. The old components are no longer rendered but still exist in the codebase. Remove them and their tests so the codebase stays clean and the test count reflects reality.

### Task 14: Delete orphaned components and update affected tests

**Files:**
- Delete: `src/components/ChatDrawer.tsx`
- Delete: any `src/components/ChatDrawer.test.tsx` if it exists
- Delete: `src/components/WorkspaceSidebar.tsx`
- Delete: `src/components/WorkspaceSidebar.test.tsx`
- Delete: `src/components/InspectorPane.tsx`
- Delete: any inspector-specific test files
- Keep: `src/components/WorkspaceView.tsx` (now used only by `InboxView`)
- Keep: `src/components/WorkspaceView.test.tsx` (now exercises the inbox code path)

- [ ] **Step 14.1: Inventory the files that exist**

```bash
ls src/components/ChatDrawer* src/components/WorkspaceSidebar* src/components/InspectorPane* 2>/dev/null
```

- [ ] **Step 14.2: Delete ChatDrawer**

```bash
rm -f src/components/ChatDrawer.tsx src/components/ChatDrawer.test.tsx
```

- [ ] **Step 14.3: Delete WorkspaceSidebar**

```bash
rm -f src/components/WorkspaceSidebar.tsx src/components/WorkspaceSidebar.test.tsx
```

- [ ] **Step 14.4: Delete InspectorPane**

```bash
rm -f src/components/InspectorPane.tsx src/components/InspectorPane.test.tsx
```

- [ ] **Step 14.5: Grep for any dangling imports**

```bash
npm test 2>&1 | grep -i "cannot find\|cannot resolve\|failed to resolve" || echo "no dangling imports"
```

If anything turns up, open the offending file and remove or replace the stale import.

- [ ] **Step 14.6: Run the full frontend test suite**

```bash
npm test
```

Expected: tests pass. Count must be ≥ baseline (from Step P.4). If it's lower, some tests were deleted without replacement — add the missing tests or document why the coverage loss is acceptable (it should not be acceptable per the spec's hard rule).

- [ ] **Step 14.7: Run build and cargo check**

```bash
npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: both pass.

- [ ] **Step 14.8: Commit**

```bash
git add -A src/components/
git commit -m "refactor(ui): delete orphaned ChatDrawer, WorkspaceSidebar, InspectorPane"
```

### Task 15: Wire workspace modal body content

Now that the shell is live, replace the placeholder text in `WorkspaceModal` with the actual reused components (`WorkspaceHeader` for the overview, `DiscoveryCards` for discoveries, `InsightsFeed` for insights, action queue list for todos, workspace-mode chat for ask_workspace). The "people" tab can initially reuse the entity display from `WorkspaceHeader` or show a placeholder.

**Files:**
- Modify: `src/components/WorkspaceModal.tsx`

- [ ] **Step 15.1: Update imports**

At the top of `src/components/WorkspaceModal.tsx`, add:

```typescript
import { WorkspaceHeader } from "./WorkspaceHeader";
import { DiscoveryCards } from "./DiscoveryCards";
import { InsightsFeed } from "./InsightsFeed";
```

- [ ] **Step 15.2: Replace the placeholder section bodies**

In the `<section>` block that currently contains the placeholders, replace each placeholder `<p>` with the real component:

```typescript
        <section className="flex-1 overflow-y-auto px-6 py-4 text-sm-ui text-[var(--text-secondary)]">
          {activeTab === "overview" && <WorkspaceHeader />}
          {activeTab === "people" && (
            <p className="text-[var(--text-muted)]">Personer och saker visas i "Översikt" tills en dedikerad entity-vy byggs (uppföljning).</p>
          )}
          {activeTab === "discoveries" && <DiscoveryCards />}
          {activeTab === "insights" && <InsightsFeed />}
          {activeTab === "todos" && (
            <p className="text-[var(--text-muted)]">Att göra-listan är fortfarande i ActionCard-form i sidebaren (flytta hit i en uppföljning).</p>
          )}
          {activeTab === "ask_workspace" && (
            <p className="text-[var(--text-muted)]">Workspace-chat flyttas hit i en uppföljning — den befintliga WorkspaceNotebook-komponenten kan monteras här i nästa iteration.</p>
          )}
        </section>
```

**Rationale:** The "people" tab is deferred to a follow-up because it requires a new `WorkspaceHeader` prop (or a dedicated entity view), and the pivot should not drag unrelated component surgery into its scope. The existing header already shows entities in the overview tab.

- [ ] **Step 15.3: Confirm the existing WorkspaceModal test still passes**

The test `it("shows the overview tab content by default")` already asserts that the brief text `"pågående tvisten"` is rendered. Since `WorkspaceHeader` renders `activeWorkspace.ai_brief`, this assertion continues to hold once the placeholder is replaced. No test edits are needed unless `WorkspaceHeader` requires additional store state that was not previously seeded — in which case extend the `seed()` helper in the test to include it.

- [ ] **Step 15.4: Run affected tests**

```bash
npm test -- src/components/WorkspaceModal.test.tsx
```

Expected: all pass. If `WorkspaceHeader` or `DiscoveryCards` require store state that was not seeded in the modal test, extend the seed function in the test to provide the missing state.

- [ ] **Step 15.5: Run the full frontend suite**

```bash
npm test
```

Expected: all pass. Count ≥ baseline.

- [ ] **Step 15.6: Commit**

```bash
git add src/components/WorkspaceModal.tsx src/components/WorkspaceModal.test.tsx
git commit -m "feat(ui): wire WorkspaceModal tabs to real workspace components"
```

---

## Phase 7 — Verification and sanity check

### Task 16: Full verification chain

- [ ] **Step 16.1: Backend tests**

```bash
PYTHONPATH=. pytest server/tests -q
```

Expected: all pass.

- [ ] **Step 16.2: Frontend tests**

```bash
npm test 2>&1 | tail -10
```

Expected: all pass. Count ≥ baseline from Step P.4.

- [ ] **Step 16.3: Frontend build**

```bash
npm run build
```

Expected: build succeeds without errors.

- [ ] **Step 16.4: Cargo check**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: clean.

- [ ] **Step 16.5: Start the backend and smoke-test a file-scoped chat call**

```bash
ADH_LOCALE=sv uvicorn server.main:app --host 127.0.0.1 --port 9000 &
SERVER_PID=$!
sleep 3
```

- [ ] **Step 16.6: Verify the backend is healthy**

```bash
curl -s http://127.0.0.1:9000/healthz
```

Expected: `{"status":"ok"}` or similar.

- [ ] **Step 16.7: Send a document-scoped chat request via curl**

Pick any existing document id from the local database. You can list available documents with:

```bash
curl -s http://127.0.0.1:9000/documents?limit=1 | python -m json.tool | grep '"id"' | head -1
```

Then fire a chat request against that id (replace `<DOC_ID>`):

```bash
curl -N -X POST http://127.0.0.1:9000/workspace/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Sammanfatta filen","document_id":"<DOC_ID>","history":[]}'
```

Expected: SSE stream yields `context` → `token` × N → `done`. The context event should show `source_count: 1`.

- [ ] **Step 16.8: Kill the backend process**

```bash
kill $SERVER_PID
```

- [ ] **Step 16.9: Start the Tauri dev app and manually verify the new layout**

```bash
npm run tauri dev
```

Verify manually:
1. The app opens with the two-column layout.
2. Clicking a non-inbox workspace shows the new File-Chat view.
3. Clicking the Inbox workspace shows the Inbox view (legacy layout).
4. Pressing `j`/`k` advances the selected file in the rail without latency.
5. `FileContextCard` updates to show the new file's title, summary, and tags.
6. Typing a question and pressing Enter streams a response.
7. Clicking the workspace filter chip → "Öppna workspace-översikt" opens the modal.
8. Pressing Escape closes the modal.

- [ ] **Step 16.10: Commit any last-minute fixes**

If anything small needs adjusting from the manual check, fix it with a focused commit:

```bash
git add <files>
git commit -m "fix(ui): <short description>"
```

---

## Final checks

- [ ] **Step F.1: Confirm all tasks are checked off**
- [ ] **Step F.2: Verify test count floor**

```bash
npm test 2>&1 | grep -i "passed"
```

Record the new test count. It must be ≥ the baseline recorded in Step P.4.

- [ ] **Step F.3: Push the feature branch**

```bash
git push -u origin feature/per-file-chat-pivot
```

- [ ] **Step F.4: Open a pull request** (only if the user explicitly asks)

Do not open a PR without an explicit request from the user. Pausing here respects the principle that PR creation is a user-authorized action, not an agent-initiated one.

---

## Appendix: Scope guardrails during implementation

If you find yourself tempted to do any of the following during implementation, stop and flag it to the user instead. These are explicitly out of scope per the spec:

- Refactoring unrelated parts of the workspace API
- Splitting `documentStore` into a dedicated `fileStore`
- Extracting inbox-only code out of `WorkspaceView` (Task 12 keeps the delegation)
- Removing the `chat_conversation` table or the `past_conversations` retrieval
- Changing Tauri Rust code beyond `cargo check`
- Updating design tokens or colors
- Adding new languages
- Adding per-file chat memory
- Adding drag-and-drop file-to-chat
- Adding multi-file chat context

These belong in follow-up plans, not this one. The goal of the current plan is the smallest coherent pivot that shifts the product's identity — nothing more.
