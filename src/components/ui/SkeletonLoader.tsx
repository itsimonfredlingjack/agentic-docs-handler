type SkeletonLoaderProps = {
  count?: number;
  className?: string;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function SkeletonLoader({ count = 1, className }: SkeletonLoaderProps) {
  return (
    <div className={cx("space-y-2", className)} aria-label="Laddar innehåll">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          role="progressbar"
          className="h-3 w-full animate-pulse rounded bg-[var(--surface-6)]"
        />
      ))}
    </div>
  );
}
