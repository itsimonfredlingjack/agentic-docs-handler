import { useState } from "react";

import type { DiscoveryCard } from "../types/documents";
import { kindColor } from "../lib/document-colors";
import { useDocumentStore } from "../store/documentStore";
import { t } from "../lib/locale";

type InsightCardProps = {
  card: DiscoveryCard;
  onDismiss: (cardId: string) => void;
};

const TYPE_BADGE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  related: {
    bg: "rgba(88,86,214,0.15)",
    color: "#5856d6",
    label: "insights.filter_related",
  },
  duplicate: {
    bg: "rgba(52,199,89,0.15)",
    color: "#34c759",
    label: "insights.filter_duplicates",
  },
  version: {
    bg: "rgba(255,55,95,0.15)",
    color: "#ff375f",
    label: "insights.filter_versions",
  },
};

const TYPE_BORDER_STYLES: Record<string, string> = {
  related: "rgba(255,255,255,0.08)",
  duplicate: "rgba(52,199,89,0.15)",
  version: "rgba(255,55,95,0.15)",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("insights.time_now").toLowerCase();
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}

function resolveDocKind(docId: string, fileRefKind: string | null): string {
  if (fileRefKind) return fileRefKind;
  const doc = useDocumentStore.getState().documents[docId];
  return doc?.kind ?? "generic";
}

function docMetaLine(docId: string): string {
  const doc = useDocumentStore.getState().documents[docId];
  if (!doc) return "";
  const parts: string[] = [doc.kind.replace("_", " ")];
  const fields = doc.extraction?.fields;
  if (fields) {
    if (typeof fields.total_amount === "string" && fields.total_amount) parts.push(fields.total_amount);
    else if (typeof fields.amount === "string" && fields.amount) parts.push(fields.amount);
    if (typeof fields.date === "string" && fields.date) parts.push(fields.date);
  }
  return parts.join(" · ");
}

function ConnectorSymbol({ type }: { type: string }) {
  const color = type === "duplicate" ? "rgba(52,199,89,0.4)" : "rgba(255,55,95,0.4)";
  const symbol = type === "duplicate" ? "=" : "\u2192";
  return (
    <span
      className="flex items-center text-sm-ui font-mono"
      style={{ color }}
    >
      {symbol}
    </span>
  );
}

export function InsightCard({ card, onDismiss }: InsightCardProps) {
  const setSelectedDocument = useDocumentStore((s) => s.setSelectedDocument);
  const [dismissing, setDismissing] = useState(false);

  const badge = TYPE_BADGE_STYLES[card.relation_type] ?? TYPE_BADGE_STYLES.related;
  const borderColor = TYPE_BORDER_STYLES[card.relation_type] ?? TYPE_BORDER_STYLES.related;
  const showConfidence = card.relation_type === "version" || (card.relation_type === "duplicate" && card.confidence < 1);
  const confidencePct = Math.round(card.confidence * 100);
  const isVersionOrDupe = card.relation_type === "version" || card.relation_type === "duplicate";

  return (
    <div
      className="insight-card rounded-lg p-3.5"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${borderColor}`,
        opacity: dismissing ? 0 : 1,
        transition: "opacity var(--transition-smooth)",
      }}
    >
      {/* Header: badge + confidence + time + dismiss */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className="rounded px-1.5 py-0.5 text-xs-ui font-mono tracking-[0.04em]"
            style={{ background: badge.bg, color: badge.color }}
          >
            {t(badge.label).toUpperCase()}
          </span>
          {showConfidence && (
            <span className="text-xs-ui font-mono text-[var(--text-disabled)]">
              {confidencePct}%
            </span>
          )}
          <span className="text-xs-ui text-[var(--text-disabled)]">
            {relativeTime(card.created_at)}
          </span>
        </div>
        <button
          type="button"
          className="text-xs-ui text-[var(--text-disabled)] transition hover:text-[var(--text-secondary)]"
          onClick={() => {
            setDismissing(true);
            setTimeout(() => onDismiss(card.id), 200);
          }}
        >
          {t("discovery.hide_button")}
        </button>
      </div>

      {/* Explanation text */}
      <p className="mb-2.5 text-sm-ui leading-relaxed text-[var(--text-primary)]">
        {card.explanation}
      </p>

      {/* Document pills */}
      <div className="flex flex-wrap items-center gap-2">
        {card.files.map((file, idx) => {
          const kind = resolveDocKind(file.id, file.kind ?? null);
          const isOlderVersion = card.relation_type === "version" && idx === 0 && card.files.length > 1;
          return (
            <div key={file.id} className="contents">
              {idx > 0 && isVersionOrDupe && (
                <ConnectorSymbol type={card.relation_type} />
              )}
              <button
                type="button"
                className="insight-doc-pill flex items-center gap-1.5 rounded-md border border-[var(--surface-8)] bg-[var(--surface-4)] px-2.5 py-1.5 transition hover:border-[var(--surface-10)]"
                style={{ opacity: isOlderVersion ? 0.6 : 1 }}
                onClick={() => setSelectedDocument(file.id)}
              >
                <span
                  className="inline-block h-[5px] w-[5px] rounded-full"
                  style={{ background: kindColor(kind as Parameters<typeof kindColor>[0]) }}
                />
                <span className="text-left">
                  <span className="block text-xs-ui text-[var(--text-primary)]">{file.title}</span>
                  <span className="block text-[8px] font-mono text-[var(--text-muted)]">
                    {docMetaLine(file.id)}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
