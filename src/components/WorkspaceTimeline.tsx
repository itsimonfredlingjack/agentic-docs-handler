import { useEffect, useState } from "react";
import { fetchWorkspaceTimeline } from "../lib/api";
import type { TimelineEvent } from "../lib/api";

function eventIcon(type: string): string {
  switch (type) {
    case "document_added":
      return "+";
    case "documents_moved_in":
      return "→";
    case "brief_updated":
      return "✦";
    case "workspace_created":
      return "◉";
    case "document_removed":
      return "−";
    default:
      return "·";
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just nu";
  if (minutes < 60) return `${minutes}m sedan`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h sedan`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "igår";
  if (days < 7) return `${days}d sedan`;
  return new Date(iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}

type Props = {
  workspaceId: string;
};

export function WorkspaceTimeline({ workspaceId }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchWorkspaceTimeline(workspaceId, 5)
      .then((data) => {
        if (!cancelled) {
          setEvents(data.events);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [workspaceId]);

  if (loading || events.length === 0) return null;

  return (
    <div className="px-6 pb-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)]">
          Aktivitet
        </span>
        <span className="flex-1 h-px bg-[var(--surface-4)]" />
      </div>
      <div className="space-y-0.5">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-start gap-2 text-xs-ui leading-relaxed"
          >
            <span className="shrink-0 w-4 text-center text-[var(--text-muted)] font-mono">
              {eventIcon(event.event_type)}
            </span>
            <span className="flex-1 text-[var(--text-secondary)] truncate" title={event.detail || undefined}>
              {event.title}
            </span>
            <span className="shrink-0 text-[var(--text-disabled)] tabular-nums">
              {relativeTime(event.created_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
