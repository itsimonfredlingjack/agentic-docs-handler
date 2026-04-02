import { forwardRef, type HTMLAttributes } from "react";

type CardVariant = "default" | "clickable" | "elevated";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const variantClasses: Record<CardVariant, string> = {
  default: "",
  clickable: "cursor-pointer hover:bg-[var(--surface-6)]",
  elevated: "shadow-[0_10px_30px_rgba(0,0,0,0.22)]",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", className, ...props },
  ref,
) {
  return (
    <div
      {...props}
      ref={ref}
      className={cx(
        "rounded-[var(--card-radius)] border border-[var(--surface-8)] bg-[var(--surface-4)]",
        variantClasses[variant],
        className,
      )}
    />
  );
});
