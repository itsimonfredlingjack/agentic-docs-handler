# Frontend Layout Shell — Design Spec

## Context

Step 2 of the Brainfileing transformation. The backend now has SQLite persistence, workspace CRUD (`GET/POST/PATCH/DELETE /workspaces`, `GET /workspaces/:id/files`, `POST /workspaces/:id/files`), and an inbox workspace auto-created on startup. This step builds the frontend shell: workspace navigation, workspace view with file list, and the structural foundation for all future UI work.

## Decisions Made

- **Layout approach**: Linear-style — clean workspace list in sidebar. No document-type filters in sidebar. Type filtering can live as chips inside a workspace header later.
- **Store architecture**: New `workspaceStore` (Zustand) owns workspace list + `activeWorkspaceId`. Existing `documentStore` filters on active workspace. No store split beyond this.
- **Workspace header**: Progressive — compact now (name + file count), automatically expands when AI brief data exists (future step 5).
- **Command palette**: Minimal ⌘K with workspace navigation + create workspace. No file search or multi-step actions.
- **Chat panel**: Toggleable right panel, workspace-contextual, default closed. Reuses existing `WorkspaceNotebook` + SSE infrastructure.

## Layout Structure

```
┌──────────────────────────────────────────────────────────┐
│ WorkspaceSidebar │ WorkspaceView              │ ChatPanel │
│ 240px fixed      │ flex-1                     │ 380px     │
│                  │                            │ toggleable│
│ [App name]       │ WorkspaceHeader            │ (default  │
│ ─────────────    │  · color dot + name        │  closed)  │
│ Inkorg (3)       │  · file count              │           │
│ ─────────────    │  · AI brief (placeholder)  │           │
│ Workspaces:      │                            │           │
│  Bostadsrätten ● │ DropZone                   │           │
│  Skatt 2025    ● │  · "Dra filer hit..."      │           │
│  Serverprojekt ● │                            │           │
│                  │ FileList                   │           │
│                  │  · DocumentRow per file     │           │
│ + Ny workspace   │  · filtered by workspace   │           │
│ ⌘K               │                            │           │
└──────────────────────────────────────────────────────────┘
```

Chat panel shows when user clicks the "💬 Chat" button in WorkspaceHeader. Hides on close button or ⌘K navigation.

## Components

### New Components

**`src/components/WorkspaceSidebar.tsx`**
- Fetches workspaces from `GET /workspaces` via workspaceStore
- Renders workspace list: color dot, name, file count (monospace)
- Inbox always first, visually separated with a divider
- Active workspace highlighted with accent background + border
- "Ny workspace" button at bottom — calls `POST /workspaces` with a dialog/inline input
- ⌘K hint at very bottom
- Width: 240px fixed (`--sidebar-width` CSS var, updated from 248px)
- Uses existing glass-panel aesthetic

**`src/components/WorkspaceView.tsx`**
- Renders when `activeWorkspaceId` is set
- Contains: WorkspaceHeader + DropZone + file list
- File list: reuses `DocumentRow` component, fed documents filtered by workspace
- Empty state: "Inga filer ännu — dra hit eller använd ⌘K"

**`src/components/WorkspaceHeader.tsx`**
- Progressive: compact when no AI brief, expanded when `ai_brief` exists
- Compact: color dot + editable name (inline edit) + file count + "💬 Chat" toggle
- Expanded (future): adds AI brief paragraph + entity pills below name
- Description: editable inline, shown below name if non-empty
- "💬 Chat" button toggles the right chat panel

**`src/components/CommandPalette.tsx`**
- Uses `cmdk` library (headless, we style with our CSS)
- Opens on ⌘K (global keyboard listener)
- Items:
  - "Gå till [workspace]" for each workspace
  - "Skapa workspace" — opens inline name input in palette
- Renders as a centered overlay with backdrop blur
- Styled with existing `--glass-bg`, `--glass-blur`, `--card-radius` tokens

### Modified Components

**`src/App.tsx`**
- Replace current 3-panel layout with: `WorkspaceSidebar | WorkspaceView | ChatPanel`
- Remove old `Sidebar`, `SearchBar`, `ProcessingRail`, `ActivityFeed`, `HomeChat` from the main render path
- Keep `DetailPanel`, `FileMoveToast` as overlays
- Keep `DropZone` — move into `WorkspaceView`
- Chat panel: conditionally render `WorkspaceNotebook` on the right when toggled

**`src/components/WorkspaceNotebook.tsx`**
- Minor change: accept workspace ID as context instead of category string
- The existing SSE streaming + conversation state stays as-is

### Unchanged Components

- `DocumentRow` — reused as-is for file list within workspace
- `DetailPanel` — still opens as overlay when clicking a document
- `FileMoveToast` — still renders toast notifications
- `InlineEdit` — reused for workspace name/description editing
- `NotebookEntry`, `NotebookInput` — chat sub-components unchanged

## State Management

### New: `src/store/workspaceStore.ts`

```typescript
type WorkspaceStoreState = {
  // Data
  workspaces: WorkspaceResponse[]
  activeWorkspaceId: string | null
  loading: boolean
  error: string | null

  // Chat panel
  chatPanelOpen: boolean

  // Actions
  fetchWorkspaces: () => Promise<void>
  setActiveWorkspace: (id: string) => void
  createWorkspace: (name: string) => Promise<WorkspaceResponse>
  updateWorkspace: (id: string, fields: Partial<WorkspaceResponse>) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  toggleChatPanel: () => void
  setChatPanelOpen: (open: boolean) => void
}
```

Workspace data fetched on app mount. `activeWorkspaceId` defaults to inbox.

### Modified: `src/store/documentStore.ts`

- Add selector that filters documents by `activeWorkspaceId`:
  - Fetch workspace files via `GET /workspaces/:id/files` when workspace changes
  - Store result in existing `documents` record + `documentOrder` array
  - The existing filtering, search, and WS event handling stays
- `sidebarFilter` repurposed: within a workspace, it can filter by document kind (future enhancement, not in this step)

### New Types: `src/types/workspace.ts`

```typescript
type WorkspaceResponse = {
  id: string
  name: string
  description: string
  ai_brief: string
  ai_entities: Record<string, unknown>[]
  ai_topics: string[]
  cover_color: string
  is_inbox: boolean
  file_count: number
  created_at: string
  updated_at: string
}

type WorkspaceListResponse = {
  workspaces: WorkspaceResponse[]
}
```

## API Integration

### New API functions in `src/lib/api.ts`

```typescript
fetchWorkspaces(): Promise<WorkspaceListResponse>
createWorkspace(name: string, description?: string, cover_color?: string): Promise<WorkspaceResponse>
updateWorkspace(id: string, fields: object): Promise<WorkspaceResponse>
deleteWorkspace(id: string): Promise<void>
fetchWorkspaceFiles(workspaceId: string, limit?: number, offset?: number): Promise<DocumentListResponse>
moveFilesToWorkspace(workspaceId: string, fileIds: string[]): Promise<{moved: number}>
```

All call the workspace endpoints added in Step 1.

## Data Flow

```
App mounts
  → workspaceStore.fetchWorkspaces()
  → workspaceStore.setActiveWorkspace(inbox.id)
  → documentStore fetches files for inbox via fetchWorkspaceFiles(inbox.id)
  → UI renders: sidebar (workspaces) + main (inbox files)

User clicks workspace in sidebar
  → workspaceStore.setActiveWorkspace(id)
  → documentStore fetches files for that workspace
  → WorkspaceView re-renders with new workspace header + files

User clicks "💬 Chat"
  → workspaceStore.toggleChatPanel()
  → WorkspaceNotebook appears on right, scoped to active workspace

User presses ⌘K
  → CommandPalette opens
  → User selects workspace → setActiveWorkspace(id), palette closes
  → User selects "Skapa workspace" → inline input → createWorkspace(name)
```

## Styling Approach

- All new components use existing CSS custom properties from `index.css`
- Glass-panel aesthetic for sidebar and chat panel
- New CSS classes added to `index.css` for workspace-specific elements:
  - `.workspace-sidebar` — fixed left panel
  - `.workspace-item` — sidebar workspace row with hover/active states
  - `.workspace-header` — progressive header in main panel
  - `.command-palette` — overlay with backdrop blur for ⌘K
- Keep dark theme — no color changes
- Animations: `--transition-fast` for hover states, `--transition-normal` for panel open/close

## Dependencies

- **New**: `cmdk` (~3KB, headless command palette)
- **No other new dependencies**

## Testing Strategy

- `WorkspaceSidebar.test.tsx` — renders workspace list, handles click navigation, shows inbox first
- `WorkspaceView.test.tsx` — renders header + file list, handles empty state
- `WorkspaceHeader.test.tsx` — compact/expanded states, inline edit
- `CommandPalette.test.tsx` — opens on ⌘K, lists workspaces, creates workspace
- `workspaceStore.test.ts` — fetch, CRUD, active workspace state
- Update `App.test.tsx` if one exists (or rely on component tests)

## Out of Scope

- AI brief generation (step 5)
- Entity extraction + display (step 4)
- Workspace suggestion / auto-placement (step 6)
- File drag-and-drop between workspaces
- Multiple view modes (grid, timeline)
- Search within workspace (step 7)
- Mobile responsive layout
