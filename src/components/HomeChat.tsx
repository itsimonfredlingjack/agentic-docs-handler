import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceChat } from "../hooks/useWorkspaceChat";
import { NotebookEntry } from "./NotebookEntry";
import { NotebookInput } from "./NotebookInput";
import { kindColor } from "../lib/document-colors";
import type { UiDocument, UiDocumentKind } from "../types/documents";

const MAX_CARDS = 6;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just nu";
  if (mins < 60) return `${mins} min sedan`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} tim sedan`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "igår";
  return `${days} dagar sedan`;
}

function DocumentCard({ doc, onClick }: { doc: UiDocument; onClick: () => void }) {
  const color = kindColor(doc.kind);
  return (
    <button
      type="button"
      className="home-doc-card hover-lift"
      onClick={onClick}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="home-doc-card__title">{doc.title}</span>
      </div>
      <span className="home-doc-card__time">{timeAgo(doc.updatedAt ?? doc.createdAt)}</span>
    </button>
  );
}

function DocumentPreview({ doc, onClose }: { doc: UiDocument; onClose: () => void }) {
  const color = kindColor(doc.kind);
  const fields = doc.extraction?.fields ?? {};
  const fieldEntries = Object.entries(fields).filter(
    ([, v]) => v !== null && typeof v !== "undefined" && v !== "",
  );

  return (
    <>
      <div className="category-preview__backdrop" onClick={onClose} />
      <div className="category-preview">
        <div className="category-preview__header">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
            <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{doc.title}</h3>
          </div>
          <button className="category-preview__close" onClick={onClose} aria-label="Stäng">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="category-preview__list">
          {doc.summary && (
            <div className="category-preview__item">
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">Sammanfattning</p>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{doc.summary}</p>
            </div>
          )}
          {fieldEntries.length > 0 && (
            <div className="category-preview__item">
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2">Extraherade fält</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {fieldEntries.map(([key, value]) => (
                  <div key={key}>
                    <span className="text-[11px] text-[var(--text-muted)]">{key.replace(/_/g, " ")}</span>
                    <p className="text-sm text-[var(--text-primary)]">{String(value)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!doc.summary && fieldEntries.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] py-4 text-center">Ingen detaljinfo tillgänglig</p>
          )}
        </div>
      </div>
    </>
  );
}

export function HomeChat() {
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);
  const { conversation, isStreaming, sendMessage } = useWorkspaceChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.streamingText, conversation?.entries.length]);

  const handleSubmit = useCallback(
    (message: string) => {
      void sendMessage(message);
    },
    [sendMessage],
  );

  const recentDocs = useMemo(
    () => documentOrder
      .map((id) => documents[id])
      .filter((doc) => doc && doc.status !== "failed" && doc.status !== "uploading")
      .slice(0, MAX_CARDS),
    [documents, documentOrder],
  );

  const previewDoc = previewDocId ? documents[previewDocId] : null;

  const handleNewChat = useCallback(() => {
    useDocumentStore.setState((state) => {
      const next = { ...state.conversations };
      delete next["all"];
      return { conversations: next };
    });
  }, []);

  const hasEntries = conversation && conversation.entries.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col relative">
      {/* Header with new chat button */}
      {hasEntries && (
        <div className="flex items-center justify-start pb-2">
          <button
            type="button"
            className="focus-ring action-secondary px-2.5 py-1 text-xs"
            onClick={handleNewChat}
          >
            Ny chatt
          </button>
        </div>
      )}

      {/* Chat messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-4">
        {hasEntries ? (
          conversation.entries.map((entry, index) => {
            const isLast = index === conversation.entries.length - 1;
            return (
              <NotebookEntry
                key={entry.id}
                query={entry.query}
                response={entry.response}
                sourceCount={entry.sourceCount}
                errorMessage={entry.errorMessage}
                isStreaming={isLast && isStreaming}
                streamingText={isLast && isStreaming ? conversation.streamingText : undefined}
              />
            );
          })
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
            <div className="ai-orb">
              <div className="ai-orb__halo" />
              <div className="ai-orb__glass">
                <div className="ai-orb__inner" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-[var(--text-primary)]">
                Fråga dina dokument vad som helst
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)] max-w-[320px]">
                AI:n söker igenom alla dina filer och ger dig svar
              </p>
            </div>
            {recentDocs.length > 0 && (
              <div className="home-docs-list">
                <p className="text-xs text-[var(--text-muted)] mb-2">Dina senaste filer</p>
                {recentDocs.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    onClick={() => setPreviewDocId(doc.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 pt-2">
        <NotebookInput
          placeholder="Ställ en fråga..."
          disabled={isStreaming}
          onSubmit={handleSubmit}
        />
      </div>

      {/* Document preview overlay */}
      {previewDoc && (
        <DocumentPreview
          doc={previewDoc}
          onClose={() => setPreviewDocId(null)}
        />
      )}
    </div>
  );
}
