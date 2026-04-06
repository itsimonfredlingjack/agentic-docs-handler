import { useState } from "react";

import type { ActionQueueItem, ActionQueueType } from "../lib/action-queues";
import { kindColor } from "../lib/document-colors";
import { useDocumentStore } from "../store/documentStore";
import { t } from "../lib/locale";
import type { UiDocumentKind } from "../types/documents";

type ActionCardProps = {
  queueType: ActionQueueType;
  item: ActionQueueItem;
  index: number;
  total: number;
  onSkip: () => void;
  onKeepNewest?: () => void;
  onKeepBoth?: () => void;
  onOpenInspector?: (docId: string) => void;
  onMoveToWorkspace?: () => void;
};

export function ActionCard({
  queueType,
  item,
  index,
  total,
  onSkip,
  onKeepNewest,
  onKeepBoth,
  onOpenInspector,
  onMoveToWorkspace,
}: ActionCardProps) {
  const setSelectedDocument = useDocumentStore((s) => s.setSelectedDocument);
  const [dismissing, setDismissing] = useState(false);

  const handleSkip = () => {
    setDismissing(true);
    setTimeout(() => onSkip(), 180);
  };

  return (
    <div
      className="action-card rounded-lg p-3.5"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        opacity: dismissing ? 0 : 1,
        transition: "opacity var(--transition-smooth)",
      }}
    >
      {/* Explanation */}
      <p className="mb-2.5 text-sm-ui leading-relaxed text-[var(--text-secondary)]">
        {queueType === "merge_duplicates" && t("actions.identical_content")}
        {queueType === "review_classification" && t("actions.could_not_classify")}
        {queueType === "cluster_to_workspace" && (
          <>
            {item.documents.length} {t("actions.shared_entities")}
          </>
        )}
      </p>

      {/* Document pills */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {item.documents.map((doc) => (
          <button
            key={doc.id}
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-[var(--surface-8)] bg-[var(--surface-4)] px-2.5 py-1.5 transition hover:border-[var(--surface-10)]"
            onClick={() => {
              setSelectedDocument(doc.id);
              onOpenInspector?.(doc.id);
            }}
          >
            <span
              className="inline-block h-[5px] w-[5px] rounded-full"
              style={{ background: kindColor(doc.kind as UiDocumentKind) }}
            />
            <span className="text-xs-ui text-[var(--text-primary)]">{doc.title}</span>
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {queueType === "merge_duplicates" && (
          <>
            <button
              type="button"
              className="rounded px-2.5 py-1 text-xs-ui font-medium text-[var(--accent-primary)] bg-[rgba(88,86,214,0.12)] transition hover:bg-[rgba(88,86,214,0.2)]"
              onClick={onKeepNewest}
            >
              {t("actions.keep_newest")}
            </button>
            <button
              type="button"
              className="rounded px-2.5 py-1 text-xs-ui font-medium text-[var(--text-secondary)] bg-[var(--surface-4)] transition hover:bg-[var(--surface-6)]"
              onClick={onKeepBoth}
            >
              {t("actions.keep_both")}
            </button>
          </>
        )}

        {queueType === "review_classification" && (
          <button
            type="button"
            className="rounded px-2.5 py-1 text-xs-ui font-medium text-[var(--accent-primary)] bg-[rgba(88,86,214,0.12)] transition hover:bg-[rgba(88,86,214,0.2)]"
            onClick={() => {
              if (item.documents[0]) {
                setSelectedDocument(item.documents[0].id);
                onOpenInspector?.(item.documents[0].id);
              }
            }}
          >
            {t("actions.open_inspector")}
          </button>
        )}

        {queueType === "cluster_to_workspace" && (
          <button
            type="button"
            className="rounded px-2.5 py-1 text-xs-ui font-medium text-[var(--accent-primary)] bg-[rgba(88,86,214,0.12)] transition hover:bg-[rgba(88,86,214,0.2)]"
            onClick={onMoveToWorkspace}
          >
            {t("actions.move_to_workspace")}
          </button>
        )}

        <button
          type="button"
          className="rounded px-2.5 py-1 text-xs-ui text-[var(--text-disabled)] transition hover:text-[var(--text-secondary)] hover:bg-[var(--surface-4)]"
          onClick={handleSkip}
        >
          {t("actions.skip")}
        </button>

        {/* Progress indicator */}
        <span className="ml-auto text-xs-ui font-mono text-[var(--text-disabled)]">
          {t("actions.progress")
            .replace("{current}", String(index + 1))
            .replace("{total}", String(total))}
        </span>
      </div>
    </div>
  );
}
