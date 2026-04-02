import { useEffect, useState } from "react";

import type { DiscoveryCard } from "../types/documents";
import { dismissWorkspaceDiscovery, fetchWorkspaceDiscovery } from "../lib/api";
import { useDocumentStore } from "../store/documentStore";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { SkeletonLoader } from "./ui/SkeletonLoader";

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
        <h2 className="text-sm-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Insikter</h2>
        <div className="mt-2">
          <SkeletonLoader count={2} />
          <p className="mt-2 text-base-ui text-[var(--text-muted)]">Söker samband mellan filer...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="pt-4">
        <h2 className="text-sm-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Insikter</h2>
        <div className="mt-2">
          <EmptyState title="Kunde inte läsa insikter" description={error} />
        </div>
      </section>
    );
  }

  if (cards.length === 0) {
    return null;
  }

  return (
    <section className="pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Insikter</h2>
        <span className="text-sm-ui text-[var(--text-muted)]">{cards.length} fynd</span>
      </div>
      <div className="space-y-3">
        {cards.map((card) => (
          <Card key={card.id} className="rounded-2xl bg-white/[0.035] px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <span className="rounded-full bg-[var(--surface-8)] px-2.5 py-1 text-sm-ui font-medium text-[var(--text-secondary)]">
                {RELATION_LABELS[card.relation_type] ?? card.relation_type}
              </span>
              <button
                type="button"
                className="text-sm-ui text-[var(--text-muted)] transition hover:text-white/80"
                aria-label="Dölj insikt"
                onClick={async () => {
                  await dismissWorkspaceDiscovery(workspaceId, card.id);
                  setCards((current) => current.filter((entry) => entry.id !== card.id));
                }}
              >
                Dölj
              </button>
            </div>
            <p className="mt-2 text-base-ui leading-relaxed text-[var(--text-secondary)]">
              {card.explanation}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {card.files.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  className="rounded-full border border-[var(--surface-10)] bg-[var(--surface-4)] px-3 py-1.5 text-base-ui text-[var(--text-secondary)] transition hover:bg-[var(--surface-8)]"
                  onClick={() => setSelectedDocument(file.id)}
                >
                  {file.title}
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {loading && cards.length > 0 ? (
        <p className="mt-2 text-sm-ui text-[var(--text-muted)]">Uppdaterar insikter...</p>
      ) : null}
    </section>
  );
}
