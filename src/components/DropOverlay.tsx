import { createPortal } from "react-dom";

export function DropOverlay({
  visible,
  onDrop,
  onDragOver,
  onDragLeave,
}: {
  visible: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
}) {
  if (!visible) return null;

  return createPortal(
    <div
      className="drop-overlay"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="drop-overlay-content">
        <div className="drop-overlay-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <path d="M24 8v32M8 24h32" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <p className="mt-4 text-lg font-semibold text-[var(--accent-primary)]">Drop files to process</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">PDF, DOCX, images, and audio</p>
      </div>
    </div>,
    document.body,
  );
}
