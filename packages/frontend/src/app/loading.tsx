/**
 * Global loading state (App Router). Skeleton of the app shell: a
 * header-height shimmer bar plus a grid of card skeletons, using the
 * shared .skeleton shimmer from globals.css.
 */
export default function GlobalLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-page-in px-4 py-6" aria-busy="true" aria-label="Loading">
      {/* header-height shimmer bar */}
      <div className="skeleton mb-6 h-14 w-full" />
      {/* hero strip */}
      <div className="skeleton mb-6 h-40 w-full" />
      {/* card grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass rounded-2xl p-5">
            <div className="skeleton mb-4 h-6 w-2/3" />
            <div className="skeleton mb-2 h-4 w-full" />
            <div className="skeleton mb-4 h-4 w-5/6" />
            <div className="flex items-center justify-between">
              <div className="skeleton h-9 w-24" />
              <div className="skeleton h-9 w-9 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
