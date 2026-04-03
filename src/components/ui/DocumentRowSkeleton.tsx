const BAR_WIDTHS = [
  { name: "65%", detail: "40%", status: "50px" },
  { name: "80%", detail: "55%", status: "40px" },
  { name: "50%", detail: "35%", status: "55px" },
  { name: "72%", detail: "45%", status: "45px" },
  { name: "58%", detail: "30%", status: "48px" },
];

export function DocumentRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div aria-label="Laddar dokument">
      {Array.from({ length: count }).map((_, i) => {
        const widths = BAR_WIDTHS[i % BAR_WIDTHS.length];
        return (
          <div
            key={i}
            role="progressbar"
            className="flex items-center gap-3 border-b border-[var(--surface-4)] px-4 py-2.5"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[var(--surface-6)]" style={{ animationDelay: `${i * 100}ms` }} />
            <div className="flex-[2]">
              <div className="h-2.5 animate-pulse rounded bg-[var(--surface-6)]" style={{ width: widths.name, animationDelay: `${i * 100}ms` }} />
            </div>
            <div className="flex-[3]">
              <div className="h-2.5 animate-pulse rounded bg-[var(--surface-6)]" style={{ width: widths.detail, animationDelay: `${i * 100}ms` }} />
            </div>
            <div className="flex w-16 justify-end">
              <div className="h-2.5 animate-pulse rounded bg-[var(--surface-6)]" style={{ width: widths.status, animationDelay: `${i * 100}ms` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
