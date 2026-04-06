import { useCallback, useMemo } from "react";

import { useWorkspaceStore } from "../store/workspaceStore";
import { useDocumentStore } from "../store/documentStore";
import { computeActionQueues, totalActionCount } from "../lib/action-queues";
import { t } from "../lib/locale";

export function WorkspaceTabBar() {
  const activeTab = useWorkspaceStore((s) => s.activeWorkspaceTab);
  const setTab = useWorkspaceStore((s) => s.setActiveWorkspaceTab);
  const discoveryCards = useDocumentStore((s) => s.discoveryCards);
  const documents = useDocumentStore((s) => s.documents);

  const actionCount = useMemo(() => {
    const queues = computeActionQueues(discoveryCards, documents);
    return totalActionCount(queues);
  }, [discoveryCards, documents]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowRight" && activeTab === "documents") {
        e.preventDefault();
        setTab("insights");
      } else if (e.key === "ArrowLeft" && activeTab === "insights") {
        e.preventDefault();
        setTab("documents");
      }
    },
    [activeTab, setTab],
  );

  return (
    <div
      className="workspace-tab-bar flex border-b border-white/[0.06]"
      role="tablist"
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "documents"}
        tabIndex={activeTab === "documents" ? 0 : -1}
        className={`workspace-tab px-4 py-2 text-sm-ui transition-colors ${
          activeTab === "documents"
            ? "border-b-2 border-[var(--accent-primary)] font-semibold text-[var(--accent-primary)]"
            : "border-b-2 border-transparent text-[var(--text-muted)]"
        }`}
        onClick={() => setTab("documents")}
      >
        {t("insights.tab_documents")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "insights"}
        tabIndex={activeTab === "insights" ? 0 : -1}
        className={`workspace-tab px-4 py-2 text-sm-ui transition-colors ${
          activeTab === "insights"
            ? "border-b-2 border-[var(--accent-primary)] font-semibold text-[var(--accent-primary)]"
            : "border-b-2 border-transparent text-[var(--text-muted)]"
        }`}
        onClick={() => setTab("insights")}
      >
        {t("actions.tab")}
        {actionCount > 0 && (
          <span className="ml-1.5 inline-block rounded-full bg-[rgba(88,86,214,0.2)] px-1.5 py-0.5 font-mono text-xs-ui text-[var(--accent-primary)]">
            {actionCount}
          </span>
        )}
      </button>
    </div>
  );
}
