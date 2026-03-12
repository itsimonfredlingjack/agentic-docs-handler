import type { StageEntry } from "../store/documentStore";

const PIPELINE_STAGES = [
  { key: "uploading", label: "Ladda upp" },
  { key: "classifying", label: "Klassificera" },
  { key: "extracting", label: "Extrahera" },
  { key: "organizing", label: "Organisera" },
  { key: "indexing", label: "Indexera" },
] as const;

const ACTIVE_STAGE_MAP: Record<string, string> = {
  processing: "classifying",
  transcribing: "classifying",
  classified: "extracting",
  awaiting_confirmation: "organizing",
  moved: "completed",
};

type Props = {
  currentStage: string;
  history: StageEntry[];
  failed?: boolean;
};

function resolveStage(raw: string): string {
  return ACTIVE_STAGE_MAP[raw] ?? raw;
}

function stageIndex(stage: string): number {
  const resolved = resolveStage(stage);
  const idx = PIPELINE_STAGES.findIndex((s) => s.key === resolved);
  return idx === -1 ? PIPELINE_STAGES.length : idx;
}

export function PipelineStepper({ currentStage, history, failed }: Props) {
  const resolved = resolveStage(currentStage);

  const isPipelineActive =
    resolved === "completed" ||
    resolved === "failed" ||
    PIPELINE_STAGES.some((s) => s.key === resolved);
  if (!isPipelineActive && currentStage === "ready") return null;

  const activeIdx = stageIndex(currentStage);
  const isCompleted = resolved === "completed" || resolved === "moved";

  let durationLabel: string | null = null;
  if (isCompleted && history.length >= 2) {
    const ms = history[history.length - 1].at - history[0].at;
    durationLabel = ms >= 60_000
      ? `${(ms / 60_000).toFixed(1)}m`
      : `${(ms / 1000).toFixed(1)}s`;
  }

  return (
    <div className="pipeline-stepper" role="group" aria-label="Pipeline progress">
      <div className="pipeline-stepper__track">
        {PIPELINE_STAGES.map((stage, i) => {
          let state: "completed" | "active" | "failed" | "pending";
          if (isCompleted || i < activeIdx) {
            state = "completed";
          } else if (i === activeIdx) {
            state = failed ? "failed" : "active";
          } else {
            state = "pending";
          }

          return (
            <div
              key={stage.key}
              className="pipeline-stepper__step"
              data-testid="pipeline-step"
              data-state={state}
            >
              <div className="pipeline-stepper__dot" />
              {i < PIPELINE_STAGES.length - 1 && (
                <div className="pipeline-stepper__connector" />
              )}
              <span className="pipeline-stepper__label">{stage.label}</span>
            </div>
          );
        })}
      </div>
      {durationLabel && (
        <span className="pipeline-stepper__duration">{durationLabel}</span>
      )}
    </div>
  );
}
