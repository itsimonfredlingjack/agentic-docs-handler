import { kindColor, kindRgbVar } from "../lib/document-colors";
import type { WorkspaceCategory, UiDocumentKind } from "../types/documents";

type Props = {
  category: WorkspaceCategory;
  onClick: () => void;
};

const KIND_ICONS: Record<string, string> = {
  receipt: "\uD83E\uDDFE",
  contract: "\uD83D\uDCD1",
  invoice: "\uD83D\uDCC4",
  meeting_notes: "\uD83D\uDCCB",
  audio: "\uD83C\uDF99",
  generic: "\uD83D\uDCC1",
};

export function WorkspaceCard({ category, onClick }: Props) {
  const kind = category.category as UiDocumentKind;
  const rgbVar = kindRgbVar(kind);

  return (
    <button
      className="workspace-card glass-panel hover-lift"
      style={{ "--type-color-rgb": `var(${rgbVar})` } as React.CSSProperties}
      onClick={onClick}
    >
      <div className="workspace-card__icon">
        {KIND_ICONS[category.category] ?? "\uD83D\uDCC1"}
      </div>
      <div className="workspace-card__info">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">
          {category.label}
        </h3>
        <p className="font-mono text-xs text-[var(--text-muted)]">
          {category.count} dokument
        </p>
      </div>
      <div
        className="workspace-card__accent"
        style={{ background: kindColor(kind) }}
      />
    </button>
  );
}
