import { useCallback, useEffect, useRef, useState } from "react";

import { useDocumentStore } from "../store/documentStore";
import { useFilteredDocuments } from "../hooks/useFilteredDocuments";
import { DetailPane } from "./DetailPane";
import { ListFilterBar } from "./ListFilterBar";

const SWIPE_THRESHOLD = 100;

export function TinderView() {
  const { filteredIds } = useFilteredDocuments();
  const selectedDocumentId = useDocumentStore((s) => s.selectedDocumentId);
  const setSelectedDocument = useDocumentStore((s) => s.setSelectedDocument);
  const [direction, setDirection] = useState<"left" | "right">("left");

  // Swipe state
  const [dragX, setDragX] = useState(0);
  const dragging = useRef(false);
  const startX = useRef(0);

  const currentIndex = selectedDocumentId ? filteredIds.indexOf(selectedDocumentId) : -1;
  const total = filteredIds.length;

  // Auto-select first if nothing selected or selection filtered out
  useEffect(() => {
    const inList = selectedDocumentId != null && filteredIds.includes(selectedDocumentId);
    if (!inList && filteredIds[0]) {
      setSelectedDocument(filteredIds[0]);
    }
  }, [selectedDocumentId, filteredIds, setSelectedDocument]);

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= total) return;
      setDirection(index > currentIndex ? "left" : "right");
      setSelectedDocument(filteredIds[index]);
    },
    [currentIndex, total, filteredIds, setSelectedDocument],
  );

  const prev = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex]);
  const next = useCallback(() => goTo(currentIndex + 1), [goTo, currentIndex]);

  // Arrow key navigation (skip when focused on inputs)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next]);

  // Swipe handlers
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only handle primary pointer on the card area, not on buttons/inputs
    if (e.button !== 0) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "BUTTON" || tag === "INPUT" || tag === "A") return;
    dragging.current = true;
    startX.current = e.clientX;
    setDragX(0);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    setDragX(e.clientX - startX.current);
  }, []);

  const onPointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragX > SWIPE_THRESHOLD && currentIndex < total - 1) {
      next();
    } else if (dragX < -SWIPE_THRESHOLD && currentIndex > 0) {
      prev();
    }
    setDragX(0);
  }, [dragX, currentIndex, total, next, prev]);

  if (total === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--text-muted)]">
        No documents match this filter.
      </div>
    );
  }

  const swipeProgress = Math.min(Math.abs(dragX) / SWIPE_THRESHOLD, 1);
  const swipeHint = dragX > 30 ? "next" : dragX < -30 ? "prev" : null;

  return (
    <div className="tinder-view">
      {/* Filter bar + navigation controls */}
      <div className="flex items-center border-b border-[var(--border-subtle)]">
        <div className="min-w-0 flex-1">
          <ListFilterBar />
        </div>
        <div className="flex shrink-0 items-center gap-2 pr-3">
          <button
            type="button"
            className="focus-ring rounded-lg p-1 text-[var(--text-muted)] transition hover:text-[var(--text-primary)] disabled:opacity-30"
            onClick={prev}
            disabled={currentIndex <= 0}
            aria-label="Previous document"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
            {currentIndex + 1}/{total}
          </span>
          <button
            type="button"
            className="focus-ring rounded-lg p-1 text-[var(--text-muted)] transition hover:text-[var(--text-primary)] disabled:opacity-30"
            onClick={next}
            disabled={currentIndex >= total - 1}
            aria-label="Next document"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Full-width card with swipe */}
      <div
        className="tinder-card-container"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: "pan-y" }}
      >
        <div
          key={selectedDocumentId}
          className={`tinder-card ${dragX === 0 ? `tinder-slide-${direction}` : ""}`}
          style={
            dragX !== 0
              ? {
                  transform: `translateX(${dragX}px) rotate(${dragX * 0.03}deg)`,
                  transition: "none",
                }
              : undefined
          }
        >
          {/* Swipe hint overlays */}
          {swipeHint === "next" && (
            <div
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-end rounded-2xl pr-6"
              style={{ opacity: swipeProgress * 0.6 }}
            >
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-[var(--accent-primary)]">
                <path d="M12 6l10 10-10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
          {swipeHint === "prev" && (
            <div
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-start rounded-2xl pl-6"
              style={{ opacity: swipeProgress * 0.6 }}
            >
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-[var(--accent-primary)]">
                <path d="M20 6L10 16l10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
          <DetailPane />
        </div>
      </div>

      {/* Dot indicators (up to 12 docs) */}
      {total > 1 && total <= 12 && (
        <div className="flex items-center justify-center gap-1.5 pb-3 pt-1">
          {filteredIds.map((id, i) => (
            <button
              key={id}
              type="button"
              className={`tinder-dot ${i === currentIndex ? "is-active" : ""}`}
              onClick={() => goTo(i)}
              aria-label={`Go to document ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
