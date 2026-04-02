type ProgressBarProps = {
  value?: number;
  max?: number;
  label?: string;
  className?: string;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function ProgressBar({ value = 0, max = 100, label, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(value, max));
  const percentage = max > 0 ? Math.round((clamped / max) * 100) : 0;

  return (
    <div className={cx("w-full", className)}>
      {label ? (
        <div className="mb-1.5 flex items-center justify-between text-xs-ui text-[var(--text-muted)]">
          <span>{label}</span>
          <span className="font-mono">{percentage}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-6)]"
      >
        <div
          className="h-full rounded-full bg-[var(--accent-primary)] transition-[width] duration-200 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
