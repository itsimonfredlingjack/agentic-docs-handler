import { create } from "zustand";

import type {
  ActivityEvent,
  BackendConnectionPayload,
  ConnectionState,
  DismissMoveResponse,
  DocumentClassification,
  DocumentCounts,
  ExtractionResult,
  FileMoveToastItem,
  FinalizeMoveResponse,
  SearchResponse,
  SearchState,
  SidebarFilter,
  UiDocument,
  UiDocumentKind,
  UndoMoveResponse,
  WorkspaceConversation,
} from "../types/documents";

type UploadMemory = {
  file: File;
  sourcePath: string | null;
};

type PendingMoveUiState = {
  action: "idle" | "confirming" | "dismissing";
  error: string | null;
};

export type StageEntry = { stage: string; at: number };

type DocumentStoreState = {
  clientId: string | null;
  connectionState: ConnectionState;
  documents: Record<string, UiDocument>;
  documentOrder: string[];
  counts: DocumentCounts;
  activity: ActivityEvent[];
  search: SearchState;
  sidebarFilter: SidebarFilter;
  toasts: FileMoveToastItem[];
  uploadsByRequestId: Record<string, UploadMemory>;
  pendingMoveStateByRecordId: Record<string, PendingMoveUiState>;
  selectedDocumentId: string | null;
  stageHistory: Record<string, StageEntry[]>;
  activeWorkspace: string | null;
  activeDocumentChat: string | null;
  conversations: Record<string, WorkspaceConversation>;
  filesLoading: boolean;
  searchFilters: { documentType: string | null; dateFrom: string | null; dateTo: string | null };
  setSelectedDocument: (id: string | null) => void;
  setSearchFilters: (filters: Partial<{ documentType: string | null; dateFrom: string | null; dateTo: string | null }>) => void;
  setFilesLoading: (loading: boolean) => void;
  bootstrap: (documents: UiDocument[], counts: DocumentCounts, activity: ActivityEvent[]) => void;
  resyncFromBackend: (documents: UiDocument[], counts: DocumentCounts, activity: ActivityEvent[]) => void;
  setClientId: (clientId: string) => void;
  setConnectionState: (state: ConnectionState) => void;
  queueUploads: (localJobs: UiDocument[]) => void;
  rememberUpload: (requestId: string, payload: UploadMemory) => void;
  clearRememberedUpload: (requestId: string) => void;
  markJobStage: (requestId: string, stage: UiDocument["status"], data?: { classification?: DocumentClassification; extraction?: ExtractionResult }) => void;
  upsertDocument: (document: UiDocument) => void;
  markJobFailed: (requestId: string, error: string, errorCode?: string | null) => void;
  setAwaitingConfirmation: (recordId: string) => void;
  setPendingMoveAction: (recordId: string, action: PendingMoveUiState["action"]) => void;
  setPendingMoveError: (recordId: string, error: string | null) => void;
  clearPendingMoveState: (recordId: string) => void;
  applyMoveFinalized: (payload: FinalizeMoveResponse) => void;
  applyMoveDismissed: (payload: DismissMoveResponse) => void;
  applyClientMoveFailure: (requestId: string, errorCode: string, message: string) => void;
  setSearchLoading: (query: string) => void;
  setSearchError: (query: string, error: string) => void;
  applySearchResponse: (response: SearchResponse) => void;
  clearSearch: () => void;
  setSidebarFilter: (filter: SidebarFilter) => void;
  pushMoveToast: (toast: FileMoveToastItem) => void;
  dismissToast: (id: string) => void;
  applyUndoSuccess: (payload: UndoMoveResponse) => void;
  updateConnectionFromPayload: (payload: BackendConnectionPayload) => void;
  updateExtractionField: (documentId: string, fieldKey: string, newValue: string) => void;
  setDocumentThumbnail: (requestId: string, thumbnailData: string) => void;
  setActiveWorkspace: (category: string | null) => void;
  setActiveDocumentChat: (documentId: string | null) => void;
  startWorkspaceQuery: (category: string, query: string) => void;
  appendStreamingToken: (category: string, token: string) => void;
  finalizeStreamingEntry: (category: string, sourceCount: number, errorMessage?: string | null) => void;
};

const emptyCounts: DocumentCounts = {
  all: 0,
  processing: 0,
  receipt: 0,
  contract: 0,
  invoice: 0,
  meeting_notes: 0,
  audio: 0,
  generic: 0,
  moved: 0,
};

const emptySearchFilters = { documentType: null, dateFrom: null, dateTo: null } as const;

const emptySearch: SearchState = {
  query: "",
  rewrittenQuery: "",
  answer: "",
  status: "idle",
  error: null,
  resultIds: [],
  orphanResults: [],
  snippetsByDocId: {},
};

function upsertOrder(order: string[], id: string): string[] {
  return [id, ...order.filter((entry) => entry !== id)];
}

export const useDocumentStore = create<DocumentStoreState>((set) => ({
  clientId: null,
  connectionState: "connecting",
  documents: {},
  documentOrder: [],
  counts: emptyCounts,
  activity: [],
  search: emptySearch,
  sidebarFilter: "all",
  toasts: [],
  uploadsByRequestId: {},
  pendingMoveStateByRecordId: {},
  selectedDocumentId: null,
  stageHistory: {},
  activeWorkspace: "all",
  activeDocumentChat: null,
  conversations: {},
  filesLoading: false,
  searchFilters: emptySearchFilters,
  setSelectedDocument: (id) => set({ selectedDocumentId: id }),
  setSearchFilters: (filters) => set((state) => ({
    searchFilters: { ...state.searchFilters, ...filters },
  })),
  setFilesLoading: (loading) => set({ filesLoading: loading }),
  bootstrap: (documents, counts, activity) =>
    set({
      documents: Object.fromEntries(documents.map((document) => [document.id, document])),
      documentOrder: documents.map((document) => document.id),
      counts,
      activity,
      pendingMoveStateByRecordId: {},
      stageHistory: {},
    }),
  resyncFromBackend: (documents, counts, activity) =>
    set({
      documents: Object.fromEntries(documents.map((document) => [document.id, document])),
      documentOrder: documents.map((document) => document.id),
      counts,
      activity,
      pendingMoveStateByRecordId: {},
      stageHistory: {},
    }),
  setClientId: (clientId) => set({ clientId }),
  setConnectionState: (connectionState) => set({ connectionState }),
  queueUploads: (localJobs) =>
    set((state) => {
      const documents = { ...state.documents };
      let documentOrder = [...state.documentOrder];
      const stageHistory = { ...state.stageHistory };
      const now = Date.now();
      for (const job of localJobs) {
        documents[job.id] = job;
        documentOrder = upsertOrder(documentOrder, job.id);
        stageHistory[job.requestId] = [{ stage: "uploading", at: now }];
      }
      return {
        documents,
        documentOrder,
        stageHistory,
        selectedDocumentId: localJobs.length > 0 ? localJobs[0].id : state.selectedDocumentId,
        counts: {
          ...state.counts,
          all: state.counts.all + localJobs.length,
          processing: state.counts.processing + localJobs.length,
        },
      };
    }),
  rememberUpload: (requestId, payload) =>
    set((state) => ({
      uploadsByRequestId: {
        ...state.uploadsByRequestId,
        [requestId]: payload,
      },
    })),
  clearRememberedUpload: (requestId) =>
    set((state) => {
      const uploadsByRequestId = { ...state.uploadsByRequestId };
      delete uploadsByRequestId[requestId];
      return { uploadsByRequestId };
    }),
  markJobStage: (requestId, stage, data?) =>
    set((state) => {
      const documents = { ...state.documents };
      const target = Object.values(documents).find((document) => document.requestId === requestId);
      if (!target) {
        return state;
      }
      const updates: Partial<UiDocument> = {
        status: stage,
        updatedAt: new Date().toISOString(),
      };
      if (data?.classification) {
        updates.classification = data.classification;
        updates.kind = data.classification.document_type as UiDocumentKind;
        updates.title = data.classification.title;
        updates.summary = data.classification.summary;
        updates.documentType = data.classification.document_type;
      }
      if (data?.extraction) {
        updates.extraction = data.extraction;
      }
      documents[target.id] = { ...target, ...updates };
      const prev = state.stageHistory[requestId] ?? [];
      return {
        documents,
        stageHistory: {
          ...state.stageHistory,
          [requestId]: [...prev, { stage, at: Date.now() }],
        },
      };
    }),
  upsertDocument: (document) =>
    set((state) => {
      const documents = { ...state.documents };
      const placeholder = Object.values(documents).find(
        (entry) => entry.requestId === document.requestId && entry.id !== document.id,
      );
      let documentOrder = [...state.documentOrder];
      if (placeholder) {
        delete documents[placeholder.id];
        documentOrder = documentOrder.filter((entry) => entry !== placeholder.id);
      }
      documents[document.id] = document;
      documentOrder = upsertOrder(documentOrder, document.id);
      const stageHistory = { ...state.stageHistory };
      if (
        document.status === "completed" &&
        !stageHistory[document.requestId]?.length
      ) {
        stageHistory[document.requestId] = [{ stage: "completed", at: Date.now() }];
      }
      return { documents, documentOrder, stageHistory };
    }),
  markJobFailed: (requestId, error, errorCode = null) =>
    set((state) => {
      const documents = { ...state.documents };
      const target = Object.values(documents).find((document) => document.requestId === requestId);
      if (!target) {
        return state;
      }
      const preserveContent = target.template !== "processing" && target.status !== "uploading";
      documents[target.id] = {
        ...target,
        status: "failed",
        summary: preserveContent ? target.summary : error,
        updatedAt: new Date().toISOString(),
        errorCode,
        warnings: preserveContent ? Array.from(new Set([...target.warnings, error])) : target.warnings,
      };
      return { documents };
    }),
  setAwaitingConfirmation: (recordId) =>
    set((state) => {
      const target = state.documents[recordId];
      if (!target) {
        return state;
      }
      return {
        documents: {
          ...state.documents,
          [recordId]: {
            ...target,
            status: "awaiting_confirmation",
            moveStatus: "awaiting_confirmation",
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),
  setPendingMoveAction: (recordId, action) =>
    set((state) => ({
      pendingMoveStateByRecordId: {
        ...state.pendingMoveStateByRecordId,
        [recordId]: {
          action,
          error: state.pendingMoveStateByRecordId[recordId]?.error ?? null,
        },
      },
    })),
  setPendingMoveError: (recordId, error) =>
    set((state) => ({
      pendingMoveStateByRecordId: {
        ...state.pendingMoveStateByRecordId,
        [recordId]: {
          action: state.pendingMoveStateByRecordId[recordId]?.action ?? "idle",
          error,
        },
      },
    })),
  clearPendingMoveState: (recordId) =>
    set((state) => {
      const pendingMoveStateByRecordId = { ...state.pendingMoveStateByRecordId };
      delete pendingMoveStateByRecordId[recordId];
      return { pendingMoveStateByRecordId };
    }),
  applyMoveFinalized: (payload) =>
    set((state) => {
      const documents = { ...state.documents };
      const target = documents[payload.record_id];
      const pendingMoveStateByRecordId = { ...state.pendingMoveStateByRecordId };
      delete pendingMoveStateByRecordId[payload.record_id];
      if (target) {
        documents[payload.record_id] = {
          ...target,
          sourcePath: payload.to_path,
          undoToken: payload.undo_token,
          moveStatus: payload.move_status,
          status: "completed",
          updatedAt: new Date().toISOString(),
        };
      }
      return { documents, pendingMoveStateByRecordId };
    }),
  applyMoveDismissed: (payload) =>
    set((state) => {
      const documents = { ...state.documents };
      const target = documents[payload.record_id];
      const pendingMoveStateByRecordId = { ...state.pendingMoveStateByRecordId };
      delete pendingMoveStateByRecordId[payload.record_id];
      if (target) {
        documents[payload.record_id] = {
          ...target,
          moveStatus: payload.move_status,
          status: "completed",
          updatedAt: new Date().toISOString(),
        };
      }
      return { documents, pendingMoveStateByRecordId };
    }),
  applyClientMoveFailure: (requestId, errorCode, message) =>
    set((state) => {
      const documents = { ...state.documents };
      const target = Object.values(documents).find((document) => document.requestId === requestId);
      if (!target) {
        return state;
      }
      documents[target.id] = {
        ...target,
        status: "failed",
        moveStatus: "move_failed",
        errorCode,
        summary: message,
        updatedAt: new Date().toISOString(),
      };
      return { documents };
    }),
  setSearchLoading: (query) =>
    set((state) => ({
      search: {
        ...state.search,
        query,
        status: "loading",
        error: null,
      },
    })),
  setSearchError: (query, error) =>
    set((state) => ({
      search: {
        ...state.search,
        query,
        status: "error",
        error,
      },
    })),
  applySearchResponse: (response) =>
    set((state) => {
      const resultIds: string[] = [];
      const orphanResults = [];
      const snippetsByDocId: Record<string, string> = {};
      for (const result of response.results) {
        snippetsByDocId[result.doc_id] = result.snippet;
        if (state.documents[result.doc_id]) {
          resultIds.push(result.doc_id);
        } else {
          orphanResults.push(result);
        }
      }
      const hasResults = resultIds.length + orphanResults.length > 0;
      const hasAnswer = response.answer.trim().length > 0;
      return {
        search: {
          query: response.query,
          rewrittenQuery: response.rewritten_query,
          answer: response.answer,
          status: hasResults || hasAnswer ? "ready" : "empty",
          error: null,
          resultIds,
          orphanResults,
          snippetsByDocId,
        },
      };
    }),
  clearSearch: () => set({ search: emptySearch, searchFilters: emptySearchFilters }),
  setSidebarFilter: (sidebarFilter) => set({ sidebarFilter }),
  pushMoveToast: (toast) =>
    set((state) => ({
      toasts: [toast, ...state.toasts.filter((entry) => entry.undoToken !== toast.undoToken)],
    })),
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
  applyUndoSuccess: (payload) =>
    set((state) => {
      const documents = { ...state.documents };
      const target = payload.record_id ? documents[payload.record_id] : Object.values(documents).find(
        (document) => document.moveResult?.to_path === payload.from_path,
      );
      if (target) {
        documents[target.id] = {
          ...target,
          sourcePath: payload.to_path,
          undoToken: null,
          moveStatus: "undone",
          moveResult: {
            attempted: true,
            success: true,
            from_path: payload.from_path,
            to_path: payload.to_path,
            error: null,
          },
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        documents,
        toasts: state.toasts.filter((toast) => toast.undoToken !== target?.undoToken),
      };
    }),
  updateConnectionFromPayload: (payload) =>
    set({
      connectionState: payload.state,
    }),
  updateExtractionField: (documentId, fieldKey, newValue) =>
    set((state) => {
      const doc = state.documents[documentId];
      if (!doc?.extraction) return state;
      return {
        documents: {
          ...state.documents,
          [documentId]: {
            ...doc,
            extraction: { ...doc.extraction, fields: { ...doc.extraction.fields, [fieldKey]: newValue } },
          },
        },
      };
    }),
  setDocumentThumbnail: (requestId, thumbnailData) =>
    set((state) => {
      const docs = { ...state.documents };
      const target = Object.values(docs).find((d) => d.requestId === requestId);
      if (!target) return state;
      docs[target.id] = { ...target, thumbnailData };
      return { documents: docs };
    }),
  setActiveWorkspace: (category) => set({ activeWorkspace: category, activeDocumentChat: null }),
  setActiveDocumentChat: (documentId) => set({ activeDocumentChat: documentId, activeWorkspace: null }),
  startWorkspaceQuery: (category, query) =>
    set((state) => {
      const conv = state.conversations[category] ?? { entries: [], isStreaming: false, streamingText: "" };
      return {
        conversations: {
          ...state.conversations,
          [category]: {
            entries: [
              ...conv.entries,
                {
                  id: crypto.randomUUID(),
                  query,
                  response: "",
                  timestamp: new Date().toISOString(),
                  sourceCount: 0,
                  errorMessage: null,
                },
              ],
              isStreaming: true,
              streamingText: "",
            },
        },
      };
    }),
  appendStreamingToken: (category, token) =>
    set((state) => {
      const conv = state.conversations[category];
      if (!conv) return state;
      return {
        conversations: {
          ...state.conversations,
          [category]: { ...conv, streamingText: conv.streamingText + token },
        },
      };
    }),
  finalizeStreamingEntry: (category, sourceCount, errorMessage = null) =>
    set((state) => {
      const conv = state.conversations[category];
      if (!conv || conv.entries.length === 0) return state;
      const entries = [...conv.entries];
      const last = { ...entries[entries.length - 1], response: conv.streamingText, sourceCount, errorMessage };
      entries[entries.length - 1] = last;
      return {
        conversations: {
          ...state.conversations,
          [category]: {
            entries,
            isStreaming: false,
            streamingText: "",
          },
        },
      };
    }),
}));
