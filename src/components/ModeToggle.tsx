import { useDocumentStore } from "../store/documentStore";
import type { ViewMode } from "../types/documents";

const MODES: Array<{ id: ViewMode; label: string }> = [
  { id: "activity", label: "Aktivitet" },
  { id: "workspaces", label: "Analys" },
];

export function ModeToggle() {
  const viewMode = useDocumentStore((s) => s.viewMode);
  const setViewMode = useDocumentStore((s) => s.setViewMode);

  return (
    <div className="mode-toggle">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          className={`mode-toggle__option ${viewMode === mode.id ? "is-active" : ""}`}
          onClick={() => setViewMode(mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
