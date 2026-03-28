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
      <div className="workspace-sidebar__brand">Workspaces</div>

      {inbox && (
        <button
          type="button"
          className="workspace-item"
          data-active={activeWorkspaceId === inbox.id ? "true" : undefined}
          onClick={() => setActiveWorkspace(inbox.id)}
        >
          <span className="workspace-item__dot" style={{ background: INBOX_COLOR }} />
          <span className="workspace-item__name">{inbox.name}</span>
          <span className="workspace-item__count">{inbox.file_count}</span>
        </button>
      )}

      <div className="workspace-sidebar__divider" />

      <div className="workspace-sidebar__section-label">Workspaces</div>

      {others.map((ws, index) => (
        <button
          key={ws.id}
          type="button"
          className="workspace-item"
          data-active={activeWorkspaceId === ws.id ? "true" : undefined}
          onClick={() => setActiveWorkspace(ws.id)}
        >
          <span
            className="workspace-item__dot"
            style={{ background: ws.cover_color || getColor(index) }}
          />
          <span className="workspace-item__name">{ws.name}</span>
          <span className="workspace-item__count">{ws.file_count}</span>
        </button>
      ))}

      <div className="workspace-sidebar__spacer" />

      {showForm ? (
        <form className="workspace-sidebar__create-form" onSubmit={handleSubmit}>
          <input
            className="workspace-sidebar__create-input"
            type="text"
            placeholder="Workspace namn"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
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
          className="workspace-sidebar__create-btn"
          onClick={() => setShowForm(true)}
        >
          + Ny workspace
        </button>
      )}

      <div className="workspace-sidebar__kbd-hint">
        <kbd>⌘K</kbd>
      </div>
    </nav>
  );
}
