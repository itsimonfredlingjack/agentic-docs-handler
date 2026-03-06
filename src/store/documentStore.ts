import { create } from "zustand";

import type {
  ActivityEvent,
  BackendConnectionPayload,
  ConnectionState,
  DismissMoveResponse,
  DocumentCounts,
  FileMoveToastItem,
  FinalizeMoveResponse,
  SearchResponse,
  SearchState,
  SidebarFilter,
  UiDocument,
  UndoMoveResponse,
} from "../types/documents";

type UploadMemory = {
  file: File;
  sourcePath: string | null;
};

type PendingMoveUiState = {
  action: "idle" | "confirming" | "dismissing";
  error: string | null;
};

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
  selectedDocumentIds: Set<string>;
  setSelectedDocument: (id: string | null) => void;
  toggleDocumentSelection: (id: string) => void;
  rangeSelectDocuments: (id: string, orderedIds: string[]) => void;
  clearMultiSelect: () => void;
  bootstrap: (documents: UiDocument[], counts: DocumentCounts, activity: ActivityEvent[]) => void;
  resyncFromBackend: (documents: UiDocument[], counts: DocumentCounts, activity: ActivityEvent[]) => void;
  setClientId: (clientId: string) => void;
  setConnectionState: (state: ConnectionState) => void;
  queueUploads: (localJobs: UiDocument[]) => void;
  rememberUpload: (requestId: string, payload: UploadMemory) => void;
  clearRememberedUpload: (requestId: string) => void;
  markJobStage: (requestId: string, stage: UiDocument["status"]) => void;
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
  applySearchResponse: (response: SearchResponse) => void;
  clearSearch: () => void;
  setSidebarFilter: (filter: SidebarFilter) => void;
  pushMoveToast: (toast: FileMoveToastItem) => void;
  dismissToast: (id: string) => void;
  applyUndoSuccess: (payload: UndoMoveResponse) => void;
  updateConnectionFromPayload: (payload: BackendConnectionPayload) => void;
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

const emptySearch: SearchState = {
  query: "",
  rewrittenQuery: "",
  answer: "",
  loading: false,
  active: false,
  resultIds: [],
  orphanResults: [],
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
  selectedDocumentIds: new Set(),
  setSelectedDocument: (id) => set({ selectedDocumentId: id, selectedDocumentIds: new Set() }),
  toggleDocumentSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedDocumentIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      // If this is the first multi-select and nothing was selected, also set primary
      const primary = next.size > 0 ? (state.selectedDocumentId ?? id) : null;
      return { selectedDocumentIds: next, selectedDocumentId: primary };
    }),
  rangeSelectDocuments: (id, orderedIds) =>
    set((state) => {
      const anchor = state.selectedDocumentId;
      if (!anchor) return { selectedDocumentId: id, selectedDocumentIds: new Set([id]) };
      const anchorIdx = orderedIds.indexOf(anchor);
      const targetIdx = orderedIds.indexOf(id);
      if (anchorIdx === -1 || targetIdx === -1) return state;
      const start = Math.min(anchorIdx, targetIdx);
      const end = Math.max(anchorIdx, targetIdx);
      const range = new Set(orderedIds.slice(start, end + 1));
      // Merge with existing selection
      const next = new Set([...state.selectedDocumentIds, ...range]);
      return { selectedDocumentIds: next };
    }),
  clearMultiSelect: () => set({ selectedDocumentIds: new Set() }),
  bootstrap: (documents, counts, activity) =>
    set({
      documents: Object.fromEntries(documents.map((document) => [document.id, document])),
      documentOrder: documents.map((document) => document.id),
      counts,
      activity,
      pendingMoveStateByRecordId: {},
    }),
  resyncFromBackend: (documents, counts, activity) =>
    set({
      documents: Object.fromEntries(documents.map((document) => [document.id, document])),
      documentOrder: documents.map((document) => document.id),
      counts,
      activity,
      pendingMoveStateByRecordId: {},
    }),
  setClientId: (clientId) => set({ clientId }),
  setConnectionState: (connectionState) => set({ connectionState }),
  queueUploads: (localJobs) =>
    set((state) => {
      const documents = { ...state.documents };
      let documentOrder = [...state.documentOrder];
      for (const job of localJobs) {
        documents[job.id] = job;
        documentOrder = upsertOrder(documentOrder, job.id);
      }
      return {
        documents,
        documentOrder,
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
  markJobStage: (requestId, stage) =>
    set((state) => {
      const documents = { ...state.documents };
      const target = Object.values(documents).find((document) => document.requestId === requestId);
      if (!target) {
        return state;
      }
      documents[target.id] = {
        ...target,
        status: stage,
        updatedAt: new Date().toISOString(),
      };
      return { documents };
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
      return { documents, documentOrder };
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
        loading: true,
        active: true,
      },
    })),
  applySearchResponse: (response) =>
    set((state) => {
      const resultIds: string[] = [];
      const orphanResults = [];
      for (const result of response.results) {
        if (state.documents[result.doc_id]) {
          resultIds.push(result.doc_id);
        } else {
          orphanResults.push(result);
        }
      }
      return {
        search: {
          query: response.query,
          rewrittenQuery: response.rewritten_query,
          answer: response.answer,
          loading: false,
          active: true,
          resultIds,
          orphanResults,
        },
      };
    }),
  clearSearch: () => set({ search: emptySearch }),
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
}));
