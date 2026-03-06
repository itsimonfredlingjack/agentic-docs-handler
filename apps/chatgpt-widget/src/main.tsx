import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type UploadedFileRef = {
  file_id: string;
  download_url: string;
};

type SessionResult = {
  id: string;
  title: string;
  url?: string;
};

type SelectedDocument = {
  id: string;
  title: string;
  text: string;
  url?: string;
};

type PreviewPlan = {
  write_plan_id: string;
  confirm_token: string;
  expires_at: string;
};

type OpenAiBridge = {
  toolOutput?: Record<string, unknown>;
  widgetState?: Record<string, unknown>;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<any>;
  uploadFile?: (file: File) => Promise<any>;
  getFileDownloadUrl?: (input: { fileId: string }) => Promise<string | { download_url?: string; url?: string }>;
  setWidgetState?: (state: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    openai?: OpenAiBridge;
  }
}

function randomKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function App() {
  const bridge = window.openai;
  const [sessionId, setSessionId] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [status, setStatus] = useState<string>("Ready.");
  const [busy, setBusy] = useState<boolean>(false);
  const [results, setResults] = useState<SessionResult[]>([]);
  const [selected, setSelected] = useState<SelectedDocument | null>(null);
  const [mode, setMode] = useState<"analyze" | "transcribe">("analyze");
  const [latestFileRef, setLatestFileRef] = useState<UploadedFileRef | null>(null);
  const [previewPlan, setPreviewPlan] = useState<PreviewPlan | null>(null);

  const hasBridge = useMemo(() => Boolean(bridge && bridge.callTool), [bridge]);

  useEffect(() => {
    if (!bridge) {
      setStatus("ChatGPT bridge is unavailable in this environment.");
      return;
    }
    const output = bridge.toolOutput ?? {};
    const seededSession = typeof output.session_id === "string" ? output.session_id : "";
    const seededQuery = typeof output.query === "string" ? output.query : "";
    const seededResults = Array.isArray(output.results)
      ? (output.results as SessionResult[])
      : [];

    const widgetSession = typeof bridge.widgetState?.session_id === "string" ? bridge.widgetState.session_id : "";
    const widgetQuery = typeof bridge.widgetState?.query === "string" ? bridge.widgetState.query : "";

    if (seededSession || widgetSession) {
      setSessionId(widgetSession || seededSession);
    }
    if (seededQuery || widgetQuery) {
      setQuery(widgetQuery || seededQuery);
    }
    if (seededResults.length > 0) {
      setResults(seededResults);
    }
  }, [bridge]);

  useEffect(() => {
    if (bridge?.setWidgetState) {
      bridge.setWidgetState({ session_id: sessionId, query, mode });
    }
  }, [bridge, mode, query, sessionId]);

  async function callTool(name: string, args: Record<string, unknown>) {
    if (!bridge?.callTool) {
      throw new Error("callTool_unavailable");
    }
    return bridge.callTool(name, args);
  }

  async function openConsole() {
    setBusy(true);
    setStatus("Opening docs console...");
    try {
      const result = await callTool("render_docs_console", {
        session_id: sessionId || undefined,
        query: query || undefined,
      });
      const output = result?.structuredContent ?? {};
      const resolvedSession = typeof output.session_id === "string" ? output.session_id : sessionId;
      const resolvedResults = Array.isArray(output.results) ? output.results : [];
      setSessionId(resolvedSession || "");
      setResults(resolvedResults as SessionResult[]);
      setStatus("Console ready.");
    } catch (error) {
      setStatus(`open_console_failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function resolveUploadedRef(file: File): Promise<UploadedFileRef> {
    if (!bridge?.uploadFile) {
      throw new Error("uploadFile_unavailable");
    }
    const uploadResult = await bridge.uploadFile(file);
    const fileId =
      (typeof uploadResult === "string" ? uploadResult : uploadResult?.file_id || uploadResult?.fileId || "") as string;
    if (!fileId) {
      throw new Error("upload_missing_file_id");
    }

    let downloadUrl =
      (typeof uploadResult === "object" ? uploadResult?.download_url || uploadResult?.downloadUrl || "" : "") as string;

    if (!downloadUrl && bridge.getFileDownloadUrl) {
      const dlResult = await bridge.getFileDownloadUrl({ fileId });
      if (typeof dlResult === "string") {
        downloadUrl = dlResult;
      } else {
        downloadUrl = (dlResult?.download_url || dlResult?.url || "") as string;
      }
    }

    if (!downloadUrl) {
      throw new Error("upload_missing_download_url");
    }

    return { file_id: fileId, download_url: downloadUrl };
  }

  async function onUploadChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setBusy(true);
    setSelected(null);
    setStatus(mode === "analyze" ? "Uploading and analyzing..." : "Uploading and transcribing...");
    try {
      const fileRef = await resolveUploadedRef(file);
      setLatestFileRef(fileRef);
      const toolName = mode === "analyze" ? "analyze_uploaded_document" : "transcribe_uploaded_audio";
      const result = await callTool(toolName, {
        file: fileRef,
        session_id: sessionId || undefined,
      });
      const payload = result?.structuredContent ?? {};
      const resolvedSession = typeof payload.session_id === "string" ? payload.session_id : sessionId;
      setSessionId(resolvedSession || sessionId);
      setStatus(mode === "analyze" ? "Document analyzed." : "Audio transcribed.");
      if (query.trim()) {
        await runSessionSearch(query.trim(), resolvedSession || sessionId);
      }
    } catch (error) {
      setStatus(`upload_failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function runSessionSearch(activeQuery: string, forcedSessionId?: string) {
    const sid = forcedSessionId || sessionId;
    if (!sid) {
      setStatus("No session id. Open console first.");
      return;
    }
    setBusy(true);
    setStatus("Searching session documents...");
    try {
      const result = await callTool("search_session_documents", {
        session_id: sid,
        query: activeQuery,
        limit: 20,
      });
      const payload = result?.structuredContent ?? {};
      const resolved = Array.isArray(payload.results) ? payload.results : [];
      setResults(resolved as SessionResult[]);
      setSelected(null);
      setStatus(`Found ${resolved.length} session result(s).`);
    } catch (error) {
      setStatus(`search_failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function fetchDocument(id: string) {
    if (!sessionId) {
      setStatus("No session id.");
      return;
    }
    setBusy(true);
    setStatus("Fetching document...");
    try {
      const result = await callTool("fetch_session_document", { session_id: sessionId, id });
      const text = result?.content?.[0]?.text;
      const payload = text ? JSON.parse(text) : null;
      if (!payload) {
        throw new Error("invalid_fetch_payload");
      }
      setSelected(payload as SelectedDocument);
      setStatus("Document loaded.");
    } catch (error) {
      setStatus(`fetch_failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function previewOrganize() {
    if (!latestFileRef) {
      setStatus("Upload a file first.");
      return;
    }
    setBusy(true);
    setStatus("Creating organize preview...");
    try {
      const result = await callTool("preview_organize_uploaded", {
        file: latestFileRef,
        session_id: sessionId || undefined,
      });
      const payload = result?.structuredContent ?? {};
      if (typeof payload.session_id === "string") {
        setSessionId(payload.session_id);
      }
      if (typeof payload.write_plan_id === "string" && typeof payload.confirm_token === "string") {
        setPreviewPlan({
          write_plan_id: payload.write_plan_id,
          confirm_token: payload.confirm_token,
          expires_at: String(payload.expires_at || ""),
        });
      }
      setStatus("Preview ready. Confirm to execute move.");
    } catch (error) {
      setStatus(`preview_failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmOrganize() {
    if (!previewPlan) {
      setStatus("No preview plan to confirm.");
      return;
    }
    setBusy(true);
    setStatus("Confirming organize action...");
    try {
      await callTool("confirm_organize_uploaded", {
        write_plan_id: previewPlan.write_plan_id,
        confirm_token: previewPlan.confirm_token,
        idempotency_key: randomKey(),
      });
      setStatus("Organize action executed.");
      setPreviewPlan(null);
    } catch (error) {
      setStatus(`confirm_failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="header">
        <h2 className="title">Agentic Docs Console</h2>
        <span className="subtle">session: {sessionId || "n/a"}</span>
      </div>

      <div className="row">
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search in session docs"
          disabled={busy}
        />
        <button className="button" onClick={() => runSessionSearch(query)} disabled={busy || !query.trim() || !sessionId}>
          Search
        </button>
        <button className="button" onClick={openConsole} disabled={busy || !hasBridge}>
          Open
        </button>
      </div>

      <div className="row">
        <select className="select" value={mode} onChange={(event) => setMode(event.target.value as "analyze" | "transcribe")}> 
          <option value="analyze">Analyze upload</option>
          <option value="transcribe">Transcribe audio</option>
        </select>
        <input className="input" type="file" onChange={onUploadChange} disabled={busy || !hasBridge} />
        <button className="button" onClick={previewOrganize} disabled={busy || !latestFileRef}>
          Preview Move
        </button>
        <button className="button" onClick={confirmOrganize} disabled={busy || !previewPlan}>
          Confirm Move
        </button>
      </div>

      <p className="subtle">{status}</p>

      <div className="result-list">
        {results.map((item) => (
          <div className="result-item" key={item.id}>
            <button onClick={() => fetchDocument(item.id)} disabled={busy || !sessionId}>
              <div className="result-title">{item.title || item.id}</div>
              {item.url ? <div className="url">{item.url}</div> : null}
            </button>
          </div>
        ))}
      </div>

      {selected ? (
        <article className="panel">
          <div className="result-title">{selected.title || selected.id}</div>
          {selected.url ? <div className="url">{selected.url}</div> : null}
          <pre>{selected.text}</pre>
        </article>
      ) : null}

      {previewPlan ? (
        <article className="panel">
          <div className="result-title">Pending write plan</div>
          <pre>{JSON.stringify(previewPlan, null, 2)}</pre>
        </article>
      ) : null}
    </section>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
