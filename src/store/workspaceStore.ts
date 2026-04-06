import { create } from "zustand";

import type { WorkspaceResponse } from "../types/workspace";
import {
  checkHealth,
  fetchWorkspaces as apiFetchWorkspaces,
  createWorkspace as apiCreateWorkspace,
  updateWorkspace as apiUpdateWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
} from "../lib/api";

type WorkspaceTab = "documents" | "insights";

type WorkspaceStoreState = {
  workspaces: WorkspaceResponse[];
  activeWorkspaceId: string | null;
  activeWorkspaceTab: WorkspaceTab;
  loading: boolean;
  error: string | null;
  backendStatus: "checking" | "online" | "offline";

  checkBackend: () => Promise<void>;
  fetchWorkspaces: () => Promise<void>;
  setActiveWorkspace: (id: string) => void;
  setActiveWorkspaceTab: (tab: WorkspaceTab) => void;
  createWorkspace: (name: string) => Promise<WorkspaceResponse>;
  updateWorkspace: (id: string, fields: { name?: string; description?: string; cover_color?: string }) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
};

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  activeWorkspaceTab: "documents",
  loading: false,
  error: null,
  backendStatus: "checking",

  checkBackend: async () => {
    set({ backendStatus: "checking" });
    const healthy = await checkHealth();
    if (healthy) {
      set({ backendStatus: "online" });
      await get().fetchWorkspaces();
      return;
    }
    set({ backendStatus: "offline" });
    let delay = 1000;
    const maxDelay = 8000;
    const retry = async () => {
      const ok = await checkHealth();
      if (ok) {
        set({ backendStatus: "online" });
        await get().fetchWorkspaces();
        return;
      }
      delay = Math.min(delay * 2, maxDelay);
      setTimeout(() => void retry(), delay);
    };
    setTimeout(() => void retry(), delay);
  },

  fetchWorkspaces: async () => {
    set({ loading: true, error: null });
    try {
      const list = await apiFetchWorkspaces();
      const workspaces = list.workspaces;
      set((state) => {
        const nextActive =
          state.activeWorkspaceId !== null
            ? state.activeWorkspaceId
            : (workspaces.find((w) => w.is_inbox)?.id ?? null);
        return { workspaces, activeWorkspaceId: nextActive, loading: false };
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        backendStatus: "offline",
      });
    }
  },

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id, activeWorkspaceTab: "documents" }),

  setActiveWorkspaceTab: (tab) => set({ activeWorkspaceTab: tab }),

  createWorkspace: async (name) => {
    const created = await apiCreateWorkspace(name);
    await get().fetchWorkspaces();
    set({ activeWorkspaceId: created.id });
    return created;
  },

  updateWorkspace: async (id, fields) => {
    await apiUpdateWorkspace(id, fields);
    await get().fetchWorkspaces();
  },

  deleteWorkspace: async (id) => {
    await apiDeleteWorkspace(id);
    const { activeWorkspaceId } = get();
    if (activeWorkspaceId === id) {
      // Refetch first so we can find the inbox
      await get().fetchWorkspaces();
      const inbox = get().workspaces.find((w) => w.is_inbox);
      set({ activeWorkspaceId: inbox?.id ?? null });
    } else {
      await get().fetchWorkspaces();
    }
  },

}));
