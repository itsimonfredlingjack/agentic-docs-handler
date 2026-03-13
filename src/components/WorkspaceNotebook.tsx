import { useDocumentStore } from "../store/documentStore";

const CATEGORY_LABELS: Record<string, string> = {
  receipt: "Kvitton",
  contract: "Avtal",
  invoice: "Fakturor",
  meeting_notes: "Möten",
  audio: "Ljud",
  generic: "Övrigt",
};

export function WorkspaceNotebook() {
  const activeWorkspace = useDocumentStore((s) => s.activeWorkspace);
  const setActiveWorkspace = useDocumentStore((s) => s.setActiveWorkspace);

  if (!activeWorkspace) return null;

  const label = CATEGORY_LABELS[activeWorkspace] ?? activeWorkspace;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 pb-3">
        <button
          className="action-secondary px-2.5 py-1 text-xs"
          onClick={() => setActiveWorkspace(null)}
        >
          &larr;
        </button>
        <h2 className="text-base font-bold text-[var(--text-primary)]">
          {label}
        </h2>
      </div>
      <div className="glass-panel flex min-h-[300px] flex-col items-center justify-center p-10 text-center">
        <p className="text-sm text-[var(--text-secondary)]">
          Notebook — kommer i nästa steg
        </p>
      </div>
    </div>
  );
}
