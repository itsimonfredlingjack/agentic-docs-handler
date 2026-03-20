# Code Style Guide

This document describes the coding conventions and patterns used in this codebase. Follow these guidelines when writing or modifying code.

## Language-Specific Conventions

### Python (server/)

#### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Modules/Files | `snake_case` | `process_pipeline.py`, `file_organizer.py` |
| Classes | `PascalCase` | `DocumentClassification`, `SearchPipeline` |
| Exception classes | `PascalCase` + `Error` | `OllamaServiceError`, `UnsupportedMediaTypeError` |
| Functions | `snake_case` | `process_upload`, `classify_text` |
| Private methods | `_snake_case` | `_load_state`, `_emit_event` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_HISTORY_TURNS`, `SUPPORTED_TEXT_TYPES` |
| Private constants | `_SCREAMING_SNAKE_CASE` | `_CLEANUP_INTERVAL_SECONDS` |
| Type aliases | `PascalCase` | `DocumentType`, `SourceModality` |
| Instance variables | `snake_case` | `self.base_url`, `self.documents_path` |
| Private attributes | `_snake_case` | `self._lock`, `self._documents` |

#### Functions

```python
# Keyword-only arguments with *
async def process_upload(
    self,
    *,
    filename: str,
    content: bytes,
    content_type: str | None,
    execute_move: bool,
    source_path: str | None,
    client_id: str | None = None,
) -> ProcessResponse:
    ...

# Optional parameters use | None = None
def create_app(
    *,
    config: AppConfig | None = None,
    pipeline: object | None = None,
) -> FastAPI:
    ...
```

#### Classes

```python
# Pydantic models for API contracts
class DocumentClassification(BaseModel):
    document_type: DocumentType
    template: str
    title: str
    summary: str
    tags: list[str] = Field(default_factory=list)

# Dataclasses for internal containers
@dataclass(slots=True)
class UndoMoveResult:
    response: UndoMoveResponse
    record: UiDocumentRecord | None

# Exception classes with extra fields
@dataclass(slots=True)
class OllamaServiceError(RuntimeError):
    code: str
    retryable: bool
    upstream: str
    message: str
    status_code: int | None = None
```

#### Type Hints

```python
# Use modern union syntax
def foo() -> str | None: ...

# Use Literal for string enums (not Python enum)
DocumentType = Literal[
    "receipt",
    "contract",
    "invoice",
    "meeting_notes",
    "generic",
    "unsupported",
]

# Use Field for defaults in Pydantic models
fields: dict[str, Any] = Field(default_factory=dict)
```

#### Module Organization

```python
# Standard library imports first
from __future__ import annotations
from pathlib import Path
from typing import Any

# Third-party imports
from fastapi import FastAPI
from pydantic import BaseModel

# Local imports
from server.config import AppConfig
from server.schemas import ProcessResponse
```

#### Tests

```python
# Test file naming: test_<module>.py
# Test function naming: test_<subject>_<action>_<expected>
def test_healthz_returns_process_liveness() -> None:
    ...

def test_thumbnail_from_jpeg() -> None:
    ...

# Use pytest fixtures for common setup
@pytest.fixture
def mock_ollama():
    ...
```

---

### TypeScript/React (src/)

#### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Component files | `PascalCase.tsx` | `DocumentRow.tsx`, `SearchBar.tsx` |
| Components | `export function PascalCase` | `export function DocumentRow() {}` |
| Props types | `Props` (internal) or `ComponentProps` | `type Props = { ... }` |
| Custom hooks | `usePascalCase` | `useSearch`, `useWebSocket` |
| Hook files | `useCamelCase.ts` | `useSearch.ts`, `useWebSocket.ts` |
| Store hooks | `useCamelCaseStore` | `useDocumentStore` |
| Types | `PascalCase` | `UiDocument`, `SearchResponse` |
| Functions | `camelCase` | `getTimeGroup`, `mapToUiDocument` |
| Variables | `camelCase` | `selectedDocumentId`, `stageHistory` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_HISTORY_TURNS` |
| CSS classes | `kebab-case` | `document-row`, `glass-panel` |

#### Components

```tsx
// Named export, internal Props type
type Props = {
  document: UiDocument;
  focused?: boolean;
  onSelect?: () => void;
};

export function DocumentRow({ document, focused, onSelect }: Props) {
  // Component body
}

// Default export only for App.tsx
export default function App() { ... }
```

#### Custom Hooks

```ts
// File: src/hooks/useSearch.ts
export function useSearch() {
  const searchState = useDocumentStore((state) => state.search);
  const setSearchLoading = useDocumentStore((state) => state.setSearchLoading);
  
  return {
    results: searchState.results,
    loading: searchState.loading,
    search: (query: string) => { ... },
  };
}
```

#### Zustand Store

```ts
// File: src/store/documentStore.ts
type DocumentStoreState = {
  // State
  clientId: string | null;
  documents: Record<string, UiDocument>;
  
  // Actions
  setClientId: (id: string) => void;
  upsertDocument: (doc: UiDocument) => void;
};

export const useDocumentStore = create<DocumentStoreState>((set) => ({
  clientId: null,
  documents: {},
  
  setClientId: (id) => set({ clientId: id }),
  upsertDocument: (doc) => set((state) => ({
    documents: { ...state.documents, [doc.id]: doc },
  })),
}));
```

#### Types

```ts
// Use type aliases over interfaces
// Use union types for string enums (not TypeScript enum)
export type DocumentType =
  | "receipt"
  | "contract"
  | "invoice"
  | "meeting_notes"
  | "generic";

export type UiDocument = {
  id: string;
  title: string;
  document_type: DocumentType;
  // ...
};
```

#### Utility Functions

```ts
// File: src/lib/feed-utils.ts
export function getTimeGroup(isoDate: string, now: number = Date.now()): string {
  // ...
}

// Mappers: mapSourceToTarget
export function mapProcessResponseToUiDocument(response: ProcessResponse): UiDocument {
  // ...
}

// Predicates: isSomething
export function isProcessingStatus(status: string): status is ProcessingStatus {
  return ["pending", "processing", "completed"].includes(status);
}
```

#### Event Handlers

```tsx
// Named handlers: handleEvent
const handleKeyDown = useCallback((e: KeyboardEvent) => {
  if (e.key === "Escape") {
    onClose();
  }
}, [onClose]);

// Props callbacks: onAction
type Props = {
  onSelect?: () => void;
  onRetry?: () => void;
  onUndo?: () => void;
};
```

#### Tests

```tsx
// File: ComponentName.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentRow } from "./DocumentRow";

describe("DocumentRow", () => {
  it("renders completed document with key line", () => {
    render(<DocumentRow document={baseDoc} />);
    expect(screen.getByText("faktura-mars.pdf")).toBeInTheDocument();
  });
});
```

---

### Rust (src-tauri/)

#### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Structs | `PascalCase` | `AppRuntimeState`, `MoveExecutionResult` |
| Functions | `snake_case` | `get_client_id`, `execute_move` |
| Variables | `snake_case` | `client_id`, `backend_base_url` |
| Modules | `snake_case` | `mod ws_client;` |
| Event names | `category:name` | `backend:event`, `backend:connection` |

#### Structs

```rust
// Structs: PascalCase
struct AppRuntimeState {
    client_id: String,
    backend_base_url: String,
}

// JSON serialization: use serde(rename_all)
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionPayload {
    state: String,
    client_id: Option<String>,
}
```

#### Tauri Commands

```rust
// Commands: snake_case, use State for dependency injection
#[tauri::command]
fn get_client_id(state: State<'_, AppRuntimeState>) -> String {
    state.client_id.clone()
}

#[tauri::command]
fn move_local_file(source_path: String, destination_dir: String) -> MoveExecutionResult {
    // ...
}
```

---

## Common Patterns

### Error Handling

#### Python

```python
# Custom exception classes with dataclass
@dataclass(slots=True)
class OllamaServiceError(RuntimeError):
    code: str
    retryable: bool
    upstream: str

# Re-raise with context
try:
    result = await self.ollama_client.chat_json(...)
except OllamaServiceError as error:
    raise ClassificationValidationError(str(error)) from error
```

#### TypeScript

```ts
// Throw descriptive errors
if (!response.ok) {
  throw new Error(`Failed to fetch documents: ${response.status}`);
}

// Try-catch with typed error
try {
  const data = await fetchDocuments();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
}
```

### Logging

#### Python

```python
import logging

logger = logging.getLogger(__name__)

# Structured log messages
logger.info("pipeline.classify.start request_id=%s filename=%s", request_id, filename)
logger.info("pipeline.classify.done request_id=%s elapsed_ms=%s", request_id, elapsed_ms)
```

#### TypeScript

```ts
// Console for frontend (consider structured logging library for production)
console.log("[DocumentStore] Upserting document:", doc.id);
console.error("[API] Failed to fetch:", error);
```

### Async Patterns

#### Python

```python
# Async context managers for locks
async with self._llm_sequence_lock:
    result = await self.classifier.classify_text(...)

# Background tasks
task = asyncio.create_task(self._index_document(...))
self._background_tasks.add(task)
task.add_done_callback(self._background_tasks.discard)

# Gather with return_exceptions
await asyncio.gather(*tasks, return_exceptions=True)
```

#### TypeScript

```ts
// Async/await
const response = await fetch("/process", { method: "POST", body: formData });

// Promise.all for parallel
const [documents, counts] = await Promise.all([
  fetchDocuments(),
  fetchCounts(),
]);
```

---

## File Organization

### Python Module Structure

```
server/
├── __init__.py
├── main.py              # App factory
├── config.py            # Configuration
├── schemas.py           # Pydantic models
├── module_name.py       # Module implementation
└── tests/
    └── test_module_name.py
```

### React Component Structure

```
src/
├── components/
│   ├── ComponentName.tsx      # Component
│   └── ComponentName.test.tsx # Colocated test
├── hooks/
│   └── useHookName.ts
├── lib/
│   └── utility-name.ts
├── store/
│   └── storeName.ts
└── types/
    └── typeName.ts
```

---

## Do's and Don'ts

### Do

- ✅ Use keyword-only arguments in Python (`*` in function signature)
- ✅ Use `snake_case` for Python, `camelCase` for TypeScript
- ✅ Use `PascalCase` for classes, components, and types in all languages
- ✅ Colocate tests with source files (TS) or in `tests/` directory (Python)
- ✅ Use `Literal` type for string enums in Python and TypeScript
- ✅ Use `| None` for optional types in Python 3.10+
- ✅ Add `#[serde(rename_all = "camelCase")]` for Rust structs serialized to JSON

### Don't

- ❌ Import from `server/api/` or `server/mcp/` in `server/pipelines/`
- ❌ Use `enum` keyword in Python or TypeScript (use `Literal` unions)
- ❌ Use default exports except for `App.tsx`
- ❌ Hardcode URLs or configuration values
- ❌ Catch exceptions without re-raising or handling appropriately
- ❌ Mix naming conventions within a module

---

## Quick Reference

### Python

```python
# Naming
snake_case_function()
PascalCaseClass
SCREAMING_SNAKE_CASE_CONSTANT
_snake_case_private

# Types
def foo(x: str | None) -> list[dict[str, Any]]: ...

# Pydantic
class Model(BaseModel):
    field: str = Field(default_factory=list)
```

### TypeScript

```ts
// Naming
camelCaseFunction()
PascalCaseComponent
SCREAMING_SNAKE_CASE_CONSTANT

// Types
type MyType = "a" | "b" | "c";
interface Props { foo: string; bar?: number; }

// Hooks
export function useSomething() { ... }
```

### Rust

```rust
// Naming
snake_case_function()
PascalCaseStruct
snake_case_variable

// Serde for JSON
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Payload { client_id: String }
```
