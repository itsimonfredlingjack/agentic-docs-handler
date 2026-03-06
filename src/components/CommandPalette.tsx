import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDocumentStore } from "../store/documentStore";
import type { SidebarFilter } from "../types/documents";

type Command = {
  id: string;
  label: string;
  action: () => void;
};

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette({
  commandQuery,
  onClose,
  onAddFiles,
  onToggleView,
  onShowShortcuts,
}: {
  commandQuery: string;
  onClose: () => void;
  onAddFiles: () => void;
  onToggleView: () => void;
  onShowShortcuts: () => void;
}) {
  const setSidebarFilter = useDocumentStore((s) => s.setSidebarFilter);
  const selectedDoc = useDocumentStore((s) =>
    s.selectedDocumentId ? s.documents[s.selectedDocumentId] : null,
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      { id: "add-files", label: "Add files", action: () => { onAddFiles(); onClose(); } },
      { id: "toggle-view", label: "Switch view mode", action: () => { onToggleView(); onClose(); } },
      { id: "filter-all", label: "Filter: All", action: () => { setSidebarFilter("all" as SidebarFilter); onClose(); } },
      { id: "filter-receipts", label: "Filter: Receipts", action: () => { setSidebarFilter("receipt" as SidebarFilter); onClose(); } },
      { id: "filter-contracts", label: "Filter: Contracts", action: () => { setSidebarFilter("contract" as SidebarFilter); onClose(); } },
      { id: "filter-invoices", label: "Filter: Invoices", action: () => { setSidebarFilter("invoice" as SidebarFilter); onClose(); } },
      { id: "filter-meetings", label: "Filter: Meetings", action: () => { setSidebarFilter("meeting_notes" as SidebarFilter); onClose(); } },
      { id: "filter-audio", label: "Filter: Audio", action: () => { setSidebarFilter("audio" as SidebarFilter); onClose(); } },
      { id: "clear-filters", label: "Clear filters", action: () => { setSidebarFilter("all" as SidebarFilter); onClose(); } },
      { id: "shortcuts", label: "Show keyboard shortcuts", action: () => { onShowShortcuts(); onClose(); } },
    ];

    if (selectedDoc?.sourcePath) {
      cmds.push({
        id: "show-finder",
        label: "Show in Finder",
        action: async () => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("show_in_folder", { path: selectedDoc.sourcePath });
          } catch { /* not in Tauri */ }
          onClose();
        },
      });
    }

    if (selectedDoc?.status === "failed" && selectedDoc.retryable) {
      cmds.push({
        id: "retry",
        label: "Retry failed document",
        action: () => { onClose(); },
      });
    }

    return cmds;
  }, [onAddFiles, onToggleView, onShowShortcuts, onClose, setSidebarFilter, selectedDoc]);

  const filtered = useMemo(() => {
    const q = commandQuery.trim();
    if (!q) return commands;
    return commands.filter((cmd) => fuzzyMatch(q, cmd.label));
  }, [commandQuery, commands]);

  useEffect(() => {
    setActiveIndex(0);
  }, [filtered.length]);

  const runCommand = useCallback(
    (index: number) => {
      const cmd = filtered[index];
      if (cmd) cmd.action();
    },
    [filtered],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        runCommand(activeIndex);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeIndex, filtered.length, runCommand]);

  if (filtered.length === 0) {
    return (
      <div className="glass-panel absolute left-5 right-5 top-[calc(var(--topbar-height)+0.5rem)] z-30 px-4 py-3">
        <p className="text-sm text-[var(--text-muted)]">No matching commands</p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="glass-panel absolute left-5 right-5 top-[calc(var(--topbar-height)+0.5rem)] z-30 max-h-64 overflow-y-auto py-1"
      role="listbox"
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.id}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition ${
            i === activeIndex
              ? "bg-[var(--btn-bg-active)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--btn-bg)]"
          }`}
          onClick={() => runCommand(i)}
          onMouseEnter={() => setActiveIndex(i)}
        >
          <span className="flex-1">{cmd.label}</span>
          {i === activeIndex && (
            <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-1 font-mono text-[10px] text-[var(--text-disabled)]">
              Enter
            </kbd>
          )}
        </button>
      ))}
    </div>
  );
}
