import { forwardRef, type HTMLAttributes } from "react";

export type StatusType = "success" | "warning" | "error" | "info";

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  status: StatusType;
  showIcon?: boolean;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const styleMap: Record<StatusType, string> = {
  success: "text-[var(--receipt-color)] bg-[rgba(var(--receipt-color-rgb),0.12)] border-[rgba(var(--receipt-color-rgb),0.24)]",
  warning: "text-[var(--meeting-color)] bg-[rgba(var(--meeting-color-rgb),0.12)] border-[rgba(var(--meeting-color-rgb),0.24)]",
  error: "text-[var(--invoice-color)] bg-[rgba(var(--invoice-color-rgb),0.12)] border-[rgba(var(--invoice-color-rgb),0.24)]",
  info: "text-[var(--accent-primary)] bg-[rgba(88,86,214,0.12)] border-[rgba(88,86,214,0.24)]",
};

const iconMap: Record<StatusType, string> = {
  success: "✓",
  warning: "!",
  error: "✕",
  info: "i",
};

export const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(function StatusBadge(
  { status, showIcon = false, className, children, ...props },
  ref,
) {
  return (
    <span
      {...props}
      ref={ref}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs-ui font-semibold tracking-[0.04em]",
        styleMap[status],
        className,
      )}
    >
      {showIcon ? <span aria-hidden="true">{iconMap[status]}</span> : null}
      {children}
    </span>
  );
});
