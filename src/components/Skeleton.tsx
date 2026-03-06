export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-[14px] py-[10px]">
      <div className="skeleton-shimmer h-2 w-2 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton-shimmer h-3 w-3/4 rounded" />
        <div className="skeleton-shimmer h-2 w-1/3 rounded" />
      </div>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="detail-section space-y-3">
        <div className="skeleton-shimmer h-3 w-24 rounded" />
        <div className="skeleton-shimmer h-5 w-2/3 rounded" />
        <div className="skeleton-shimmer h-3 w-full rounded" />
        <div className="skeleton-shimmer h-3 w-4/5 rounded" />
      </div>
      <div className="detail-section-hero space-y-4">
        <div className="skeleton-shimmer h-3 w-20 rounded" />
        <div className="skeleton-shimmer h-7 w-1/3 rounded" />
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="skeleton-shimmer h-2 w-12 rounded" />
            <div className="skeleton-shimmer h-3 w-24 rounded" />
          </div>
          <div className="space-y-1">
            <div className="skeleton-shimmer h-2 w-12 rounded" />
            <div className="skeleton-shimmer h-3 w-20 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
