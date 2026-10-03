/**
 * Loading state for /markets. Skeleton of the trading board: filter tabs
 * row + market rows, using the shared .skeleton shimmer.
 */
export default function MarketsLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-page-in px-4 py-6" aria-busy="true" aria-label="Loading markets">
      {/* filter tabs */}
      <div className="mb-5 flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      {/* market rows */}
      <div className="flex flex-col gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="glass rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="skeleton mb-2 h-5 w-3/4" />
                <div className="skeleton h-4 w-1/2" />
              </div>
              <div className="skeleton h-10 w-20 shrink-0 rounded-xl" />
            </div>
            <div className="mt-4 flex gap-2">
              <div className="skeleton h-9 flex-1" />
              <div className="skeleton h-9 flex-1" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
