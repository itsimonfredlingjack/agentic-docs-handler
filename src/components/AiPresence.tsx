import { memo, type CSSProperties } from "react";

import { kindColor, kindRgbVar } from "../lib/document-colors";
import type { ConnectionState, UiDocument, UiDocumentKind } from "../types/documents";

export type AiPresenceMode =
  | "idle"
  | "hover"
  | "ready"
  | "processing"
  | "answering"
  | "success"
  | "warning"
  | "offline";

type Props = {
  mode: AiPresenceMode;
  accentKind: UiDocumentKind | null;
  processingStage: UiDocument["status"] | null;
  connectionState: ConnectionState;
};

const TICK_ANGLES = [-140, -104, -68, -32, 32, 68, 104, 140];
const PIPELINE_NODE_ANGLES = [212, 236, 260, 284, 308];
const PROCESSING_STEP_ORDER = [
  "queued",
  "uploading",
  "processing",
  "transcribing",
  "classifying",
  "classified",
  "extracting",
  "extracted",
  "organizing",
  "indexing",
] as const;

function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = (angle - 90) * (Math.PI / 180);
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function arcPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polar(cx, cy, radius, endAngle);
  const end = polar(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function processingStepCount(stage: UiDocument["status"] | null): number {
  if (!stage) return 0;
  if (
    stage === "ready"
    || stage === "awaiting_confirmation"
    || stage === "moved"
    || stage === "failed"
    || stage === "completed"
  ) {
    return 0;
  }
  const idx = PROCESSING_STEP_ORDER.indexOf(stage);
  if (idx <= 1) return 1;
  if (idx <= 4) return 2;
  if (idx <= 7) return 3;
  if (idx === 8) return 4;
  return 5;
}

export const AiPresence = memo(function AiPresence({ mode, accentKind, processingStage, connectionState }: Props) {
  const accent = accentKind ? kindColor(accentKind) : "var(--accent-primary)";
  const accentRgb = accentKind ? `var(${kindRgbVar(accentKind)})` : "88, 86, 214";
  const activeSteps = processingStepCount(processingStage);

  const style = {
    "--presence-accent": accent,
    "--presence-accent-rgb": accentRgb,
  } as CSSProperties;

  return (
    <div
      aria-hidden="true"
      className={`ai-presence ai-presence--${mode}`}
      data-testid="ai-presence"
      data-state={mode}
      data-processing-stage={processingStage ?? ""}
      data-accent-kind={accentKind ?? ""}
      data-connection={connectionState}
      style={style}
    >
      <div className="ai-presence__halo" />
      <svg
        className="ai-presence__svg"
        viewBox="0 0 112 112"
        fill="none"
        role="presentation"
      >
        <circle className="ai-presence__backplate" cx="56" cy="56" r="26" />
        <circle className="ai-presence__outer-ring" cx="56" cy="56" r="48" />
        <circle className="ai-presence__registry-ring" cx="56" cy="56" r="37" />

        <path className="ai-presence__trace" d={arcPath(56, 56, 48, 18, 50)} />
        <path className="ai-presence__retrieval-trace ai-presence__retrieval-trace--a" d={arcPath(56, 56, 37, 122, 154)} />
        <path className="ai-presence__retrieval-trace ai-presence__retrieval-trace--b" d={arcPath(56, 56, 37, 206, 240)} />

        {TICK_ANGLES.map((angle) => {
          const outer = polar(56, 56, 43, angle);
          const inner = polar(56, 56, 39, angle);
          return (
            <line
              key={angle}
              className="ai-presence__tick"
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
            />
          );
        })}

        <rect className="ai-presence__lock ai-presence__lock--top" x="52.5" y="15" width="7" height="4" rx="2" />
        <rect className="ai-presence__lock ai-presence__lock--bottom" x="52.5" y="93" width="7" height="4" rx="2" />

        {PIPELINE_NODE_ANGLES.map((angle, index) => {
          const point = polar(56, 56, 41.5, angle);
          const isActive = index < activeSteps;
          return (
            <circle
              key={angle}
              className={`ai-presence__pipeline-node${isActive ? " is-active" : ""}`}
              cx={point.x}
              cy={point.y}
              r="1.85"
            />
          );
        })}

        <g className="ai-presence__core">
          <circle className="ai-presence__core-shell" cx="56" cy="56" r="22" />
          <path className="ai-presence__blade" d="M56 56 L56 31 C64 31 71 35 74 42 C75.5 46 74.5 50.5 71 53 C66.5 54.5 61.5 55.5 56 56 Z" />
          <path className="ai-presence__blade" d="M56 56 L81 56 C81 64 77 71 70 74 C66 75.5 61.5 74.5 59 71 C57.5 66.5 56.5 61.5 56 56 Z" />
          <path className="ai-presence__blade" d="M56 56 L56 81 C48 81 41 77 38 70 C36.5 66 37.5 61.5 41 59 C45.5 57.5 50.5 56.5 56 56 Z" />
          <path className="ai-presence__blade" d="M56 56 L31 56 C31 48 35 41 42 38 C46 36.5 50.5 37.5 53 41 C54.5 45.5 55.5 50.5 56 56 Z" />
          <circle className="ai-presence__void" cx="56" cy="56" r="6.5" />
        </g>

        <circle className="ai-presence__accent-pin" cx="82.5" cy="33.5" r="2.5" />
        <path className="ai-presence__fault-seam" d={arcPath(56, 56, 48, 322, 344)} />
      </svg>
    </div>
  );
});
