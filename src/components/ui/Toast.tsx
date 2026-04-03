import { useEffect, useRef } from "react";

type ToastType = "success" | "info" | "error";

type ToastData = {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  action?: { label: string; onClick: () => void };
};

type Props = {
  toast: ToastData;
  onDismiss: (id: string) => void;
};

const ICON: Record<ToastType, string> = { success: "✓", info: "ℹ", error: "✕" };

const TYPE_STYLES: Record<ToastType, string> = {
  success:
    "bg-[rgba(var(--receipt-color-rgb),0.12)] border-[rgba(var(--receipt-color-rgb),0.25)] [&_.toast-icon]:text-[var(--receipt-color)]",
  info:
    "bg-[var(--accent-surface)] border-[rgba(88,86,214,0.25)] [&_.toast-icon]:text-[var(--accent-primary)]",
  error:
    "bg-[rgba(var(--invoice-color-rgb),0.12)] border-[rgba(var(--invoice-color-rgb),0.25)] [&_.toast-icon]:text-[var(--invoice-color)]",
};

export function Toast({ toast, onDismiss }: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (toast.duration > 0) {
      timerRef.current = setTimeout(() => onDismiss(toast.id), toast.duration);
    }
    return () => clearTimeout(timerRef.current);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      role="status"
      onClick={() => onDismiss(toast.id)}
      className={`flex items-center gap-2.5 rounded-[var(--card-radius)] border px-3.5 py-2.5 backdrop-blur-xl cursor-pointer animate-slide-in-right ${TYPE_STYLES[toast.type]}`}
    >
      <span className="toast-icon text-sm-ui shrink-0">{ICON[toast.type]}</span>
      <span className="text-sm-ui text-[var(--text-primary)] flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toast.action!.onClick();
          }}
          className="action-secondary shrink-0 px-2 py-0.5 text-xs-ui"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
