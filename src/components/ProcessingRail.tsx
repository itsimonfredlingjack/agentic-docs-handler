import { useMemo, useRef, useState, useEffect } from "react";
import { useDocumentStore } from "../store/documentStore";
import { isProcessingStatus } from "../lib/status";
import type { UiDocument } from "../types/documents";
import { GhostTyper } from "./GhostTyper";

const KIND_LABELS: Record<string, string> = {
  receipt: "Kvitto",
  contract: "Avtal",
  invoice: "Faktura",
  meeting_notes: "Mötesanteckning",
  audio: "Ljud",
  file_moved: "Flyttad",
};

const MINI_STEPPER_STAGES = [
  "uploading",
  "classifying",
  "extracting",
  "organizing",
  "indexing",
] as const;

const ACTIVE_STAGE_MAP: Record<string, string> = {
  processing: "classifying",
  transcribing: "classifying",
  classified: "extracting",
  queued: "uploading",
};

const STAGE_LABELS: Record<string, string> = {
  queued: "I kö",
  uploading: "Laddar upp",
  processing: "Bearbetar",
  transcribing: "Transkriberar",
  classifying: "Klassificera",
  classified: "Extrahera",
  extracting: "Extrahera",
  organizing: "Organisera",
  indexing: "Indexera",
};

const WAVEFORM_HEIGHTS = [40, 70, 55, 80, 60];

const PRE_CLASSIFICATION_STAGES = new Set(["queued", "uploading", "processing", "transcribing"]);

function resolveMiniStage(raw: string): string {
  return ACTIVE_STAGE_MAP[raw] ?? raw;
}

function miniStageIndex(stage: string): number {
  const resolved = resolveMiniStage(stage);
  const idx = MINI_STEPPER_STAGES.findIndex((s) => s === resolved);
  return idx === -1 ? 0 : idx;
}

function MiniStepper({ currentStage }: { currentStage: string }) {
  const activeIdx = miniStageIndex(currentStage);

  return (
    <div className="rail-card__stepper" aria-hidden="true">
      {MINI_STEPPER_STAGES.map((stage, i) => {
        const isActive = i === activeIdx;
        const isFilled = i <= activeIdx;

        return (
          <span
            key={stage}
            className="rail-card__stepper-dot"
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: isFilled
                ? "var(--accent-primary)"
                : "var(--glass-line)",
              boxShadow: isActive
                ? "0 0 0 2px var(--accent-primary)"
                : undefined,
              margin: "0 2px",
            }}
          />
        );
      })}
    </div>
  );
}

function ModalityAnimation({ doc }: { doc: UiDocument }) {
  if (doc.sourceModality === "audio") {
    return (
      <div className="rail-card__modality-audio">
        {WAVEFORM_HEIGHTS.map((height, i) => (
          <span key={i} style={{ height: `${height}%` }} />
        ))}
      </div>
    );
  }

  if (doc.sourceModality === "image") {
    return <div className="rail-card__modality-scan" />;
  }

  return (
    <div
      className="processing-bar mt-1.5"
      style={{ height: 3 }}
    />
  );
}

function extractKeyLine(doc: UiDocument): string {
  if (!doc.extraction?.fields) return "";
  const f = doc.extraction.fields as Record<string, string | undefined>;
  const parts: string[] = [];
  if (f.vendor) parts.push(String(f.vendor));
  if (f.amount) parts.push(String(f.amount));
  if (f.date) parts.push(String(f.date));
  if (f.parties) parts.push(String(f.parties));
  if (parts.length === 0) {
    for (const [, value] of Object.entries(doc.extraction.fields)) {
      if (typeof value === "string" && value.trim()) {
        parts.push(value);
        if (parts.length >= 2) break;
      }
    }
  }
  return parts.join(" · ");
}

function RailCard({ doc }: { doc: UiDocument }) {
  const stageLabel = STAGE_LABELS[doc.status] ?? doc.status;
  const isClassified = !PRE_CLASSIFICATION_STAGES.has(doc.status);
  const shapeClass = isClassified ? `rail-card--${doc.kind}` : "rail-card--unclassified";
  const keyLine = extractKeyLine(doc);
  const hasExtraction = Boolean(keyLine);

  return (
    <div className={`rail-card ${shapeClass}`} data-testid="rail-card">
      {isClassified ? (
        <GhostTyper text={doc.title} className="rail-card__title" speed={20} />
      ) : (
        <div className="rail-card__title">{doc.title}</div>
      )}
      <div className="rail-card__stage">{stageLabel}</div>
      <MiniStepper currentStage={doc.status} />
      {hasExtraction ? (
        <GhostTyper text={keyLine} className="rail-card__fields" speed={18} />
      ) : (
        <ModalityAnimation doc={doc} />
      )}
    </div>
  );
}

function CompletionReceipt({ doc }: { doc: UiDocument }) {
  const isFailed = doc.status === "failed";
  const kindLabel = KIND_LABELS[doc.kind] ?? "Dokument";
  return (
    <div className="rail-card rail-card--done" data-testid="rail-card-done">
      <div className="flex items-center gap-2">
        <span style={{ color: isFailed ? "var(--invoice-color)" : "var(--receipt-color)", fontSize: 16 }}>
          {isFailed ? "✕" : "✓"}
        </span>
        <span className="rail-card__title">{doc.title}</span>
      </div>
      <div className="rail-card__stage" style={{ color: isFailed ? "var(--invoice-color)" : "var(--receipt-color)" }}>
        {isFailed ? "Misslyckades" : kindLabel}
      </div>
    </div>
  );
}

export function ProcessingRail() {
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);

  const processingDocs = useMemo(() => {
    return documentOrder
      .map((id) => documents[id])
      .filter((doc): doc is UiDocument => Boolean(doc) && isProcessingStatus(doc));
  }, [documents, documentOrder]);

  // Track previously-processing IDs to detect completions
  const prevProcessingIds = useRef<Set<string>>(new Set());
  const [recentlyCompleted, setRecentlyCompleted] = useState<Map<string, UiDocument>>(new Map());

  useEffect(() => {
    const currentIds = new Set(processingDocs.map((d) => d.id));
    const newlyCompleted = new Map<string, UiDocument>();

    for (const prevId of prevProcessingIds.current) {
      if (!currentIds.has(prevId)) {
        const doc = documents[prevId];
        if (doc) {
          newlyCompleted.set(prevId, doc);
        }
      }
    }

    prevProcessingIds.current = currentIds;

    if (newlyCompleted.size > 0) {
      setRecentlyCompleted((prev) => {
        const next = new Map(prev);
        for (const [id, doc] of newlyCompleted) {
          next.set(id, doc);
        }
        return next;
      });

      // Remove after 2 seconds
      const ids = [...newlyCompleted.keys()];
      const timer = setTimeout(() => {
        setRecentlyCompleted((prev) => {
          const next = new Map(prev);
          for (const id of ids) {
            next.delete(id);
          }
          return next;
        });
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [processingDocs, documents]);

  if (processingDocs.length === 0 && recentlyCompleted.size === 0) {
    return null;
  }

  return (
    <div className="processing-rail" role="region" aria-label="Aktiva jobb">
      {processingDocs.map((doc) => (
        <RailCard key={doc.id} doc={doc} />
      ))}
      {[...recentlyCompleted.values()].map((doc) => (
        <CompletionReceipt key={`done-${doc.id}`} doc={doc} />
      ))}
    </div>
  );
}
