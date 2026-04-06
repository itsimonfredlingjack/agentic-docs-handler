import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";

import {
  fetchDocument,
  fetchWorkspaceFiles,
  moveFilesToWorkspace,
  searchDocuments,
} from "../lib/api";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useToastStore } from "../store/toastStore";
import { t } from "../lib/locale";
import type { SearchResult } from "../types/documents";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Mode = "navigate" | "create" | "move";

const WORKSPACE_COUNTS = {
  processing: 0,
  receipt: 0,
  contract: 0,
  invoice: 0,
  meeting_notes: 0,
  report: 0,
  letter: 0,
  tax_document: 0,
  audio: 0,
  generic: 0,
  moved: 0,
};

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [mode, setMode] = useState<Mode>("navigate");
  const [query, setQuery] = useState("");
  const [createName, setCreateName] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [moveTarget, setMoveTarget] = useState<SearchResult | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const showToast = useToastStore((s) => s.show);
  const documents = useDocumentStore((s) => s.documents);
  const documentOrder = useDocumentStore((s) => s.documentOrder);
  const setSelectedDocument = useDocumentStore((s) => s.setSelectedDocument);
  const upsertDocument = useDocumentStore((s) => s.upsertDocument);
  const bootstrap = useDocumentStore((s) => s.bootstrap);

  const activeDocuments = activeWorkspaceId
    ? documentOrder.map((id) => documents[id]).filter(Boolean)
    : [];

  useEffect(() => {
    if (mode === "create") {
      createInputRef.current?.focus();
    }
  }, [mode]);

  useEffect(() => {
    if (!open) {
      setMode("navigate");
      setQuery("");
      setCreateName("");
      setSearchResults([]);
      setSearchStatus("idle");
      setMoveTarget(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "navigate") {
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchStatus("idle");
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setSearchStatus("loading");
      try {
        const response = await searchDocuments(trimmed, 8, "fast", undefined);
        if (cancelled) {
          return;
        }
        setSearchResults(response.results);
        setSearchStatus("ready");
      } catch {
        if (cancelled) {
          return;
        }
        setSearchResults([]);
        setSearchStatus("error");
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [mode, open, query]);

  if (!open) return null;

  const handleSelectWorkspace = (id: string) => {
    setActiveWorkspace(id);
    onOpenChange(false);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = createName.trim();
    if (!name) return;
    await createWorkspace(name);
    showToast(t("cmd.workspace_created").replace("{name}", name), "info");
    onOpenChange(false);
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setMode("navigate");
      setCreateName("");
    }
  };

  const handleSelectDocument = (id: string) => {
    setSelectedDocument(id);
    onOpenChange(false);
  };

  const handleOpenSearchResult = async (result: SearchResult) => {
    const document = await fetchDocument(result.doc_id);
    upsertDocument(document);
    if (document.workspaceId) {
      setActiveWorkspace(document.workspaceId);
    }
    setSelectedDocument(document.id);
    onOpenChange(false);
  };

  const handleMoveResultToWorkspace = async (workspaceId: string) => {
    if (!moveTarget) return;
    await moveFilesToWorkspace(workspaceId, [moveTarget.doc_id]);
    await fetchWorkspaces();
    if (activeWorkspaceId) {
      const payload = await fetchWorkspaceFiles(activeWorkspaceId, 50);
      bootstrap(
        payload.documents,
        { all: payload.total, ...WORKSPACE_COUNTS },
        [],
      );
    }
    onOpenChange(false);
  };

  return (
    <div className="command-palette__backdrop" onClick={() => onOpenChange(false)}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        {mode === "navigate" ? (
          <Command label="Command palette">
            <Command.Input
              className="command-palette__input"
              placeholder={t("cmd.search_placeholder")}
              autoFocus
              value={query}
              onValueChange={setQuery}
            />
            <Command.List className="command-palette__list">
              <Command.Empty className="command-palette__empty">{t("cmd.no_results")}</Command.Empty>
              {searchResults.length > 0 ? (
                <Command.Group heading={t("cmd.search_results")}>
                  {searchResults.map((result) => {
                    const workspaceId = typeof result.metadata.workspace_id === "string"
                      ? result.metadata.workspace_id
                      : null;
                    const workspaceName = typeof result.metadata.workspace_name === "string"
                      ? result.metadata.workspace_name
                      : "";
                    return (
                      <div key={result.doc_id}>
                        <Command.Item
                          className="command-palette__item"
                          onSelect={() => void handleOpenSearchResult(result)}
                          value={`open ${result.title} ${result.snippet}`}
                        >
                          <div className="min-w-0">
                            <div>{t("cmd.open_file").replace("{title}", result.title)}</div>
                            <div className="truncate text-xs text-[var(--text-muted)]">{result.snippet}</div>
                          </div>
                        </Command.Item>
                        {workspaceId && workspaceName ? (
                          <Command.Item
                            className="command-palette__item"
                            onSelect={() => handleSelectWorkspace(workspaceId)}
                            value={`workspace ${workspaceName} ${result.title}`}
                          >
                            <span>{t("cmd.go_to_workspace").replace("{name}", workspaceName)}</span>
                          </Command.Item>
                        ) : null}
                        <Command.Item
                          className="command-palette__item"
                          onSelect={() => {
                            setMoveTarget(result);
                            setMode("move");
                          }}
                          value={`move ${result.title}`}
                        >
                          <span>{t("cmd.move_file").replace("{title}", result.title)}</span>
                        </Command.Item>
                      </div>
                    );
                  })}
                </Command.Group>
              ) : null}
              {searchStatus === "loading" ? (
                <div className="command-palette__empty">{t("cmd.searching")}</div>
              ) : null}
              <Command.Separator />
              <Command.Group heading="Workspaces">
                {workspaces.map((ws) => (
                  <Command.Item
                    key={ws.id}
                    className="command-palette__item"
                    onSelect={() => handleSelectWorkspace(ws.id)}
                    value={ws.name}
                  >
                    <span
                      className="workspace-item__dot"
                      style={{ background: ws.cover_color || "var(--report-color)" }}
                    />
                    <span>{ws.name}</span>
                    <span className="command-palette__item-count">{ws.file_count}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              {activeDocuments.length > 0 ? (
                <>
                  <Command.Separator />
                  <Command.Group heading={t("cmd.files")}>
                    {activeDocuments.map((document) => (
                      <Command.Item
                        key={document.id}
                        className="command-palette__item"
                        onSelect={() => handleSelectDocument(document.id)}
                        value={`${document.title} ${document.summary}`}
                      >
                        <span>{document.title}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                </>
              ) : null}
              <Command.Separator />
              <Command.Item
                className="command-palette__item"
                onSelect={() => setMode("create")}
                value={t("cmd.create_workspace")}
              >
                <span style={{ fontSize: 14 }}>+</span> {t("cmd.create_workspace")}
              </Command.Item>
            </Command.List>
          </Command>
        ) : null}

        {mode === "create" ? (
          <form onSubmit={handleCreateSubmit}>
            <input
              ref={createInputRef}
              className="command-palette__input"
              placeholder={t("cmd.create_name_placeholder")}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={handleCreateKeyDown}
            />
          </form>
        ) : null}

        {mode === "move" && moveTarget ? (
          <Command label="Move search result">
            <Command.Input
              className="command-palette__input"
              placeholder={t("cmd.move_to_ws").replace("{title}", moveTarget.title)}
              autoFocus
            />
            <Command.List className="command-palette__list">
              <Command.Group heading={t("cmd.select_workspace")}>
                {workspaces.map((workspace) => (
                  <Command.Item
                    key={workspace.id}
                    className="command-palette__item"
                    onSelect={() => void handleMoveResultToWorkspace(workspace.id)}
                    value={workspace.name}
                  >
                    <span>{workspace.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        ) : null}
      </div>
    </div>
  );
}
