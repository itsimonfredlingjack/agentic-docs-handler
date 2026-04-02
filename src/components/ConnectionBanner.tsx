import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";

function statusLabel(connectionState: string, backendStatus: string): string {
  if (backendStatus === "offline") return "Backend offline";
  if (connectionState === "reconnecting") return "Återansluter…";
  if (connectionState === "connected") return "Ansluten";
  if (connectionState === "disconnected") return "Frånkopplad";
  return "Ansluter…";
}

export function ConnectionBanner() {
  const connectionState = useDocumentStore((s) => s.connectionState);
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);

  const isHealthy = backendStatus === "online" && connectionState === "connected";
  if (isHealthy) {
    return null;
  }

  return (
    <div className="border-b border-[var(--surface-8)] bg-[var(--surface-4)] px-4 py-2">
      <p className="text-xs-ui font-medium text-[var(--text-secondary)]">
        {statusLabel(connectionState, backendStatus)}
      </p>
    </div>
  );
}
