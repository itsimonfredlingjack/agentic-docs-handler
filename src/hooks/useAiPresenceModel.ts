import { useEffect, useMemo, useRef, useState } from "react";

import type { AiPresenceMode } from "../components/AiPresence";
import { isProcessingStatus } from "../lib/status";
import { useDocumentStore } from "../store/documentStore";
import type { ConnectionState, UiDocument, UiDocumentKind } from "../types/documents";

type Options = {
  isFocused: boolean;
  isHovered: boolean;
  isStreaming: boolean;
};

export type AiPresenceModel = {
  mode: AiPresenceMode;
  accentKind: UiDocumentKind | null;
  processingStage: UiDocument["status"] | null;
  connectionState: ConnectionState;
};

function findProcessingDoc(documentOrder: string[], documents: Record<string, UiDocument>): UiDocument | null {
  for (const id of documentOrder) {
    const doc = documents[id];
    if (doc && isProcessingStatus(doc)) {
      return doc;
    }
  }
  return null;
}

function findWarningDoc(documentOrder: string[], documents: Record<string, UiDocument>): UiDocument | null {
  for (const id of documentOrder) {
    const doc = documents[id];
    if (doc && (doc.status === "failed" || doc.moveStatus === "awaiting_confirmation")) {
      return doc;
    }
  }
  return null;
}

function findLatestDoc(documentOrder: string[], documents: Record<string, UiDocument>): UiDocument | null {
  for (const id of documentOrder) {
    const doc = documents[id];
    if (doc) return doc;
  }
  return null;
}

function findLatestCompleted(
  documents: Record<string, UiDocument>,
  stageHistory: Record<string, Array<{ stage: string; at: number }>>,
) {
  let latest: { signature: string; kind: UiDocumentKind } | null = null;

  for (const doc of Object.values(documents)) {
    const history = stageHistory[doc.requestId];
    const last = history?.[history.length - 1];
    if (!last || (last.stage !== "completed" && last.stage !== "moved")) {
      continue;
    }
    if (!latest || Number(last.at) > Number(latest.signature.split(":")[1])) {
      latest = {
        signature: `${doc.id}:${last.at}`,
        kind: doc.kind,
      };
    }
  }

  return latest;
}

export function useAiPresenceModel({ isFocused, isHovered, isStreaming }: Options): AiPresenceModel {
  const connectionState = useDocumentStore((state) => state.connectionState);
  const documents = useDocumentStore((state) => state.documents);
  const documentOrder = useDocumentStore((state) => state.documentOrder);
  const stageHistory = useDocumentStore((state) => state.stageHistory);

  const processingDoc = useMemo(
    () => findProcessingDoc(documentOrder, documents),
    [documentOrder, documents],
  );
  const warningDoc = useMemo(
    () => findWarningDoc(documentOrder, documents),
    [documentOrder, documents],
  );
  const latestDoc = useMemo(
    () => findLatestDoc(documentOrder, documents),
    [documentOrder, documents],
  );
  const latestCompleted = useMemo(
    () => findLatestCompleted(documents, stageHistory),
    [documents, stageHistory],
  );

  const completionSignature = latestCompleted?.signature ?? null;
  const completionKind = latestCompleted?.kind ?? null;
  const seenCompletion = useRef<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (!completionSignature || completionSignature === seenCompletion.current) {
      return;
    }
    seenCompletion.current = completionSignature;
    setShowSuccess(true);
    const timer = window.setTimeout(() => setShowSuccess(false), 900);
    return () => window.clearTimeout(timer);
  }, [completionSignature]);

  const mode: AiPresenceMode = useMemo(() => {
    if (connectionState !== "connected") return "offline";
    if (isStreaming) return "answering";
    if (processingDoc) return "processing";
    if (warningDoc) return "warning";
    if (showSuccess) return "success";
    if (isFocused) return "ready";
    if (isHovered) return "hover";
    return "idle";
  }, [connectionState, isFocused, isHovered, isStreaming, processingDoc, showSuccess, warningDoc]);

  return {
    mode,
    accentKind: processingDoc?.kind ?? warningDoc?.kind ?? completionKind ?? latestDoc?.kind ?? null,
    processingStage: processingDoc?.status ?? null,
    connectionState,
  };
}
