import { useMemo } from "react";
import { useDocumentStore } from "../store/documentStore";
import { isProcessingStatus } from "../lib/status";
import type { UiDocument } from "../types/documents";

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

function RailCard({ doc }: { doc: UiDocument }) {
  const stageLabel = STAGE_LABELS[doc.status] ?? doc.status;

  return (
    <div className="rail-card" data-testid="rail-card">
      <div className="rail-card__title">{doc.title}</div>
      <div className="rail-card__stage">{stageLabel}</div>
      <MiniStepper currentStage={doc.status} />
      <ModalityAnimation doc={doc} />
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

  if (processingDocs.length === 0) {
    return null;
  }

  return (
    <div
      className="processing-rail"
      role="region"
      aria-label="Aktiva jobb"
    >
      {processingDocs.map((doc) => (
        <RailCard key={doc.id} doc={doc} />
      ))}
    </div>
  );
}
