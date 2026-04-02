import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "text";
type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent-primary)] text-white border border-transparent hover:bg-[var(--accent-secondary)] focus-visible:outline-[var(--accent-primary)]",
  secondary:
    "action-secondary text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-[var(--accent-primary)]",
  text: "bg-transparent border border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-4)] focus-visible:outline-[var(--accent-primary)]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs-ui",
  md: "px-3 py-1.5 text-sm-ui",
  lg: "px-4 py-2 text-base-ui",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled = false, className, children, ...props },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      ref={ref}
      type={props.type ?? "button"}
      disabled={isDisabled}
      aria-busy={loading ? "true" : undefined}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-[var(--button-radius)] font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        loading && "button--loading",
        className,
      )}
    >
      {children}
    </button>
  );
});
