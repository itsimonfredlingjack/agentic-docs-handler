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
