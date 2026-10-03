"use client";

import { useEffect } from "react";

/**
 * Segment boundary for /markets. Same calm treatment as the global
 * boundary, scoped to the markets board.
 */
export default function MarketsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[tickr] markets error digest:", error.digest ?? "n/a");
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center px-4 py-16">
      <div className="glass w-full rounded-3xl p-8 text-center sm:p-10">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2e7cf6] to-[#1d4ed8] shadow-[0_0_28px_rgba(46,124,246,0.45)]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 8v5m0 3.5v.01M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
          The markets board hiccuped.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          The board couldn&apos;t load this time — your funds and predictions are safe.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl bg-gradient-to-r from-[#2e7cf6] to-[#1d4ed8] px-6 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(46,124,246,0.4)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Reload board
          </button>
          <a
            href="/"
            className="rounded-xl border border-zinc-200 px-6 py-3 text-sm font-semibold text-zinc-600 transition-colors hover:border-[#2e7cf6]/50 hover:text-zinc-900 dark:border-white/10 dark:text-zinc-300 dark:hover:text-white"
          >
            Back home
          </a>
        </div>
      </div>
    </div>
  );
}
