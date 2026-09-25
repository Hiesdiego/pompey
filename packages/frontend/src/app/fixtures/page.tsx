/**
 * Fixtures page (spec P3.5): the full season calendar — all 38 matchdays,
 * with TBA dates and countdowns. Defaults to the current matchday.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useLiveFeed } from "../hooks/useLiveFeed";
import { api, type ApiFixture } from "../lib/api";
import { FixtureCard, fixtureStatus } from "../components/FixtureCard";
import { SectionTitle, ErrorState, EmptyState, SkeletonCards } from "../components/States";
import { cn } from "../lib/cn";

export default function FixturesPage() {
  const { fixtureUpdates } = useLiveFeed(true);
  const [fixtures, setFixtures] = useState<ApiFixture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matchday, setMatchday] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .fixtures()
      .then((f) => {
        if (!alive) return;
        setFixtures(f);
        // Default to the first matchday with any non-settled fixture.
        const firstOpen = f.find((x) => !x.settled)?.matchdayIndex ?? 0;
        setMatchday(firstOpen);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const matchdays = useMemo(() => {
    if (!fixtures) return [];
    const groups = new Map<number, ApiFixture[]>();
    for (const f of fixtures) {
      const arr = groups.get(f.matchdayIndex) ?? [];
      arr.push(f);
      groups.set(f.matchdayIndex, arr);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [fixtures]);

  const current = matchdays.find(([md]) => md === matchday);

  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div>
      <SectionTitle title="Fixtures" />
      <p className="mb-6 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <CalendarDays className="h-4 w-4 text-[#2E7CF6]" />
        Season 1 · 38 matchdays · 20-minute windows · dates show as TBA until revealed
      </p>

      {!fixtures || matchday === null ? (
        <SkeletonCards cards={6} />
      ) : (
        <>
          <div className="glass mb-6 flex items-center gap-2 rounded-2xl p-2">
            <button
              onClick={() => setMatchday((m) => Math.max(0, (m ?? 0) - 1))}
              disabled={matchday === 0}
              className="rounded-xl border border-black/10 p-2 text-zinc-600 transition-all hover:border-[#2E7CF6]/50 hover:text-[#1D4ED8] active:scale-95 disabled:opacity-30 dark:border-white/10 dark:text-zinc-300 dark:hover:border-[#2E7CF6]/50 dark:hover:text-[#7db3ff]"
              aria-label="Previous matchday"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex-1 overflow-x-auto">
              <div className="flex gap-1.5">
                {matchdays.map(([md, list]) => {
                  const open = list.some((f) => fixtureStatus(f, fixtureUpdates[f.fixtureId]) !== "settled");
                  return (
                    <button
                      key={md}
                      onClick={() => setMatchday(md)}
                      className={cn(
                        "relative shrink-0 rounded-lg px-2.5 py-1.5 font-display text-xs font-bold tabular-nums transition-all active:scale-95",
                        md === matchday
                          ? "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] text-white shadow-[0_0_16px_rgba(46,124,246,.45)]"
                          : "bg-black/5 text-zinc-500 hover:bg-[#2E7CF6]/10 hover:text-[#1D4ED8] dark:bg-white/5 dark:text-zinc-400 dark:hover:bg-[#2E7CF6]/12 dark:hover:text-[#7db3ff]"
                      )}
                      title={`Matchday ${md + 1}`}
                    >
                      {md + 1}
                      {open && md !== matchday && (
                        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#1D9E75] shadow-[0_0_6px_rgba(29,158,117,.8)]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => setMatchday((m) => Math.min(matchdays.length - 1, (m ?? 0) + 1))}
              disabled={matchdays.length === 0 || matchday === matchdays.length - 1}
              className="rounded-xl border border-black/10 p-2 text-zinc-600 transition-all hover:border-[#2E7CF6]/50 hover:text-[#1D4ED8] active:scale-95 disabled:opacity-30 dark:border-white/10 dark:text-zinc-300 dark:hover:border-[#2E7CF6]/50 dark:hover:text-[#7db3ff]"
              aria-label="Next matchday"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {!current ? (
            <EmptyState title="No fixtures for this matchday." />
          ) : (
            <>
              <h2 className="mb-4 font-display text-base font-bold text-zinc-900 dark:text-white">
                Matchday {current[0] + 1}
                <span className="ml-2 text-sm font-normal text-zinc-500">
                  {current[1].length} matches
                </span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {current[1].map((f) => (
                  <FixtureCard key={f.fixtureId} fixture={f} liveUpdate={fixtureUpdates[f.fixtureId]} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
