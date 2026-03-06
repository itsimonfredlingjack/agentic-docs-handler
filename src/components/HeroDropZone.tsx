export function HeroDropZone({
  onDrop,
  onBrowse,
}: {
  onDrop: (e: React.DragEvent) => void;
  onBrowse: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div
        className="hero-drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <div className="hero-drop-icon">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <rect x="8" y="14" width="40" height="32" rx="4" stroke="currentColor" strokeWidth="2" />
            <path d="M28 22v16M20 30l8-8 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mt-6 text-2xl font-bold text-[var(--text-primary)]">Drop files here</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          AI will classify, extract fields, and organize your documents automatically.
        </p>
        <p className="mt-3 font-mono text-xs text-[var(--text-muted)]">.pdf  .docx  .jpg  .png  .wav  .mp3</p>
        <button
          type="button"
          className="focus-ring mt-6 rounded-2xl bg-[var(--accent-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          onClick={onBrowse}
        >
          Browse files
        </button>
      </div>
    </div>
  );
}
