import { useEffect, useState } from "react";

import type { DiscoveryCard } from "../types/documents";
import { dismissWorkspaceDiscovery, fetchWorkspaceDiscovery } from "../lib/api";
import { useDocumentStore } from "../store/documentStore";

type DiscoveryCardsProps = {
  workspaceId: string;
};

const RELATION_LABELS: Record<string, string> = {
  duplicate: "Dublett",
  related: "Relaterad",
  version: "Version",
};

export function DiscoveryCards({ workspaceId }: DiscoveryCardsProps) {
  const setSelectedDocument = useDocumentStore((state) => state.setSelectedDocument);
  const [cards, setCards] = useState<DiscoveryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchWorkspaceDiscovery(workspaceId);
        if (cancelled) return;
        setCards(response.cards);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Kunde inte läsa discovery");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (loading && cards.length === 0) {
    return (
      <section className="pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">Insikter</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">Söker samband mellan filer...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">Insikter</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{error}</p>
      </section>
    );
  }

  if (cards.length === 0) {
    return null;
  }

  return (
    <section className="pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">Insikter</h2>
        <span className="text-xs text-[var(--text-muted)]">{cards.length} fynd</span>
      </div>
      <div className="space-y-3">
        {cards.map((card) => (
          <article
            key={card.id}
            className="rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-medium text-white/72">
                {RELATION_LABELS[card.relation_type] ?? card.relation_type}
              </span>
              <button
                type="button"
                className="text-xs text-[var(--text-muted)] transition hover:text-white/80"
                aria-label="Dölj insikt"
                onClick={async () => {
                  await dismissWorkspaceDiscovery(workspaceId, card.id);
                  setCards((current) => current.filter((entry) => entry.id !== card.id));
                }}
              >
                Dölj
              </button>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              {card.explanation}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {card.files.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white/82 transition hover:bg-white/[0.08]"
                  onClick={() => setSelectedDocument(file.id)}
                >
                  {file.title}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
