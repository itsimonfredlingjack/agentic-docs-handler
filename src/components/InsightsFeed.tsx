import { useMemo, useState } from "react";

import { useDocumentStore } from "../store/documentStore";
import { computeActionQueues, totalActionCount } from "../lib/action-queues";
import type { ActionQueue, ActionQueueItem, ActionQueueType } from "../lib/action-queues";
import { batchDeleteDocuments } from "../lib/api";
import { t } from "../lib/locale";
import { ActionCard } from "./ActionCard";
import { SkeletonLoader } from "./ui/SkeletonLoader";

type InsightsFeedProps = {
  workspaceId: string;
};

const SECTION_LABELS: Record<ActionQueueType, string> = {
  merge_duplicates: "actions.section_duplicates",
  review_classification: "actions.section_review",
  cluster_to_workspace: "actions.section_clusters",
};

export function InsightsFeed({ workspaceId }: InsightsFeedProps) {
  const discoveryCards = useDocumentStore((s) => s.discoveryCards);
  const documents = useDocumentStore((s) => s.documents);
  const loading = useDocumentStore((s) => s.discoveryLoading);
  const dismissCard = useDocumentStore((s) => s.dismissDiscoveryCard);
  const removeDocuments = useDocumentStore((s) => s.removeDocuments);

  const queues = useMemo(
    () => computeActionQueues(discoveryCards, documents),
    [discoveryCards, documents],
  );

  const total = totalActionCount(queues);

  if (loading && discoveryCards.length === 0) {
    return (
      <div className="action-feed p-4">
        <SkeletonLoader count={3} />
      </div>
    );
  }

  if (total === 0) {
    return <ActionFeedEmpty />;
  }

  return (
    <div className="action-feed p-4 space-y-6">
      {queues.map((queue) => (
        <ActionQueueSection
          key={queue.type}
          queue={queue}
          workspaceId={workspaceId}
          onDismissCards={(cardIds) => {
            for (const cardId of cardIds) {
              dismissCard(workspaceId, cardId);
            }
          }}
          onDeleteDocuments={async (docIds) => {
            try {
              await batchDeleteDocuments(docIds);
              removeDocuments(docIds);
            } catch {
              // Optimistic removal failed — cards will reappear on next fetch
            }
          }}
        />
      ))}
    </div>
  );
}

// ---- Section for each queue type -------------------------------------------

type ActionQueueSectionProps = {
  queue: ActionQueue;
  workspaceId: string;
  onDismissCards: (cardIds: string[]) => void;
  onDeleteDocuments: (docIds: string[]) => Promise<void>;
};

function ActionQueueSection({
  queue,
  workspaceId,
  onDismissCards,
  onDeleteDocuments,
}: ActionQueueSectionProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const setSelectedDocument = useDocumentStore((s) => s.setSelectedDocument);

  // Keep index in bounds as items get dismissed
  const safeIndex = Math.min(currentIndex, queue.items.length - 1);
  const item = queue.items[safeIndex];

  if (!item) return null;

  const handleSkip = () => {
    // Dismiss backing cards
    if (item.cardIds.length > 0) {
      onDismissCards(item.cardIds);
    }
    // Advance to next item (or stay if last)
    if (safeIndex < queue.items.length - 1) {
      setCurrentIndex(safeIndex + 1);
    }
  };

  const handleKeepNewest = async () => {
    // Keep the document with the most recent createdAt, delete the rest
    const docs = item.documents;
    if (docs.length < 2) return;

    const store = useDocumentStore.getState();
    const withTimestamps = docs.map((d) => ({
      ...d,
      createdAt: store.documents[d.id]?.createdAt ?? "",
    }));
    withTimestamps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const toDelete = withTimestamps.slice(1).map((d) => d.id);

    await onDeleteDocuments(toDelete);
    // Dismiss the discovery cards backing this item
    if (item.cardIds.length > 0) {
      onDismissCards(item.cardIds);
    }
  };

  const handleKeepBoth = () => {
    // Just dismiss the cards — keep all documents
    if (item.cardIds.length > 0) {
      onDismissCards(item.cardIds);
    }
  };

  const handleMoveToWorkspace = () => {
    // Select the first doc to open inspector context
    if (item.documents[0]) {
      setSelectedDocument(item.documents[0].id);
    }
  };

  return (
    <div>
      {/* Section header */}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {t(SECTION_LABELS[queue.type])}
        </h3>
        <span className="text-xs-ui font-mono text-[var(--text-disabled)]">
          {t("actions.progress")
            .replace("{current}", String(safeIndex + 1))
            .replace("{total}", String(queue.count))}
        </span>
      </div>

      {/* Current action card */}
      <ActionCard
        queueType={queue.type}
        item={item}
        index={safeIndex}
        total={queue.count}
        onSkip={handleSkip}
        onKeepNewest={queue.type === "merge_duplicates" ? handleKeepNewest : undefined}
        onKeepBoth={queue.type === "merge_duplicates" ? handleKeepBoth : undefined}
        onOpenInspector={(docId) => setSelectedDocument(docId)}
        onMoveToWorkspace={queue.type === "cluster_to_workspace" ? handleMoveToWorkspace : undefined}
      />
    </div>
  );
}

// ---- Empty state -----------------------------------------------------------

function ActionFeedEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <p className="text-base-ui text-[var(--text-secondary)]">
        {t("actions.all_done")}
      </p>
    </div>
  );
}
