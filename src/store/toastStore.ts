import { create } from "zustand";

type ToastType = "success" | "info" | "error";

type ToastAction = {
  label: string;
  onClick: () => void;
};

type Toast = {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  action?: ToastAction;
};

const MAX_TOASTS = 3;

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  info: 5000,
  error: 0,
};

type ToastStoreState = {
  toasts: Toast[];
  show: (
    message: string,
    type?: ToastType,
    opts?: { duration?: number; action?: ToastAction },
  ) => void;
  dismiss: (id: string) => void;
};

export const useToastStore = create<ToastStoreState>((set) => ({
  toasts: [],
  show: (message, type = "success", opts) => {
    const toast: Toast = {
      id: crypto.randomUUID(),
      message,
      type,
      duration: opts?.duration ?? DEFAULT_DURATION[type],
      action: opts?.action,
    };
    set((state) => {
      const next = [...state.toasts, toast];
      return { toasts: next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next };
    });
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
