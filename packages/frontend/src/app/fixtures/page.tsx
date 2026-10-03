/**
 * Fixtures page (spec P3.5): the full season calendar — all 38 matchdays,
 * with TBA dates and countdowns. Defaults to the current matchday.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Table2 } from "lucide-react";
import { api, type ApiFixture } from "../../lib/api";
import { FixtureCard, fixtureStatus } from "../../components/FixtureCard";
import { SectionTitle, ErrorState, EmptyState, SkeletonCards } from "../../components/States";
import { cn } from "../../lib/cn";
import { CONTRACTS, PRICE_ORACLE_ABI, PRICE_DECIMALS, SEASON_ID } from "../../lib/contracts";
import { getPublicClient } from "../../hooks/usePublicClient";
import { usePriceFeed } from "../../lib/price/usePriceFeed";
import { normalizeScoreline, roundPctLikeOracle } from "../../lib/format";

interface FixtureSnapshot {
  homeStart: bigint;
  awayStart: bigint;
  homeEnd: bigint;
  awayEnd: bigint;
  startSubmitted: boolean;
  endSubmitted: boolean;
}

export default function FixturesPage() {
  const [fixtures, setFixtures] = useState<ApiFixture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matchday, setMatchday] = useState<number | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, FixtureSnapshot>>({});
  const { prices } = usePriceFeed(true);

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

  useEffect(() => {
    const timer = setInterval(() => {
      void api.fixtures().then(setFixtures).catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
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
  const scoreFixtures = current?.[1].filter((f) => {
    const status = fixtureStatus(f);
    return status === "live" || status === "settled";
  }) ?? [];
  const scoreFixtureIds = scoreFixtures.map((f) => f.fixtureId).join(",");

  useEffect(() => {
    if (!scoreFixtureIds || !CONTRACTS.priceOracle) return;
    let alive = true;
    const ids = scoreFixtureIds.split(",");
    Promise.all(ids.map(async (id) => {
      try {
        const value = await getPublicClient().readContract({
          address: CONTRACTS.priceOracle as `0x${string}`,
          abi: PRICE_ORACLE_ABI,
          functionName: "getSnapshot",
          args: [SEASON_ID, BigInt(id)],
        });
        return [id, value as unknown as FixtureSnapshot] as const;
      } catch {
        return [id, null] as const;
      }
    })).then((results) => {
      if (!alive) return;
      setSnapshots((old) => ({ ...old, ...Object.fromEntries(results.filter((r): r is readonly [string, FixtureSnapshot] => r[1] !== null)) }));
    });
    return () => { alive = false; };
  }, [scoreFixtureIds]);

  const scoreFor = (fixture: ApiFixture): [number, number] | null => {
    if (!fixture.home || !fixture.away) return null;
    const status = fixtureStatus(fixture);
    const snapshot = snapshots[fixture.fixtureId];
    if (!snapshot?.startSubmitted) return null;
    const pct = (start: bigint, current: number | bigint | null) => {
      if (current === null || start <= 0n) return null;
      const startPrice = Number(start) / 10 ** PRICE_DECIMALS;
      const currentPrice = typeof current === "bigint" ? Number(current) / 10 ** PRICE_DECIMALS : current;
      return startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : null;
    };
    const homePct = status === "settled" && snapshot.endSubmitted
      ? pct(snapshot.homeStart, snapshot.homeEnd)
      : status === "live" ? pct(snapshot.homeStart, prices[fixture.home.symbol] ?? null) : null;
    const awayPct = status === "settled" && snapshot.endSubmitted
      ? pct(snapshot.awayStart, snapshot.awayEnd)
      : status === "live" ? pct(snapshot.awayStart, prices[fixture.away.symbol] ?? null) : null;
    if (homePct === null || awayPct === null) return null;
    return normalizeScoreline(roundPctLikeOracle(homePct), roundPctLikeOracle(awayPct));
  };

  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div>
      <SectionTitle
        title="Fixtures"
        action={
          <Link
            href="/standings"
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#1D4ED8] transition-colors hover:text-[#2E7CF6] dark:text-[#7db3ff] dark:hover:text-[#4B93FF]"
          >
            <Table2 className="h-4 w-4" /> League standings
          </Link>
        }
      />
      <p className="mb-6 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <CalendarDays className="h-4 w-4 text-[#2E7CF6]" />
        Season 1 · 38 matchdays · 1-hour windows · dates show as TBA until revealed
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
                  const open = list.some((f) => fixtureStatus(f) !== "settled");
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
                  <FixtureCard key={f.fixtureId} fixture={f} score={scoreFixtures.some((item) => item.fixtureId === f.fixtureId) ? scoreFor(f) : undefined} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
