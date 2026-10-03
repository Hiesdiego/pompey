/**
 * Loading state for /markets/[id]. Skeleton of the market detail view:
 * hero block, odds board rows, and the stake rail.
 */
export default function MarketDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-page-in px-4 py-6" aria-busy="true" aria-label="Loading market">
      {/* hero */}
      <div className="glass mb-5 rounded-3xl p-6 sm:p-8">
        <div className="skeleton mb-3 h-6 w-40" />
        <div className="skeleton mb-4 h-9 w-4/5" />
        <div className="skeleton h-5 w-3/5" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* odds board */}
        <div className="lg:col-span-2">
          <div className="glass rounded-3xl p-6">
            <div className="skeleton mb-5 h-6 w-48" />
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="skeleton h-10 w-10 shrink-0 rounded-full" />
                  <div className="skeleton h-5 flex-1" />
                  <div className="skeleton h-8 w-20 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* stake rail */}
        <div className="glass h-fit rounded-3xl p-6">
          <div className="skeleton mb-4 h-6 w-32" />
          <div className="skeleton mb-3 h-12 w-full" />
          <div className="skeleton h-11 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
