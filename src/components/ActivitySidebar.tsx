import { useDocumentStore } from "../store/documentStore";
import type { ActivityEvent } from "../types/documents";

function dotColor(type: string): string {
  if (type.includes("classified") || type.includes("completed")) return "var(--receipt-color)";
  if (type.includes("transcrib")) return "var(--audio-color)";
  if (type.includes("moved")) return "var(--contract-color)";
  if (type.includes("failed") || type.includes("error")) return "var(--invoice-color)";
  return "var(--accent-primary)";
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="status-dot mt-1 shrink-0" style={{ backgroundColor: dotColor(event.type), width: 6, height: 6 }} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-[var(--text-primary)] truncate">{event.title}</p>
        <p className="font-mono text-[10px] text-[var(--text-muted)]">{time}</p>
      </div>
    </div>
  );
}

export function ActivitySidebar() {
  const activity = useDocumentStore((state) => state.activity);

  if (activity.length === 0) return null;

  return (
    <aside className="glass-panel hidden xl:flex w-[200px] shrink-0 flex-col p-3 min-h-[calc(100vh-2rem)] overflow-y-auto">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Activity</p>
      <div className="flex flex-col">
        {activity.slice(0, 20).map((event) => (
          <ActivityRow key={event.id} event={event} />
        ))}
      </div>
    </aside>
  );
}
