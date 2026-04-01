import { memo, useMemo, useRef, useState, useEffect } from "react";
import { useDocumentStore } from "../store/documentStore";
import { isProcessingStatus } from "../lib/status";
import { kindRgbVar } from "../lib/document-colors";
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

// Statuses that mean extraction is done and the overlay should snap to 100%.
// failed, awaiting_confirmation, etc. are intentionally excluded — those statuses
// don't appear in the processing rail so the hook never sees them.
const EVAP_DONE_STAGES = new Set(["extracted", "organizing", "indexing", "completed"]);

function useEvaporationProgress(status: string): number {
  const [progress, setProgress] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    // Snap to done for post-extraction stages
    if (EVAP_DONE_STAGES.has(status)) {
      setProgress((prev) => (prev === 100 ? prev : 100));
      return;
    }

    // Animate during extraction
    if (status === "extracting") {
      startRef.current = performance.now();
      const DURATION = 8000; // 8 seconds to reach 85%
      const MAX = 85;

      function tick() {
        const elapsed = performance.now() - (startRef.current ?? performance.now());
        const t = Math.min(elapsed / DURATION, 1);
        // Ease-out cubic for natural deceleration
        const eased = 1 - Math.pow(1 - t, 3);
        setProgress(eased * MAX);
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    }

    // Reset for pre-extraction stages
    setProgress((prev) => (prev === 0 ? prev : 0));
  }, [status]);

  return progress;
}

function EvaporationOverlay({ doc }: { doc: UiDocument }) {
  const progress = useEvaporationProgress(doc.status);
  if (!doc.thumbnailData || progress === 0) return null;

  const isDone = progress >= 100;

  return (
    <div className="rail-card__evap">
      <div
        className={`rail-card__evap-thumb${isDone ? " rail-card__evap-thumb--done" : ""}`}
        style={{
          backgroundImage: `url(data:image/jpeg;base64,${doc.thumbnailData})`,
          "--evap-progress": `${progress}%`,
        } as React.CSSProperties}
      />
      <div
        className={`rail-card__evap-line${isDone ? " rail-card__evap-line--done" : ""}`}
        style={{ "--evap-progress": `${progress}%` } as React.CSSProperties}
      />
    </div>
  );
}

const RailCard = memo(function RailCard({ doc }: { doc: UiDocument }) {
  const prevStatusRef = useRef(doc.status);
  const [classifyLock, setClassifyLock] = useState(false);

  useEffect(() => {
    const wasUnclassified = PRE_CLASSIFICATION_STAGES.has(prevStatusRef.current);
    const isNowClassified = !PRE_CLASSIFICATION_STAGES.has(doc.status);
    prevStatusRef.current = doc.status;
    if (wasUnclassified && isNowClassified) {
      setClassifyLock(true);
      const timer = setTimeout(() => setClassifyLock(false), 500);
      return () => clearTimeout(timer);
    }
  }, [doc.status]);

  const stageLabel = STAGE_LABELS[doc.status] ?? doc.status;
  const isClassified = !PRE_CLASSIFICATION_STAGES.has(doc.status);

  // Shape class: use fast pulse for processing/transcribing
  const unclassifiedClass = doc.status === "processing" || doc.status === "transcribing"
    ? "rail-card--classify-pending" : "rail-card--unclassified";
  const shapeClass = isClassified ? `rail-card--${doc.kind}` : unclassifiedClass;
  const lockClass = classifyLock ? "rail-card--classify-lock" : "";

  // Set glow color to match document type
  const lockStyle = classifyLock ? {
    "--classify-lock-color": `var(--${doc.kind === "meeting_notes" ? "meeting" : doc.kind}-color, var(--accent-primary))`
  } as React.CSSProperties : undefined;

  const keyLine = extractKeyLine(doc);
  const hasExtraction = Boolean(keyLine);

  return (
    <div className={`rail-card ${shapeClass}${lockClass ? ` ${lockClass}` : ""}`} style={{ ...lockStyle, "--type-color-rgb": `var(${kindRgbVar(doc.kind)})`, position: "relative" } as React.CSSProperties} data-testid="rail-card">
      <EvaporationOverlay doc={doc} />
      <div style={{ position: "relative", zIndex: 3 }}>
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
    </div>
  );
});

const CompletionReceipt = memo(function CompletionReceipt({ doc }: { doc: UiDocument }) {
  const isFailed = doc.status === "failed";
  const kindLabel = KIND_LABELS[doc.kind] ?? "Dokument";
  const keyLine = extractKeyLine(doc);

  return (
    <div
      className={`rail-card rail-card--done rail-card--${doc.kind ?? "generic"}`}
      style={{ "--type-color-rgb": `var(${kindRgbVar(doc.kind)})` } as React.CSSProperties}
      data-testid="rail-card-done"
    >
      <div className="flex items-center gap-2">
        <span style={{ color: isFailed ? "var(--invoice-color)" : "var(--receipt-color)", fontSize: 16 }}>
          {isFailed ? "✕" : "✓"}
        </span>
        <span className="rail-card__title">{doc.title}</span>
      </div>
      <div className="rail-card__stage" style={{ color: isFailed ? "var(--invoice-color)" : "var(--receipt-color)" }}>
        {isFailed ? "Misslyckades" : kindLabel}
      </div>
      {keyLine && !isFailed && (
        <div className="rail-card__fields">{keyLine}</div>
      )}
    </div>
  );
});

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
    <div className="processing-rail" role="region" aria-label="Aktiva jobb" aria-live="polite">
      {processingDocs.map((doc) => (
        <RailCard key={doc.id} doc={doc} />
      ))}
      {[...recentlyCompleted.values()].map((doc) => (
        <CompletionReceipt key={`done-${doc.id}`} doc={doc} />
      ))}
    </div>
  );
}
