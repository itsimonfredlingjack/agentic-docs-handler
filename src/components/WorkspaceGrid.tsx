import { useEffect } from "react";
import { useDocumentStore } from "../store/documentStore";
import { fetchWorkspaceCategories } from "../lib/api";
import { WorkspaceCard } from "./WorkspaceCard";

export function WorkspaceGrid() {
  const categories = useDocumentStore((s) => s.workspaceCategories);
  const setCategories = useDocumentStore((s) => s.setWorkspaceCategories);
  const setActiveWorkspace = useDocumentStore((s) => s.setActiveWorkspace);

  useEffect(() => {
    fetchWorkspaceCategories()
      .then((data) => setCategories(data.categories))
      .catch(() => {});
  }, [setCategories]);

  if (categories.length === 0) {
    return (
      <div className="glass-panel flex min-h-[400px] flex-col items-center justify-center p-10 text-center animate-fade-in-up">
        <h3 className="text-lg font-bold text-[var(--text-primary)]">Inga kategorier ännu</h3>
        <p className="mt-2 max-w-sm text-sm text-[var(--text-secondary)]">
          Bearbeta dokument i Aktivitets-läget för att skapa workspace-kategorier.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4 animate-fade-in-up">
      <div className="px-1">
        <p className="section-kicker">Workspaces</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Välj en kategori för att börja analysera
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => (
          <WorkspaceCard
            key={cat.category}
            category={cat}
            onClick={() => setActiveWorkspace(cat.category)}
          />
        ))}
      </div>
    </section>
  );
}
