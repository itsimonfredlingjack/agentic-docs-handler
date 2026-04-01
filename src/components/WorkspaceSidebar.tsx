import { useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";

const DEFAULT_COLORS = ["#5856d6", "#34c759", "#ff375f", "#ff9f0a", "#30b0c7", "#8e8e93"];
const INBOX_COLOR = "#ff9f0a";

export function WorkspaceSidebar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);

  const [showForm, setShowForm] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const inbox = workspaces.find((ws) => ws.is_inbox) ?? null;
  const others = workspaces.filter((ws) => !ws.is_inbox);

  const getColor = (index: number): string => DEFAULT_COLORS[index % DEFAULT_COLORS.length];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = inputValue.trim();
    if (!name) return;
    await createWorkspace(name);
    setInputValue("");
    setShowForm(false);
  };

  return (
    <nav className="workspace-sidebar">
      {/* Titlebar drag region */}
      <div className="h-[52px] shrink-0 flex items-end px-4 pb-2" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        <div className="flex items-center w-full" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <h2 className="text-sm-ui font-bold uppercase tracking-[0.08em] text-[var(--text-disabled)]">
            Brainfileing
          </h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-1 mt-1">
        {/* Inbox Section */}
        {inbox && (
          <div className="mb-3">
            <button
              type="button"
              className="workspace-item"
              data-active={activeWorkspaceId === inbox.id ? "true" : undefined}
              onClick={() => setActiveWorkspace(inbox.id)}
            >
              <div className="flex flex-1 items-center gap-2.5 min-w-0">
                <span className="workspace-item__dot" style={{ background: INBOX_COLOR, boxShadow: `0 0 6px ${INBOX_COLOR}40` }} />
                <span className="workspace-item__name truncate font-semibold">Inbox</span>
              </div>
              {inbox.file_count > 0 && (
                <span className="workspace-item__count shrink-0 bg-[rgba(255,159,10,0.15)] text-[#ff9f0a] px-1.5 py-0.5 rounded text-xs-ui font-mono font-bold">{inbox.file_count}</span>
              )}
            </button>
          </div>
        )}

        {/* Separator */}
        <div className="h-px bg-[var(--surface-4)] mx-2 mb-2" />

        {/* Workspaces Section */}
        <div className="space-y-0.5">
          <div className="px-2 pb-1.5">
            <h3 className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)]">
              Collections
            </h3>
          </div>
          <div className="space-y-0.5">
            {others.map((ws, index) => (
              <button
                key={ws.id}
                type="button"
                className="workspace-item"
                data-active={activeWorkspaceId === ws.id ? "true" : undefined}
                onClick={() => setActiveWorkspace(ws.id)}
              >
                <div className="flex flex-1 items-center gap-2.5 min-w-0">
                  <span
                    className="workspace-item__dot"
                    style={{ background: ws.cover_color || getColor(index) }}
                  />
                  <span className="workspace-item__name truncate">{ws.name}</span>
                </div>
                <span className="workspace-item__count shrink-0 bg-[var(--surface-4)] px-1.5 py-0.5 rounded text-xs-ui font-mono">{ws.file_count}</span>
              </button>
            ))}
          </div>

          {/* Create New Inline Form */}
          <div className="pt-2 px-1">
            {showForm ? (
              <form className="flex mt-1" onSubmit={handleSubmit}>
                <input
                  className="w-full bg-[var(--surface-4)] border border-[var(--surface-10)] rounded px-2.5 py-1.5 text-sm-ui text-white outline-none focus:border-[var(--accent-primary)] placeholder-[var(--text-disabled)] transition-colors"
                  type="text"
                  placeholder="name..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  autoFocus
                  onBlur={() => setShowForm(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setShowForm(false);
                      setInputValue("");
                    }
                  }}
                />
              </form>
            ) : (
              <button
                type="button"
                className="flex items-center gap-2 text-sm-ui font-medium text-[var(--text-disabled)] hover:text-[var(--text-secondary)] transition-colors py-1.5 px-2 rounded-md hover:bg-[var(--surface-4)] w-full text-left"
                onClick={() => setShowForm(true)}
              >
                <span className="text-base-ui leading-none -mt-px">+</span> New collection
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Command hint */}
      <div className="shrink-0 px-4 py-2 border-t border-[var(--surface-4)]">
        <div className="flex items-center gap-2 text-xs-ui text-[var(--text-disabled)]">
          <kbd className="mac-kbd">⌘K</kbd>
          <span>Search</span>
        </div>
      </div>

      {/* Telemetry Footer */}
      <div className="telemetry-footer shrink-0 border-t border-[var(--surface-4)] px-4 py-3 space-y-1.5" aria-live="polite">
        <div className="flex items-center gap-2 text-xs-ui font-mono text-[var(--text-disabled)] tracking-[0.04em]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-20" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
          </span>
          <span>Ollama</span>
          <span className="text-[rgba(255,255,255,0.12)]">·</span>
          <span className="text-green-500/60">Ready</span>
        </div>
      </div>
    </nav>
  );
}

