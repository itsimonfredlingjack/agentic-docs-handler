import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { useWorkspaceStore } from "../store/workspaceStore";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Mode = "navigate" | "create";

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [mode, setMode] = useState<Mode>("navigate");
  const [createName, setCreateName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);

  // Focus create input when entering create mode
  useEffect(() => {
    if (mode === "create") {
      createInputRef.current?.focus();
    }
  }, [mode]);

  // Reset state when palette closes
  useEffect(() => {
    if (!open) {
      setMode("navigate");
      setCreateName("");
    }
  }, [open]);

  if (!open) return null;

  const handleSelectWorkspace = (id: string) => {
    setActiveWorkspace(id);
    onOpenChange(false);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = createName.trim();
    if (!name) return;
    await createWorkspace(name);
    setCreateName("");
    setMode("navigate");
    onOpenChange(false);
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setMode("navigate");
      setCreateName("");
    }
  };

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
                    onSelect={() => handleSelectWorkspace(ws.id)}
                    value={ws.name}
                  >
                    <span
                      className="workspace-item__dot"
                      style={{ background: ws.cover_color || "var(--report-color)" }}
                    />
                    <span>{ws.name}</span>
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
                <span style={{ fontSize: 14 }}>+</span> Skapa workspace
              </Command.Item>
            </Command.List>
          </Command>
        ) : (
          <form onSubmit={handleCreateSubmit}>
            <input
              ref={createInputRef}
              className="command-palette__input"
              placeholder="Namn på workspace..."
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={handleCreateKeyDown}
            />
          </form>
        )}
      </div>
    </div>
  );
}
