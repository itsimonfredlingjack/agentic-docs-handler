import { PipelineStepper } from "./PipelineStepper";
import { ReceiptCard } from "../templates/ReceiptCard";
import { ContractCard } from "../templates/ContractCard";
import { AudioTranscript } from "../templates/AudioTranscript";
import { GenericDocument } from "../templates/GenericDocument";
import { FileMovedCard } from "../templates/FileMovedCard";
import type { StageEntry } from "../store/documentStore";
import type { UiDocument } from "../types/documents";

type Props = {
  document: UiDocument;
  history: StageEntry[];
  onSelect?: () => void;
  onRetry?: () => void;
};

const TERMINAL_STAGES = new Set(["completed", "ready", "moved", "failed"]);
const PROCESSING_STAGES = new Set([
  "uploading", "processing", "transcribing", "classifying",
  "classified", "extracting", "organizing", "indexing",
]);

function CompactSummary({ document, history }: { document: UiDocument; history: StageEntry[] }) {
  const dest = document.moveResult?.to_path;
  // Duration is already shown by PipelineStepper for completed stages;
  // only show it here when the stepper did NOT render it (i.e. non-completed terminal states).
  const isCompleted =
    document.status === "completed" || document.status === "moved" || document.status === "ready";
  let durationLabel: string | null = null;
  if (!isCompleted && history.length >= 2) {
    const ms = history[history.length - 1].at - history[0].at;
    durationLabel = ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
  }

  if (!dest && !durationLabel) return null;

  return (
    <div className="feed-card__summary">
      {dest && (
        <span className="feed-card__destination" title={dest}>
          → {dest.split("/").slice(-3).join("/")}
        </span>
      )}
      {durationLabel && (
        <span className="pipeline-stepper__duration">{durationLabel}</span>
      )}
    </div>
  );
}

function TemplateCard({ document }: { document: UiDocument }) {
  switch (document.kind) {
    case "receipt":
      return <ReceiptCard document={document} variant="receipt" />;
    case "invoice":
      return <ReceiptCard document={document} variant="invoice" />;
    case "contract":
      return <ContractCard document={document} />;
    case "audio":
    case "meeting_notes":
      return <AudioTranscript document={document} />;
    default:
      if (document.moveStatus === "moved" && document.moveResult?.success) {
        return <FileMovedCard document={document} />;
      }
      return <GenericDocument document={document} />;
  }
}

export function FeedCard({ document, history, onSelect, onRetry }: Props) {
  const isProcessing = PROCESSING_STAGES.has(document.status);
  const isFailed = document.status === "failed";
  const isTerminal = TERMINAL_STAGES.has(document.status);
  const showStepper = isProcessing || isFailed;

  return (
    <div
      className={`feed-card ${isProcessing ? "feed-card--processing" : ""} ${isFailed ? "feed-card--failed" : ""}`}
      onClick={isTerminal ? onSelect : undefined}
      role={isTerminal ? "button" : undefined}
      tabIndex={isTerminal ? 0 : undefined}
    >
      {/* Title bar */}
      <div className="feed-card__header">
        <span className="feed-card__title">{document.title}</span>
        {isTerminal && document.kind !== "generic" && (
          <span
            className="glass-badge"
            style={{
              background: `color-mix(in srgb, var(--${document.kind === "invoice" ? "invoice" : document.kind}-color, var(--text-muted)) 12%, transparent)`,
            }}
          >
            {document.documentType}
          </span>
        )}
      </div>

      {/* Pipeline stepper for active processing */}
      {(showStepper || isTerminal) && (
        <PipelineStepper
          currentStage={document.status}
          history={history}
          failed={isFailed}
        />
      )}

      {/* Template card content for completed documents */}
      {isTerminal && !isFailed && <TemplateCard document={document} />}

      {/* Compact summary for completed + moved documents */}
      {isTerminal && !isFailed && (document.moveResult?.to_path || history.length >= 2) && (
        <CompactSummary document={document} history={history} />
      )}

      {/* Failure state */}
      {isFailed && (
        <div className="feed-card__error">
          <p className="feed-card__error-msg">
            {document.errorCode ?? "Behandlingen misslyckades"}
          </p>
          {document.retryable && (
            <button className="action-secondary" onClick={(e) => { e.stopPropagation(); onRetry?.(); }}>
              Försök igen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
