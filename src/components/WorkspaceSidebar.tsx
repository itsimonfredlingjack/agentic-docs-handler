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
      {/* App Header Zone */}
      <div className="flex items-center justify-between px-3 pt-4 pb-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Local Library
        </h2>
        <div className="workspace-sidebar__kbd-hint" aria-hidden="true">
          <kbd className="mac-kbd">⌘K</kbd>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-4 mt-2">
        {/* Inbox Section */}
        {inbox && (
          <div className="space-y-0.5">
            <button
              type="button"
              className="workspace-item"
              data-active={activeWorkspaceId === inbox.id ? "true" : undefined}
              onClick={() => setActiveWorkspace(inbox.id)}
            >
              <div className="flex flex-1 items-center gap-2.5 min-w-0">
                <span className="workspace-item__dot" style={{ background: INBOX_COLOR }} />
                <span className="workspace-item__name truncate">{inbox.name}</span>
              </div>
              <span className="workspace-item__count shrink-0">{inbox.file_count}</span>
            </button>
          </div>
        )}

        {/* Workspaces Section */}
        <div className="space-y-1">
          <div className="px-2 pb-1">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.25)]">
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
                <span className="workspace-item__count shrink-0">{ws.file_count}</span>
              </button>
            ))}
          </div>

          {/* Create New Inline Form */}
          <div className="pt-2 px-1">
            {showForm ? (
              <form className="flex mt-1" onSubmit={handleSubmit}>
                <input
                  className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-[var(--accent-primary)] placeholder-[rgba(255,255,255,0.3)] transition-colors"
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
                className="flex items-center gap-2 text-[11px] font-medium text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.8)] transition-colors py-1.5 px-2 rounded-md hover:bg-[rgba(255,255,255,0.04)] w-full text-left"
                onClick={() => setShowForm(true)}
              >
                <span className="text-[14px] leading-none -mt-px">+</span> New collection
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
