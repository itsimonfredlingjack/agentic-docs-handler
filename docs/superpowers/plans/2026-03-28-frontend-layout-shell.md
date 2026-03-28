# Frontend Layout Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current flat document-list UI with a workspace-centric layout: sidebar with workspace navigation, workspace view with file list, command palette (⌘K), and toggleable chat panel.

**Architecture:** New `workspaceStore` (Zustand) owns workspace list + active workspace ID. Existing `documentStore` fetches workspace-filtered files. New components: `WorkspaceSidebar`, `WorkspaceView`, `WorkspaceHeader`, `CommandPalette`. `App.tsx` rewired to new 3-panel layout.

**Tech Stack:** React 19, Zustand 5, cmdk (new dep), Tailwind CSS 3, existing CSS custom properties.

---

### Task 1: Install cmdk + add workspace types

**Files:**
- Modify: `package.json`
- Create: `src/types/workspace.ts`

- [ ] **Step 1: Install cmdk**

```bash
npm install cmdk
```

- [ ] **Step 2: Create workspace types**

Create `src/types/workspace.ts`:

```typescript
export type WorkspaceResponse = {
  id: string;
  name: string;
  description: string;
  ai_brief: string;
  ai_entities: Record<string, unknown>[];
  ai_topics: string[];
  cover_color: string;
  is_inbox: boolean;
  file_count: number;
  created_at: string;
  updated_at: string;
};

export type WorkspaceListResponse = {
  workspaces: WorkspaceResponse[];
};
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/types/workspace.ts package.json package-lock.json
git commit -m "feat: add cmdk dependency and workspace types"
```

---

### Task 2: Workspace API functions

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/lib/api.test.ts` (extend existing)

- [ ] **Step 1: Write test for fetchWorkspaces**

Add to `src/lib/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getBackendBaseUrl to return a test URL
vi.mock("./tauri-events", () => ({
  getBackendBaseUrl: vi.fn().mockResolvedValue("http://localhost:9000"),
  getClientId: vi.fn().mockResolvedValue("test-client"),
}));

describe("workspace API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchWorkspaces calls GET /workspaces", async () => {
    const mockResponse = {
      workspaces: [
        { id: "ws-1", name: "Inkorg", is_inbox: true, file_count: 3, description: "", ai_brief: "", ai_entities: [], ai_topics: [], cover_color: "", created_at: "", updated_at: "" },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const { fetchWorkspaces } = await import("./api");
    const result = await fetchWorkspaces();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:9000/workspaces",
      undefined,
    );
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0].name).toBe("Inkorg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/lib/api.test.ts
```

Expected: FAIL — `fetchWorkspaces` not exported.

- [ ] **Step 3: Add workspace API functions to `src/lib/api.ts`**

Add these exports at the end of `src/lib/api.ts`:

```typescript
import type { WorkspaceListResponse, WorkspaceResponse } from "../types/workspace";
import type { DocumentListResponse } from "../types/documents";

export async function fetchWorkspaces(): Promise<WorkspaceListResponse> {
  return fetchJson<WorkspaceListResponse>("/workspaces");
}

export async function createWorkspace(
  name: string,
  description = "",
  cover_color = "",
): Promise<WorkspaceResponse> {
  return fetchJson<WorkspaceResponse>("/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, cover_color }),
  });
}

export async function updateWorkspace(
  id: string,
  fields: { name?: string; description?: string; cover_color?: string },
): Promise<WorkspaceResponse> {
  return fetchJson<WorkspaceResponse>(`/workspaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
}

export async function deleteWorkspace(id: string): Promise<void> {
  const baseUrl = await resolveBaseUrl();
  const response = await fetch(`${baseUrl}/workspaces/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`/workspaces/${id}:${response.status}`);
  }
}

export async function fetchWorkspaceFiles(
  workspaceId: string,
  limit = 50,
  offset = 0,
): Promise<DocumentListResponse> {
  const payload = await fetchJson<{
    documents: Array<Parameters<typeof mapRegistryRecordToUiDocument>[0]>;
    total: number;
  }>(`/workspaces/${workspaceId}/files?limit=${limit}&offset=${offset}`);
  return {
    documents: payload.documents.map((doc) => mapRegistryRecordToUiDocument(doc)) as UiDocument[],
    total: payload.total,
  };
}

export async function moveFilesToWorkspace(
  workspaceId: string,
  fileIds: string[],
): Promise<{ moved: number }> {
  return fetchJson<{ moved: number }>(`/workspaces/${workspaceId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_ids: fileIds }),
  });
}
```

Note: The `fetchWorkspaceFiles` function needs the existing imports `mapRegistryRecordToUiDocument` and `UiDocument` which are already imported at the top of `api.ts`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/lib/api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "feat: add workspace API functions"
```

---

### Task 3: workspaceStore

**Files:**
- Create: `src/store/workspaceStore.ts`
- Create: `src/store/workspaceStore.test.ts`

- [ ] **Step 1: Write workspaceStore tests**

Create `src/store/workspaceStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";

vi.mock("../lib/api", () => ({
  fetchWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

describe("workspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      loading: false,
      error: null,
      chatPanelOpen: false,
    });
  });

  it("fetchWorkspaces populates list and sets inbox as active", async () => {
    const { fetchWorkspaces } = await import("../lib/api");
    (fetchWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue({
      workspaces: [
        { id: "inbox-1", name: "Inkorg", is_inbox: true, file_count: 3 },
        { id: "ws-2", name: "Skatt", is_inbox: false, file_count: 8 },
      ],
    });

    await useWorkspaceStore.getState().fetchWorkspaces();

    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(2);
    expect(state.activeWorkspaceId).toBe("inbox-1");
    expect(state.loading).toBe(false);
  });

  it("setActiveWorkspace updates activeWorkspaceId", () => {
    useWorkspaceStore.getState().setActiveWorkspace("ws-2");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
  });

  it("toggleChatPanel flips chatPanelOpen", () => {
    expect(useWorkspaceStore.getState().chatPanelOpen).toBe(false);
    useWorkspaceStore.getState().toggleChatPanel();
    expect(useWorkspaceStore.getState().chatPanelOpen).toBe(true);
    useWorkspaceStore.getState().toggleChatPanel();
    expect(useWorkspaceStore.getState().chatPanelOpen).toBe(false);
  });

  it("createWorkspace adds to list and refetches", async () => {
    const { createWorkspace, fetchWorkspaces } = await import("../lib/api");
    (createWorkspace as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-new", name: "Nytt projekt", is_inbox: false, file_count: 0,
    });
    (fetchWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue({
      workspaces: [
        { id: "inbox-1", name: "Inkorg", is_inbox: true, file_count: 0 },
        { id: "ws-new", name: "Nytt projekt", is_inbox: false, file_count: 0 },
      ],
    });

    useWorkspaceStore.setState({ activeWorkspaceId: "inbox-1" });
    const result = await useWorkspaceStore.getState().createWorkspace("Nytt projekt");

    expect(result.id).toBe("ws-new");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-new");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/store/workspaceStore.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement workspaceStore**

Create `src/store/workspaceStore.ts`:

```typescript
import { create } from "zustand";
import type { WorkspaceResponse } from "../types/workspace";
import {
  fetchWorkspaces as apiFetchWorkspaces,
  createWorkspace as apiCreateWorkspace,
  updateWorkspace as apiUpdateWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
} from "../lib/api";

type WorkspaceStoreState = {
  workspaces: WorkspaceResponse[];
  activeWorkspaceId: string | null;
  loading: boolean;
  error: string | null;
  chatPanelOpen: boolean;

  fetchWorkspaces: () => Promise<void>;
  setActiveWorkspace: (id: string) => void;
  createWorkspace: (name: string) => Promise<WorkspaceResponse>;
  updateWorkspace: (id: string, fields: { name?: string; description?: string; cover_color?: string }) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  toggleChatPanel: () => void;
  setChatPanelOpen: (open: boolean) => void;
};

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  loading: false,
  error: null,
  chatPanelOpen: false,

  fetchWorkspaces: async () => {
    set({ loading: true, error: null });
    try {
      const response = await apiFetchWorkspaces();
      const inbox = response.workspaces.find((ws) => ws.is_inbox);
      set({
        workspaces: response.workspaces,
        loading: false,
        activeWorkspaceId: get().activeWorkspaceId ?? inbox?.id ?? null,
      });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  setActiveWorkspace: (id) => {
    set({ activeWorkspaceId: id, chatPanelOpen: false });
  },

  createWorkspace: async (name) => {
    const ws = await apiCreateWorkspace(name);
    await get().fetchWorkspaces();
    set({ activeWorkspaceId: ws.id });
    return ws;
  },

  updateWorkspace: async (id, fields) => {
    await apiUpdateWorkspace(id, fields);
    await get().fetchWorkspaces();
  },

  deleteWorkspace: async (id) => {
    const inbox = get().workspaces.find((ws) => ws.is_inbox);
    await apiDeleteWorkspace(id);
    if (get().activeWorkspaceId === id) {
      set({ activeWorkspaceId: inbox?.id ?? null });
    }
    await get().fetchWorkspaces();
  },

  toggleChatPanel: () => set((s) => ({ chatPanelOpen: !s.chatPanelOpen })),
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
}));
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/store/workspaceStore.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/store/workspaceStore.ts src/store/workspaceStore.test.ts
git commit -m "feat: add workspaceStore with CRUD and active workspace"
```

---

### Task 4: WorkspaceSidebar component

**Files:**
- Create: `src/components/WorkspaceSidebar.tsx`
- Create: `src/components/WorkspaceSidebar.test.tsx`

- [ ] **Step 1: Write WorkspaceSidebar tests**

Create `src/components/WorkspaceSidebar.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { useWorkspaceStore } from "../store/workspaceStore";

describe("WorkspaceSidebar", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "inbox-1", name: "Inkorg", is_inbox: true, file_count: 3, description: "", ai_brief: "", ai_entities: [], ai_topics: [], cover_color: "", created_at: "", updated_at: "" },
        { id: "ws-2", name: "Bostadsrätten", is_inbox: false, file_count: 12, description: "", ai_brief: "", ai_entities: [], ai_topics: [], cover_color: "#5856d6", created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "inbox-1",
      loading: false,
      error: null,
      chatPanelOpen: false,
    });
  });

  it("renders inbox first and workspaces after", () => {
    render(<WorkspaceSidebar />);
    expect(screen.getByText("Inkorg")).toBeInTheDocument();
    expect(screen.getByText("Bostadsrätten")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("highlights the active workspace", () => {
    render(<WorkspaceSidebar />);
    const inboxItem = screen.getByText("Inkorg").closest("[data-workspace-id]");
    expect(inboxItem).toHaveAttribute("data-active", "true");
  });

  it("clicking a workspace calls setActiveWorkspace", () => {
    const setActive = vi.fn();
    useWorkspaceStore.setState({ setActiveWorkspace: setActive });
    render(<WorkspaceSidebar />);
    fireEvent.click(screen.getByText("Bostadsrätten"));
    expect(setActive).toHaveBeenCalledWith("ws-2");
  });

  it("shows create workspace button", () => {
    render(<WorkspaceSidebar />);
    expect(screen.getByText(/Ny workspace/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/components/WorkspaceSidebar.test.tsx
```

- [ ] **Step 3: Implement WorkspaceSidebar**

Create `src/components/WorkspaceSidebar.tsx`:

```tsx
import { useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";

const DEFAULT_COLORS = ["#5856d6", "#34c759", "#ff375f", "#ff9f0a", "#30b0c7", "#8e8e93"];

export function WorkspaceSidebar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const inbox = workspaces.find((ws) => ws.is_inbox);
  const others = workspaces.filter((ws) => !ws.is_inbox);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    setIsCreating(false);
    await createWorkspace(name);
  }

  return (
    <nav className="workspace-sidebar">
      <div className="workspace-sidebar__brand">Brainfileing</div>

      {inbox && (
        <button
          type="button"
          className="workspace-item"
          data-workspace-id={inbox.id}
          data-active={activeWorkspaceId === inbox.id}
          onClick={() => setActiveWorkspace(inbox.id)}
        >
          <span
            className="workspace-item__dot"
            style={{ background: "#ff9f0a" }}
          />
          <span className="workspace-item__name">{inbox.name}</span>
          <span className="workspace-item__count">{inbox.file_count}</span>
        </button>
      )}

      <div className="workspace-sidebar__divider" />
      <div className="workspace-sidebar__section-label">Workspaces</div>

      {others.map((ws, i) => (
        <button
          key={ws.id}
          type="button"
          className="workspace-item"
          data-workspace-id={ws.id}
          data-active={activeWorkspaceId === ws.id}
          onClick={() => setActiveWorkspace(ws.id)}
        >
          <span
            className="workspace-item__dot"
            style={{ background: ws.cover_color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] }}
          />
          <span className="workspace-item__name">{ws.name}</span>
          <span className="workspace-item__count">{ws.file_count}</span>
        </button>
      ))}

      <div className="workspace-sidebar__spacer" />

      {isCreating ? (
        <form
          className="workspace-sidebar__create-form"
          onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}
        >
          <input
            className="workspace-sidebar__create-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Namn..."
            autoFocus
            onBlur={() => { if (!newName.trim()) setIsCreating(false); }}
            onKeyDown={(e) => { if (e.key === "Escape") setIsCreating(false); }}
          />
        </form>
      ) : (
        <button
          type="button"
          className="workspace-sidebar__create-btn"
          onClick={() => setIsCreating(true)}
        >
          <span>+</span> Ny workspace
        </button>
      )}

      <div className="workspace-sidebar__kbd-hint">
        <kbd>⌘K</kbd>
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Add CSS to `src/index.css`**

Add inside the `@layer components` block in `src/index.css`:

```css
/* ── Workspace Sidebar ── */
.workspace-sidebar {
  width: var(--sidebar-width);
  background: rgba(255, 255, 255, 0.02);
  border-right: 1px solid var(--glass-border);
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  height: 100%;
  overflow-y: auto;
}
.workspace-sidebar__brand {
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  text-transform: uppercase;
  padding: 6px 10px 8px;
}
.workspace-sidebar__divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.05);
  margin: 6px 4px;
}
.workspace-sidebar__section-label {
  font-size: 10px;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.2);
  text-transform: uppercase;
  padding: 2px 10px 4px;
}
.workspace-sidebar__spacer {
  flex: 1;
}
.workspace-sidebar__create-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 6px;
  transition: color var(--transition-fast);
  width: 100%;
  text-align: left;
}
.workspace-sidebar__create-btn:hover {
  color: var(--text-secondary);
}
.workspace-sidebar__create-form {
  padding: 2px 6px;
}
.workspace-sidebar__create-input {
  width: 100%;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}
.workspace-sidebar__create-input:focus {
  border-color: var(--accent-primary);
}
.workspace-sidebar__kbd-hint {
  padding: 5px 10px;
  color: rgba(255, 255, 255, 0.2);
  font-size: 11px;
}
.workspace-sidebar__kbd-hint kbd {
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 10px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

/* ── Workspace Item ── */
.workspace-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  background: none;
  border: none;
  width: 100%;
  text-align: left;
  transition: background var(--transition-fast);
}
.workspace-item:hover {
  background: rgba(255, 255, 255, 0.04);
}
.workspace-item[data-active="true"] {
  background: rgba(88, 86, 214, 0.12);
  border: 1px solid rgba(88, 86, 214, 0.2);
}
.workspace-item__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.workspace-item__name {
  color: var(--text-secondary);
  font-size: 13px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-item[data-active="true"] .workspace-item__name {
  color: var(--text-primary);
}
.workspace-item__count {
  color: var(--text-muted);
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
}
```

Also update the `--sidebar-width` variable from `248px` to `240px`:

```css
--sidebar-width: 240px;
```

- [ ] **Step 5: Run tests**

```bash
npm test -- src/components/WorkspaceSidebar.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceSidebar.tsx src/components/WorkspaceSidebar.test.tsx src/index.css
git commit -m "feat: add WorkspaceSidebar component with CSS"
```

---

### Task 5: WorkspaceHeader component

**Files:**
- Create: `src/components/WorkspaceHeader.tsx`
- Create: `src/components/WorkspaceHeader.test.tsx`

- [ ] **Step 1: Write WorkspaceHeader tests**

Create `src/components/WorkspaceHeader.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceHeader } from "./WorkspaceHeader";
import type { WorkspaceResponse } from "../types/workspace";

const baseWorkspace: WorkspaceResponse = {
  id: "ws-1",
  name: "Bostadsrätten",
  description: "",
  ai_brief: "",
  ai_entities: [],
  ai_topics: [],
  cover_color: "#5856d6",
  is_inbox: false,
  file_count: 12,
  created_at: "",
  updated_at: "",
};

describe("WorkspaceHeader", () => {
  it("renders workspace name and file count", () => {
    render(<WorkspaceHeader workspace={baseWorkspace} onToggleChat={() => {}} />);
    expect(screen.getByText("Bostadsrätten")).toBeInTheDocument();
    expect(screen.getByText(/12 filer/)).toBeInTheDocument();
  });

  it("shows AI brief placeholder when no brief exists", () => {
    render(<WorkspaceHeader workspace={baseWorkspace} onToggleChat={() => {}} />);
    expect(screen.getByText(/AI brief/i)).toBeInTheDocument();
  });

  it("shows AI brief text when it exists", () => {
    const wsWithBrief = { ...baseWorkspace, ai_brief: "Dokument om lägenhetsköpet." };
    render(<WorkspaceHeader workspace={wsWithBrief} onToggleChat={() => {}} />);
    expect(screen.getByText("Dokument om lägenhetsköpet.")).toBeInTheDocument();
  });

  it("calls onToggleChat when chat button is clicked", () => {
    const onToggle = vi.fn();
    render(<WorkspaceHeader workspace={baseWorkspace} onToggleChat={onToggle} />);
    screen.getByRole("button", { name: /chat/i }).click();
    expect(onToggle).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/components/WorkspaceHeader.test.tsx
```

- [ ] **Step 3: Implement WorkspaceHeader**

Create `src/components/WorkspaceHeader.tsx`:

```tsx
import type { WorkspaceResponse } from "../types/workspace";

type WorkspaceHeaderProps = {
  workspace: WorkspaceResponse;
  onToggleChat: () => void;
};

export function WorkspaceHeader({ workspace, onToggleChat }: WorkspaceHeaderProps) {
  const hasBrief = workspace.ai_brief.length > 0;

  return (
    <header className="workspace-header">
      <div className="workspace-header__top">
        <span
          className="workspace-header__dot"
          style={{ background: workspace.cover_color || "var(--report-color)" }}
        />
        <h1 className="workspace-header__name">{workspace.name}</h1>
        <span className="workspace-header__count">
          {workspace.file_count} filer
        </span>
        <div className="workspace-header__actions">
          <button
            type="button"
            className="workspace-header__chat-btn"
            onClick={onToggleChat}
            aria-label="Toggle chat"
          >
            💬 Chat
          </button>
        </div>
      </div>

      {hasBrief ? (
        <p className="workspace-header__brief">{workspace.ai_brief}</p>
      ) : (
        <p className="workspace-header__brief workspace-header__brief--placeholder">
          AI brief genereras när pipelinen är klar...
        </p>
      )}

      <div className="workspace-header__divider" />
    </header>
  );
}
```

- [ ] **Step 4: Add CSS to `src/index.css`**

Add inside the `@layer components` block:

```css
/* ── Workspace Header ── */
.workspace-header {
  padding: 20px 24px 0;
}
.workspace-header__top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
.workspace-header__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.workspace-header__name {
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 600;
  margin: 0;
}
.workspace-header__count {
  color: var(--text-muted);
  font-size: 12px;
}
.workspace-header__actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.workspace-header__chat-btn {
  padding: 3px 10px;
  border-radius: 10px;
  font-size: 11px;
  background: var(--glass-bg);
  color: var(--text-secondary);
  cursor: pointer;
  border: none;
  transition: background var(--transition-fast);
}
.workspace-header__chat-btn:hover {
  background: var(--glass-bg-hover);
}
.workspace-header__brief {
  color: var(--text-secondary);
  font-size: 13px;
  margin: 0 0 0 19px;
  line-height: 1.5;
}
.workspace-header__brief--placeholder {
  color: var(--text-muted);
  font-style: italic;
  font-size: 12px;
}
.workspace-header__divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin-top: 14px;
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- src/components/WorkspaceHeader.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceHeader.tsx src/components/WorkspaceHeader.test.tsx src/index.css
git commit -m "feat: add progressive WorkspaceHeader component"
```

---

### Task 6: WorkspaceView component

**Files:**
- Create: `src/components/WorkspaceView.tsx`
- Create: `src/components/WorkspaceView.test.tsx`

- [ ] **Step 1: Write WorkspaceView tests**

Create `src/components/WorkspaceView.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceView } from "./WorkspaceView";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useDocumentStore } from "../store/documentStore";

describe("WorkspaceView", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Testprojekt", is_inbox: false, file_count: 0, description: "", ai_brief: "", ai_entities: [], ai_topics: [], cover_color: "#5856d6", created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "ws-1",
      chatPanelOpen: false,
    });
    useDocumentStore.setState({
      documents: {},
      documentOrder: [],
    });
  });

  it("renders workspace header with name", () => {
    render(<WorkspaceView />);
    expect(screen.getByText("Testprojekt")).toBeInTheDocument();
  });

  it("shows empty state when no files", () => {
    render(<WorkspaceView />);
    expect(screen.getByText(/Inga filer/)).toBeInTheDocument();
  });

  it("returns null when no active workspace", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    const { container } = render(<WorkspaceView />);
    expect(container.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/components/WorkspaceView.test.tsx
```

- [ ] **Step 3: Implement WorkspaceView**

Create `src/components/WorkspaceView.tsx`:

```tsx
import { useWorkspaceStore } from "../store/workspaceStore";
import { useDocumentStore } from "../store/documentStore";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { DocumentRow } from "./DocumentRow";
import { DropZone } from "./DropZone";

export function WorkspaceView() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const toggleChatPanel = useWorkspaceStore((s) => s.toggleChatPanel);
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);

  const workspace = workspaces.find((ws) => ws.id === activeWorkspaceId);
  if (!workspace) return null;

  const docs = documentOrder
    .map((id) => documents[id])
    .filter(Boolean);

  return (
    <main className="glass-panel flex min-h-0 flex-1 flex-col items-stretch overflow-hidden">
      <WorkspaceHeader workspace={workspace} onToggleChat={toggleChatPanel} />

      <div className="px-6 pt-3">
        <DropZone />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-3">
        {docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-[var(--text-muted)] text-sm">
              Inga filer ännu — dra hit eller använd <kbd className="rounded bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5 font-mono text-xs">⌘K</kbd>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {docs.map((doc) => (
              <DocumentRow key={doc.id} document={doc} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/components/WorkspaceView.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView.tsx src/components/WorkspaceView.test.tsx
git commit -m "feat: add WorkspaceView with header, drop zone, and file list"
```

---

### Task 7: CommandPalette component

**Files:**
- Create: `src/components/CommandPalette.tsx`
- Create: `src/components/CommandPalette.test.tsx`

- [ ] **Step 1: Write CommandPalette tests**

Create `src/components/CommandPalette.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { useWorkspaceStore } from "../store/workspaceStore";

describe("CommandPalette", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "inbox-1", name: "Inkorg", is_inbox: true, file_count: 3, description: "", ai_brief: "", ai_entities: [], ai_topics: [], cover_color: "", created_at: "", updated_at: "" },
        { id: "ws-2", name: "Bostadsrätten", is_inbox: false, file_count: 12, description: "", ai_brief: "", ai_entities: [], ai_topics: [], cover_color: "#5856d6", created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "inbox-1",
    });
  });

  it("renders workspaces when open", () => {
    render(<CommandPalette open onOpenChange={() => {}} />);
    expect(screen.getByText(/Inkorg/)).toBeInTheDocument();
    expect(screen.getByText(/Bostadsrätten/)).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<CommandPalette open={false} onOpenChange={() => {}} />);
    expect(container.querySelector("[cmdk-root]")).toBeNull();
  });

  it("shows create workspace action", () => {
    render(<CommandPalette open onOpenChange={() => {}} />);
    expect(screen.getByText(/Skapa workspace/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/components/CommandPalette.test.tsx
```

- [ ] **Step 3: Implement CommandPalette**

Create `src/components/CommandPalette.tsx`:

```tsx
import { useState } from "react";
import { Command } from "cmdk";
import { useWorkspaceStore } from "../store/workspaceStore";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const [mode, setMode] = useState<"navigate" | "create">("navigate");
  const [newName, setNewName] = useState("");

  if (!open) return null;

  function handleSelect(workspaceId: string) {
    setActiveWorkspace(workspaceId);
    onOpenChange(false);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    await createWorkspace(name);
    setNewName("");
    setMode("navigate");
    onOpenChange(false);
  }

  return (
    <div className="command-palette__backdrop" onClick={() => onOpenChange(false)}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        {mode === "navigate" ? (
          <Command label="Command palette">
            <Command.Input
              className="command-palette__input"
              placeholder="Sök workspace..."
              autoFocus
            />
            <Command.List className="command-palette__list">
              <Command.Empty className="command-palette__empty">Inga träffar</Command.Empty>
              <Command.Group heading="Workspaces">
                {workspaces.map((ws) => (
                  <Command.Item
                    key={ws.id}
                    className="command-palette__item"
                    onSelect={() => handleSelect(ws.id)}
                    value={ws.name}
                  >
                    <span
                      className="workspace-item__dot"
                      style={{ background: ws.is_inbox ? "#ff9f0a" : (ws.cover_color || "var(--report-color)") }}
                    />
                    {ws.name}
                    <span className="command-palette__item-count">{ws.file_count}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Separator />
              <Command.Item
                className="command-palette__item"
                onSelect={() => setMode("create")}
                value="Skapa workspace"
              >
                <span style={{ fontSize: 14 }}>+</span>
                Skapa workspace
              </Command.Item>
            </Command.List>
          </Command>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}>
            <input
              className="command-palette__input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Namn på ny workspace..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") { setMode("navigate"); setNewName(""); }
              }}
            />
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add CSS to `src/index.css`**

Add inside the `@layer components` block:

```css
/* ── Command Palette ── */
.command-palette__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 20vh;
  z-index: 100;
}
.command-palette {
  width: 480px;
  max-height: 360px;
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: var(--card-radius);
  backdrop-filter: var(--glass-blur);
  box-shadow: 0 16px 64px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.command-palette__input {
  width: 100%;
  padding: 14px 16px;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  font-size: 15px;
  outline: none;
}
.command-palette__input::placeholder {
  color: var(--text-muted);
}
.command-palette__list {
  max-height: 280px;
  overflow-y: auto;
  padding: 6px;
}
.command-palette__empty {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
.command-palette__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 13px;
  transition: background var(--transition-fast);
}
.command-palette__item:hover,
.command-palette__item[data-selected="true"],
.command-palette__item[aria-selected="true"] {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
}
.command-palette__item-count {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
}
[cmdk-group-heading] {
  font-size: 10px;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.25);
  text-transform: uppercase;
  padding: 8px 10px 4px;
}
[cmdk-separator] {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 4px 0;
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- src/components/CommandPalette.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx src/index.css
git commit -m "feat: add CommandPalette with workspace navigation and create"
```

---

### Task 8: Rewire App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Rewrite App.tsx with new layout**

Replace the contents of `src/App.tsx`:

```tsx
import { useEffect, useCallback, useState, startTransition } from "react";

import { CommandPalette } from "./components/CommandPalette";
import { DetailPanel } from "./components/DetailPanel";
import { FileMoveToast } from "./components/FileMoveToast";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { WorkspaceView } from "./components/WorkspaceView";
import { WorkspaceNotebook } from "./components/WorkspaceNotebook";
import { fetchWorkspaceFiles } from "./lib/api";
import { getClientId } from "./lib/tauri-events";
import { useDocumentStore } from "./store/documentStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { useWebSocket } from "./hooks/useWebSocket";

export default function App() {
  const bootstrap = useDocumentStore((s) => s.bootstrap);
  const setClientId = useDocumentStore((s) => s.setClientId);
  const chatPanelOpen = useWorkspaceStore((s) => s.chatPanelOpen);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  useWebSocket();

  // Bootstrap: fetch client ID and workspaces
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const clientId = await getClientId();
        if (cancelled) return;
        setClientId(clientId);
        await fetchWorkspaces();
      } catch (error) {
        if (!cancelled) console.error("app.bootstrap.failed", error);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [setClientId, fetchWorkspaces]);

  // When active workspace changes, fetch its files
  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    async function loadFiles() {
      try {
        const payload = await fetchWorkspaceFiles(activeWorkspaceId!, 50);
        if (cancelled) return;
        startTransition(() => {
          bootstrap(payload.documents, { all: payload.total, processing: 0, receipt: 0, contract: 0, invoice: 0, meeting_notes: 0, audio: 0, generic: 0, moved: 0 }, []);
        });
      } catch (error) {
        if (!cancelled) console.error("workspace.files.failed", error);
      }
    }
    void loadFiles();
    return () => { cancelled = true; };
  }, [activeWorkspaceId, bootstrap]);

  // Global ⌘K listener
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

  return (
    <div className="flex h-full flex-col overflow-hidden text-[var(--text-primary)]" style={{ background: "#111118" }}>
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden">
        <div className="hidden shrink-0 lg:block">
          <WorkspaceSidebar />
        </div>

        <WorkspaceView />

        {chatPanelOpen && (
          <aside className="workspace-panel glass-panel hidden lg:flex">
            <WorkspaceNotebook />
          </aside>
        )}
      </div>

      <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} />
      <FileMoveToast />
      <DetailPanel />
    </div>
  );
}
```

- [ ] **Step 2: Run all frontend tests**

```bash
npm test
```

Some existing tests (ActivityFeed, SearchBar, HomeChat, Sidebar, ProcessingRail) may now fail because their parent context changed. These components are no longer rendered in the main path. Their tests should still pass in isolation since they test component behavior, not App integration. If any fail due to missing context, note them but don't fix — those components are removed from the render path.

- [ ] **Step 3: Run build to verify compilation**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: rewire App.tsx to workspace-centric 3-panel layout"
```

---

### Task 9: Integration testing + polish

**Files:**
- Modify: various test files (fix broken imports if any)

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

- [ ] **Step 2: Fix any broken tests**

Tests for removed-from-render components (ActivityFeed, SearchBar, HomeChat, Sidebar, ProcessingRail) should still pass since they render in isolation. If any tests import `App` and expect old structure, update them to expect the new layout.

- [ ] **Step 3: Run build**

```bash
npm run build
```

- [ ] **Step 4: Run backend tests to ensure nothing broke**

```bash
PYTHONPATH=. pytest server/tests -q
```

- [ ] **Step 5: Verify full chain**

```bash
npm test && npm run build && PYTHONPATH=. pytest server/tests -q
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: update tests for new workspace layout"
```

---

### Task 10: Visual verification

- [ ] **Step 1: Start backend**

```bash
uvicorn server.main:app --host 0.0.0.0 --port 9000
```

- [ ] **Step 2: Start frontend dev server**

```bash
npm run dev
```

- [ ] **Step 3: Verify in browser**

Open http://localhost:1420 and verify:
- Sidebar shows with Inkorg workspace (auto-created by migration)
- Clicking Inkorg shows WorkspaceView with header
- ⌘K opens command palette with workspace list + "Skapa workspace"
- Creating a workspace adds it to sidebar
- Chat toggle button shows/hides right panel

- [ ] **Step 4: Final commit if visual fixes needed**

```bash
git add -A
git commit -m "fix: visual polish for workspace layout"
```
