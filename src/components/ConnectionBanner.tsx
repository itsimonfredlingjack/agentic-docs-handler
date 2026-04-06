import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { t } from "../lib/locale";

function statusLabel(connectionState: string, backendStatus: string): string {
  if (backendStatus === "offline") return t("connection.offline");
  if (connectionState === "reconnecting") return t("connection.reconnecting");
  if (connectionState === "connected") return t("connection.connected");
  if (connectionState === "disconnected") return t("connection.disconnected");
  return t("connection.connecting");
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
