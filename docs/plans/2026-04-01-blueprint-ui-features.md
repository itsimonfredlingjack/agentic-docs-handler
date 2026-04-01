# Blueprint UI Features — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface AI-extracted metadata that already exists in the backend but is invisible in the UI — entity/topic display in workspace headers, inbox workspace suggestion badges, and entity/related-files sections in the inspector.

**Architecture:** All three features consume data that the backend already generates and stores. WorkspaceResponse already contains `ai_entities` and `ai_topics`. The workspace suggester already persists `suggested_workspace_id` on documents. Discovery cards already have an API endpoint. This is primarily frontend rendering work with one small backend addition (exposing suggestion data on document responses).

**Tech Stack:** React 19, Zustand 5, Tailwind + design tokens, existing API endpoints

**Decomposition Strategy:** Feature-based — three independent UI features

**Target Model:** Sonnet 30min chunks

**Blueprint:** `claude-code-transformation-guide.md`

---

### Task 1: Entity & Topic Metadata in WorkspaceHeader

**Chunk estimate:** ~20 min (Sonnet)

**Files:**
- Modify: `src/components/WorkspaceHeader.tsx` — add entity badges and topic tags
- Modify: `src/components/WorkspaceHeader.test.tsx` — add tests for new display

**Context:**
`WorkspaceResponse` already has `ai_entities: Record<string, unknown>[]` and `ai_topics: string[]`. The WorkspaceHeader component receives the full workspace as a prop but doesn't render these fields. Add them after the AI brief section.

Entity objects have shape: `{ name: string, entity_type: string }` (from entity_extractor pipeline). Entity types: `person`, `company`, `date`, `amount`, `place`, `topic`.

**Step 1: Add entity/topic rendering after the AI brief**

In `WorkspaceHeader.tsx`, after the existing `hasBrief && (...)` block (after line 91), add:

```tsx
{workspace.ai_entities.length > 0 && (
  <div className="flex flex-wrap gap-1.5 max-w-3xl mt-1.5">
    {workspace.ai_entities.slice(0, 8).map((entity, i) => {
      const name = typeof entity.name === "string" ? entity.name : "";
      const type = typeof entity.entity_type === "string" ? entity.entity_type : "";
      if (!name) return null;
      return (
        <span key={`${name}-${i}`} className="glass-badge text-xs-ui text-[var(--text-secondary)]">
          <span className="text-[var(--text-muted)]">{entityIcon(type)}</span>
          {name}
        </span>
      );
    })}
  </div>
)}

{workspace.ai_topics.length > 0 && (
  <div className="flex flex-wrap gap-1.5 max-w-3xl mt-1">
    {workspace.ai_topics.slice(0, 6).map((topic) => (
      <span key={topic} className="text-xs-ui text-[var(--text-muted)]">
        #{topic}
      </span>
    ))}
  </div>
)}
```

**Step 2: Add the entity icon helper**

Add above the component function:

```tsx
function entityIcon(type: string): string {
  switch (type) {
    case "person": return "P";
    case "company": return "C";
    case "date": return "D";
    case "amount": return "$";
    case "place": return "L";
    default: return "";
  }
}
```

Use single-letter prefixes instead of emoji — clean, professional, monospace-friendly.

**Step 3: Add tests**

Add to `WorkspaceHeader.test.tsx`:

```tsx
it("renders entity badges when workspace has ai_entities", () => {
  const ws = makeWorkspace({
    ai_entities: [
      { name: "Telia", entity_type: "company" },
      { name: "2026-03-15", entity_type: "date" },
    ],
  });
  render(<WorkspaceHeader workspace={ws} />);
  expect(screen.getByText("Telia")).toBeInTheDocument();
  expect(screen.getByText("2026-03-15")).toBeInTheDocument();
});

it("renders topic tags when workspace has ai_topics", () => {
  const ws = makeWorkspace({ ai_topics: ["accounting", "tax"] });
  render(<WorkspaceHeader workspace={ws} />);
  expect(screen.getByText("#accounting")).toBeInTheDocument();
  expect(screen.getByText("#tax")).toBeInTheDocument();
});

it("renders nothing when entities and topics are empty", () => {
  const ws = makeWorkspace({ ai_entities: [], ai_topics: [] });
  const { container } = render(<WorkspaceHeader workspace={ws} />);
  expect(container.querySelector(".glass-badge")).not.toBeInTheDocument();
});
```

The `makeWorkspace` helper needs to include `ai_entities: []` and `ai_topics: []` in its defaults if not already present. Check the existing test helper and add these fields.

**Step 4: Verify**

```bash
npm test && npm run build
```

**Verification Gate:**
1. Automated: `npm test` — all pass including 3 new tests
2. Automated: `npm run build` — no TypeScript errors
3. Manual: Start backend with a populated workspace → header shows entity badges and topic tags
4. Manual: Workspace with empty entities/topics → header shows nothing extra (graceful)
5. Regression: All existing tests pass

---

### Task 2: Inbox Suggestion Badges with One-Click Accept

**Chunk estimate:** ~30 min (Sonnet)

**Files:**
- Modify: `src/components/DocumentRow.tsx` — replace move destination with workspace suggestion badge
- Modify: `src/components/WorkspaceView.tsx` — add accept-suggestion handler
- Modify: `src/components/DocumentRow.test.tsx` — add inbox suggestion test

**Context:**
Currently, inbox documents with a `movePlan` show `→ /path/to/destination` — a raw file path. In the "Linear for Files" model, we want to show the suggested workspace name with a click-to-accept flow. The workspace name can be derived from the workspace store: when a document has a `movePlan`, look up which workspace it's being suggested for by matching the document to workspace assignments.

**Approach:** Use a simpler path — when in inbox, show a "Move to workspace" button that opens the command palette in move mode for that document. This avoids needing to add backend fields and reuses the existing move-to-workspace flow in CommandPalette. The one-click experience comes from having an explicit button instead of the current cryptic arrow-path badge.

**Step 1: Update DocumentRow to show workspace-aware suggestion in inbox**

In `DocumentRow.tsx`, add a new prop:

```tsx
type Props = {
  // ... existing props
  onMoveToWorkspace?: (documentId: string) => void;
};
```

Replace the existing inbox movePlan display (lines 68-72) with:

```tsx
) : isInbox && document.movePlan ? (
  <span className="flex items-center gap-1.5">
    <span className="text-xs-ui text-[var(--text-muted)]">
      {document.movePlan.destination?.split("/").pop() || "unknown"}
    </span>
    {onMoveToWorkspace && (
      <button
        type="button"
        className="action-secondary px-2 py-0.5 text-xs-ui"
        onClick={(e) => {
          e.stopPropagation();
          onMoveToWorkspace(document.id);
        }}
      >
        Move
      </button>
    )}
    {focused && <kbd className="ml-1 text-xs-ui font-mono text-[var(--text-disabled)] bg-[var(--surface-6)] px-1 rounded">↵</kbd>}
  </span>
```

**Step 2: Wire up the move handler in WorkspaceView**

In `WorkspaceView.tsx`, import the command palette state or create a move handler that calls the API directly:

```tsx
const handleMoveToWorkspace = useCallback(async (documentId: string) => {
  // For now, use the existing command palette move mode
  // This will be refined when workspace suggestions are exposed on documents
  setSelectedDocument(documentId);
}, [setSelectedDocument]);
```

Pass to DocumentRow:

```tsx
<DocumentRow
  key={doc.id}
  document={doc}
  focused={doc.id === selectedDocumentId}
  isInbox={Boolean(isInbox)}
  onSelectId={setSelectedDocument}
  onMoveToWorkspace={isInbox ? handleMoveToWorkspace : undefined}
  snippet={searchState.snippetsByDocId[doc.id]}
  searchQuery={hasActiveSearch ? searchState.query : undefined}
/>
```

**Step 3: Add test**

In `DocumentRow.test.tsx`:

```tsx
it("shows move button in inbox when movePlan exists", () => {
  const onMove = vi.fn();
  const inboxDoc = { ...baseDoc, movePlan: { destination: "/docs/Receipts/2026/file.pdf", rule_name: "receipt" } };
  render(<DocumentRow document={inboxDoc} isInbox onMoveToWorkspace={onMove} />);
  const moveBtn = screen.getByRole("button", { name: /Move/i });
  expect(moveBtn).toBeInTheDocument();
  fireEvent.click(moveBtn);
  expect(onMove).toHaveBeenCalledWith(inboxDoc.id);
});
```

**Step 4: Verify**

```bash
npm test && npm run build
```

**Verification Gate:**
1. Automated: `npm test` — all pass including new inbox test
2. Automated: `npm run build` — clean
3. Manual: Inbox documents with movePlan show "Move" button instead of raw path
4. Manual: Click "Move" selects the document (opening inspector for review before move)
5. Regression: All existing tests pass

---

### Task 3: Entity Section & Related Files in InspectorPane

**Chunk estimate:** ~30 min (Sonnet)

**Files:**
- Modify: `src/components/InspectorPane.tsx` — add entities section and related files section
- Modify: `src/lib/api.ts` — add `fetchDocumentDiscovery()` if needed
- No new test file needed — InspectorPane has no test file; add inline verification

**Context:**
The InspectorPane already shows extracted fields (vendor, amount, date) but doesn't show entities or related files. Entities can be derived from the document's extraction fields. Related files come from the workspace discovery endpoint already used by DiscoveryCards.

**Step 1: Add entities section after Tags in InspectorPane**

In `ModalContent` function, after the tags section (after line 212), add:

```tsx
{document.extraction?.entities && (document.extraction.entities as Record<string, unknown>[]).length > 0 ? (
  <section className="hud-section control-card p-4">
    <p className="section-kicker">Entiteter</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {(document.extraction.entities as Array<{ name: string; entity_type: string }>).map((entity, i) => (
        <span key={`${entity.name}-${i}`} className="glass-badge bg-[var(--surface-6)] text-[var(--text-secondary)]">
          <span className="text-[var(--text-muted)] text-xs-ui">{entityTypeLabel(entity.entity_type)}</span>
          {entity.name}
        </span>
      ))}
    </div>
  </section>
) : null}
```

Add the helper above `ModalContent`:

```tsx
function entityTypeLabel(type: string): string {
  switch (type) {
    case "person": return "P ·";
    case "company": return "C ·";
    case "date": return "D ·";
    case "amount": return "$ ·";
    case "place": return "L ·";
    default: return "";
  }
}
```

**Step 2: Add related files section using discovery data**

The workspace already has discovery cards fetched by DiscoveryCards component. For the inspector, we can show a simplified version — files that are related to the currently selected document.

After the move plan section (after line 245), add:

```tsx
<RelatedFilesSection documentId={document.id} workspaceId={document.workspaceId} />
```

Define the component inside InspectorPane.tsx:

```tsx
function RelatedFilesSection({ documentId, workspaceId }: { documentId: string; workspaceId?: string | null }) {
  const [relations, setRelations] = useState<Array<{ title: string; type: string; id: string }>>([]);
  const setSelectedDocument = useDocumentStore((state) => state.setSelectedDocument);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await fetchWorkspaceDiscovery(workspaceId!);
        if (cancelled) return;
        const related = response.cards
          .filter((card) => card.files.some((f) => f.id === documentId))
          .flatMap((card) =>
            card.files
              .filter((f) => f.id !== documentId)
              .map((f) => ({ title: f.title, type: card.relation_type, id: f.id }))
          );
        setRelations(related);
      } catch {
        // Silently fail — related files are optional
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [documentId, workspaceId]);

  if (relations.length === 0) return null;

  return (
    <section className="hud-section control-card p-4">
      <p className="section-kicker">Relaterade filer</p>
      <div className="mt-2 space-y-1.5">
        {relations.map((rel) => (
          <button
            key={rel.id}
            type="button"
            className="flex items-center gap-2 w-full text-left rounded-lg px-2 py-1.5 text-sm-ui text-[var(--text-secondary)] hover:bg-[var(--surface-4)] transition-colors"
            onClick={() => setSelectedDocument(rel.id)}
          >
            <span className="text-xs-ui text-[var(--text-muted)] uppercase">{rel.type}</span>
            <span className="truncate">{rel.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
```

Import `fetchWorkspaceDiscovery` from `../lib/api` and add `useState` to the React imports.

**Step 3: Verify**

```bash
npm test && npm run build
```

**Verification Gate:**
1. Automated: `npm test` — all existing tests pass (no InspectorPane test file exists)
2. Automated: `npm run build` — no TypeScript errors
3. Manual: Select a document with entities → inspector shows "Entiteter" section with badges
4. Manual: Select a document in a workspace with discovery data → inspector shows "Relaterade filer"
5. Manual: Select a document with no entities → no entity section shown (graceful)
6. Regression: Full test suite passes

---

## Final Verification

After all 3 tasks:

```bash
PYTHONPATH=. pytest server/tests -q && npm test && npm run build && cargo check --manifest-path src-tauri/Cargo.toml
```

### Visual verification:
1. Open a workspace with AI-processed documents
2. WorkspaceHeader shows entity badges (person, company, date) and #topic tags below the brief
3. Switch to Inbox — documents with suggestions show "Move" button
4. Click a document — InspectorPane shows entity section and related files
5. All existing features (search, chat, processing rail) work unchanged
