# CURRENT_TASK

## Task: 1-2 of 6 — Remove ViewMode + Delete ModeToggle/WorkspaceGrid/WorkspaceCard
## Plan: docs/plans/2026-03-20-kill-mode-toggle.md
## Status: IN_PROGRESS
## Attempt: 1

## Task Description

**Task 1:** Remove ViewMode from store and types
- Delete `ViewMode` type from `src/types/documents.ts:371`
- Remove `viewMode`, `setViewMode` from `src/store/documentStore.ts`
- Remove viewMode assertions from `src/store/documentStore.test.ts`

**Task 2:** Delete ModeToggle, WorkspaceGrid, WorkspaceCard and clean up imports
- Delete: `src/components/ModeToggle.tsx`, `src/components/WorkspaceGrid.tsx`, `src/components/WorkspaceGrid.test.tsx`, `src/components/WorkspaceCard.tsx`
- Clean up `src/components/Sidebar.tsx`: remove ModeToggle import, remove viewMode guard on nav
- Simplify `src/App.tsx`: remove viewMode branching, always show activity feed, render WorkspaceNotebook as sibling when active

## Context
These are the first two tasks in a 6-task plan to kill the ModeToggle and bring workspace chat into the main activity view as a right panel. These tasks are pure deletion/cleanup — removing the old abstractions before Tasks 3-4 add new ones.

## Acceptance Criteria
- [ ] `ViewMode` type deleted from documents.ts
- [ ] `viewMode` and `setViewMode` removed from documentStore
- [ ] Store tests updated (viewMode assertions removed)
- [ ] ModeToggle.tsx, WorkspaceGrid.tsx, WorkspaceGrid.test.tsx, WorkspaceCard.tsx deleted
- [ ] Sidebar.tsx: no ModeToggle, no viewMode guard, nav always renders
- [ ] App.tsx: no viewMode branching, always shows SearchBar/DropZone/ProcessingRail/ActivityFeed, WorkspaceNotebook renders as sibling when activeWorkspace is set
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] Two commits: one for Task 1, one for Task 2

## Completed Tasks So Far
(none)

## Cost Tracking
(tracking starts after first dispatch)
