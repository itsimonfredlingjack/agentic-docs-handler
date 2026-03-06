import { useMemo, useState } from "react";

import { kindAccent } from "../lib/kind-utils";
import { relativeTime } from "../lib/time";
import { useDocumentStore } from "../store/documentStore";
import type { ActivityEvent } from "../types/documents";

type EventFilter = "all" | "processed" | "moved" | "failed";

const EVENT_META: Record<string, { icon: string; color: string }> = {
  processed: { icon: "check", color: "var(--receipt-color)" },
  file_moved: { icon: "move", color: "var(--accent-primary)" },
  file_move_undone: { icon: "undo", color: "var(--meeting-color)" },
};

function eventColor(event: ActivityEvent): string {
  if (event.status === "failed") return "var(--invoice-color)";
  return EVENT_META[event.type]?.color ?? "var(--text-muted)";
}

function matchesFilter(event: ActivityEvent, filter: EventFilter): boolean {
  if (filter === "all") return true;
  if (filter === "processed") return event.type === "processed" && event.status !== "failed";
  if (filter === "moved") return event.type === "file_moved" || event.type === "file_move_undone";
  if (filter === "failed") return event.status === "failed";
  return true;
}

function EventIcon({ event }: { event: ActivityEvent }) {
  const color = eventColor(event);
  if (event.status === "failed") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color }}>
        <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (event.type === "file_moved") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color }}>
        <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (event.type === "file_move_undone") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color }}>
        <path d="M4 5l-2 2 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 7h7a3 3 0 010 6H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  // Default: check
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color }}>
      <path d="M3 7.5l2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const FILTER_OPTIONS: { value: EventFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "processed", label: "Processed" },
  { value: "moved", label: "Moved" },
  { value: "failed", label: "Failed" },
];

export function ActivityFeed({ onClose }: { onClose: () => void }) {
  const activity = useDocumentStore((s) => s.activity);
  const [filter, setFilter] = useState<EventFilter>("all");

  const filtered = useMemo(
    () => activity.filter((event) => matchesFilter(event, filter)),
    [activity, filter],
  );

  return (
    <div className="activity-feed">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Activity</h2>
        <button
          type="button"
          className="focus-ring rounded-lg p-1 text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
          onClick={onClose}
          aria-label="Close activity feed"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1.5 px-4 pb-3">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`focus-ring rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
              filter === opt.value
                ? "bg-[var(--accent-primary)] text-white"
                : "bg-[var(--btn-bg)] text-[var(--text-muted)] hover:bg-[var(--btn-bg-hover)]"
            }`}
            onClick={() => setFilter(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">No activity yet.</p>
        ) : (
          <div className="flex flex-col">
            {filtered.map((event) => (
              <div key={event.id} className="activity-event">
                <div className="flex shrink-0 items-center justify-center" style={{ width: 20 }}>
                  <EventIcon event={event} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                    {event.title}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2">
                    {event.kind && (
                      <span
                        className="text-[10px] font-semibold uppercase"
                        style={{ color: kindAccent(event.kind as never) }}
                      >
                        {event.kind.replace("_", " ")}
                      </span>
                    )}
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {relativeTime(event.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
