import type { UiDocument } from "../types/documents";
import { RequestIdMeta } from "../components/RequestIdMeta";

export function AudioTranscript({ document }: { document: UiDocument }) {
  const unavailable = document.errorCode === "audio_processing_unavailable";

  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Audio</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{document.title}</h3>
        </div>
        <span className="glass-badge text-[var(--audio-color)]" style={{ borderColor: "rgba(48,176,199,0.22)", backgroundColor: "rgba(48,176,199,0.10)" }}>
          <span className="status-dot bg-[var(--audio-color)]" />
          audio
        </span>
      </div>

      <div className="flex flex-wrap gap-2 text-xs font-mono text-[var(--text-secondary)]">
        <span>{document.transcription?.language ?? "sv"}</span>
        <span>·</span>
        <span>{document.transcription?.duration?.toFixed(1) ?? "0.0"}s</span>
        <span>·</span>
        <span>{document.transcription?.model ?? "large-v3-turbo"}</span>
      </div>

      <p className="text-sm leading-6 text-[var(--text-secondary)]">
        {unavailable ? "Audio processing unavailable" : document.transcription?.text ?? document.summary}
      </p>

      <div className="space-y-2">
        {(document.transcription?.segments ?? []).slice(0, 5).map((segment) => (
          <div key={`${segment.start}-${segment.end}`} className="rounded-2xl bg-white/45 p-3">
            <div className="font-mono text-[11px] text-[var(--text-muted)]">
              {segment.start.toFixed(1)}s → {segment.end.toFixed(1)}s
            </div>
            <p className="mt-1 text-sm text-[var(--text-primary)]">{segment.text}</p>
          </div>
        ))}
      </div>
      <RequestIdMeta document={document} />
    </article>
  );
}
