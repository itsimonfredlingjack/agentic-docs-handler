import { type ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cx("flex flex-1 flex-col items-center justify-center px-6 py-6 text-center", className)}>
      {icon ? <div className="mb-3">{icon}</div> : null}
      <h3 className="text-base-ui font-medium text-[var(--text-muted)]">{title}</h3>
      <p className="mt-1 text-sm-ui leading-relaxed text-[var(--text-disabled)]">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
