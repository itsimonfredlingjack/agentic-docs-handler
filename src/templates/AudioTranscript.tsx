import type { UiDocument } from "../types/documents";

export function AudioTranscript({ document }: { document: UiDocument }) {
  const unavailable = document.errorCode === "audio_processing_unavailable";
  const lang = document.transcription?.language ?? "sv";
  const dur = document.transcription?.duration?.toFixed(1) ?? "0.0";
  const model = document.transcription?.model ?? "large-v3-turbo";

  return (
    <article className="glass-panel glass-panel-hover flex h-full flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Audio</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)] line-clamp-2">{document.title}</h3>
        </div>
        <span className="glass-badge shrink-0 text-[var(--audio-color)]" style={{ borderColor: "rgba(48,176,199,0.22)", backgroundColor: "rgba(48,176,199,0.10)" }}>
          <span className="status-dot bg-[var(--audio-color)]" />
          audio
        </span>
      </div>
      <p className="text-sm leading-6 text-[var(--text-secondary)] line-clamp-3">
        {unavailable ? "Audio processing unavailable" : document.transcription?.text ?? document.summary}
      </p>
      <p className="font-mono text-xs text-[var(--text-muted)]">{lang} · {dur}s · {model}</p>
    </article>
  );
}
