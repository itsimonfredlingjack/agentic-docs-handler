import { useMemo } from "react";

import type { DiscoveryFilterType } from "../types/documents";
import { useDocumentStore } from "../store/documentStore";
import { t } from "../lib/locale";
import { InsightCard } from "./InsightCard";
import { SkeletonLoader } from "./ui/SkeletonLoader";

type InsightsFeedProps = {
  workspaceId: string;
};

type FilterDef = {
  key: DiscoveryFilterType;
  label: string;
};

const FILTERS: FilterDef[] = [
  { key: "all", label: "insights.filter_all" },
  { key: "related", label: "insights.filter_related" },
  { key: "version", label: "insights.filter_versions" },
  { key: "duplicate", label: "insights.filter_duplicates" },
];

export function InsightsFeed({ workspaceId }: InsightsFeedProps) {
  const cards = useDocumentStore((s) => s.discoveryCards);
  const loading = useDocumentStore((s) => s.discoveryLoading);
  const filter = useDocumentStore((s) => s.discoveryFilter);
  const setFilter = useDocumentStore((s) => s.setDiscoveryFilter);
  const dismissCard = useDocumentStore((s) => s.dismissDiscoveryCard);

  const counts = useMemo(() => {
    const result = { all: cards.length, related: 0, version: 0, duplicate: 0 };
    for (const card of cards) {
      if (card.relation_type in result) {
        result[card.relation_type as keyof typeof result]++;
      }
    }
    return result;
  }, [cards]);

  const filteredCards = useMemo(
    () => filter === "all" ? cards : cards.filter((c) => c.relation_type === filter),
    [cards, filter],
  );

  if (loading && cards.length === 0) {
    return (
      <div className="insights-feed flex gap-4 p-4">
        <div className="w-[90px] flex-shrink-0">
          <SkeletonLoader count={4} />
        </div>
        <div className="flex-1">
          <SkeletonLoader count={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="insights-feed flex gap-4 p-4">
      {/* Filter sidebar */}
      <nav className="insights-filter-sidebar flex w-[90px] flex-shrink-0 flex-col gap-1.5">
        {FILTERS.map((f) => {
          const count = counts[f.key];
          const isActive = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              className="insights-filter-card rounded-lg p-2 text-center transition"
              style={{
                background: isActive ? "rgba(88,86,214,0.12)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${isActive ? "rgba(88,86,214,0.25)" : "rgba(255,255,255,0.06)"}`,
              }}
              onClick={() => setFilter(f.key)}
            >
              <div
                className="font-mono text-lg-ui font-bold"
                style={{ color: isActive ? "#5856d6" : "rgba(255,255,255,0.55)" }}
              >
                {count}
              </div>
              <div
                className="text-[8px] uppercase tracking-[0.08em]"
                style={{ color: isActive ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.3)" }}
              >
                {t(f.label)}
              </div>
            </button>
          );
        })}
      </nav>

      {/* Card feed */}
      <div className="flex-1 space-y-2.5">
        {filteredCards.length === 0 ? (
          <InsightsEmptyState hasCards={cards.length > 0} />
        ) : (
          filteredCards.map((card) => (
            <InsightCard
              key={card.id}
              card={card}
              onDismiss={(cardId) => dismissCard(workspaceId, cardId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function InsightsEmptyState({ hasCards }: { hasCards: boolean }) {
  if (hasCards) {
    // Filter is active but no matches for this type
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm-ui text-[var(--text-muted)]">
          {t("discovery.result_count").replace("{count}", "0")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16">
      {/* Simplified AiPresence ring motif */}
      <div className="insights-empty-ring mb-4">
        <svg width="56" height="56" viewBox="0 0 56 56">
          <circle
            cx="28" cy="28" r="26"
            fill="none"
            stroke="rgba(88,86,214,0.25)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          <circle
            cx="28" cy="28" r="10"
            fill="rgba(88,86,214,0.12)"
            stroke="rgba(88,86,214,0.3)"
            strokeWidth="1"
          />
          <circle cx="46" cy="12" r="2" fill="#5856d6" opacity="0.5" />
        </svg>
      </div>
      <p className="text-base-ui text-[var(--text-secondary)]">
        {t("insights.empty_title")}
      </p>
      <p className="mt-1.5 max-w-[280px] text-center text-sm-ui leading-relaxed text-[var(--text-muted)]">
        {t("insights.empty_description")}
      </p>
    </div>
  );
}
