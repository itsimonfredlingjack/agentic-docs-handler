import type { UiDocument } from "../types/documents";

export function RequestIdMeta({ document }: { document: Pick<UiDocument, "requestId"> }) {
  return (
    <div className="mt-auto rounded-xl bg-white/35 px-2.5 py-1.5 font-mono text-[10px] text-[var(--text-muted)]">
      request_id: {document.requestId}
    </div>
  );
}
