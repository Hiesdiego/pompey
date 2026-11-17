/**
 * Stock fixtures page.
 *
 * Target location in the repo:
 *   packages/frontend/src/app/stocks/fixtures/page.tsx
 *
 * League switcher: All / Crypto / Stocks, defaults to All. All shows
 * crypto plus stock fixtures for the selected day, with a league pill
 * on each card. Crypto filters to crypto fixtures only, Stocks to stock
 * fixtures only. The switcher links match the standings page switcher.
 *
 * Matchdays: 21 stock matchdays, Nov 26 to Dec 16 2026, one matchday
 * per day, 11 fixtures per matchday, 231 fixtures total. The pager is
 * the stock matchday pager. The selected day is a UTC calendar day, so
 * crypto fixtures kicking off that UTC day appear under All even though
 * the crypto season uses different matchday numbers. Defaults to the
 * first matchday with any non-settled fixture.
 *
 * Refetch: fixtures refetch every 15 seconds while the page is open.
 * That is the fixtures REST refetch, not a price poll. Prices arrive
 * over the single shared WebSocket in useLiveFeed, reused here. Do not
 * add a second /api/prices poll for stocks, it would double egress
 * against the 1GB per month backend cap. Stock prices are only
 * subscribed while a stock page is mounted, because useLiveFeed is only
 * mounted by pages that call it.
 *
 * All timestamps are UTC. See stockFormat.ts, there is no utcTime.ts
 * in the repo at origin/main bad5ca6.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Table2 } from "lucide-react";
import { useStockLiveFeed } from "../../../hooks/useStockLiveFeed";
import { api, type ApiFixture } from "../../../lib/api";
import { stockApi, type StockApiFixture } from "../../../lib/stockContracts";
import { stockMatchdayDate, utcDayKey } from "../../../lib/stockFormat";
import { FixtureCard } from "../../../components/FixtureCard";
import { StockFixtureCard, stockFixtureStatus } from "../../../components/StockFixtureCard";
import { StockScoringExplainer } from "../../../components/StockScoringExplainer";
import { SectionTitle, ErrorState, EmptyState, SkeletonCards } from "../../../components/States";
import { cn } from "../../../lib/cn";
import type { LeagueFilter } from "../standings/page";

const REFETCH_MS = 15_000;

export default function StockFixturesPage() {
  const { fixtureUpdates } = useStockLiveFeed(true);
  const [stockFixtures, setStockFixtures] = useState<StockApiFixture[] | null>(null);
  const [cryptoFixtures, setCryptoFixtures] = useState<ApiFixture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matchday, setMatchday] = useState<number | null>(null);
  const [filter, setFilter] = useState<LeagueFilter>("all");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [stock, crypto] = await Promise.all([
          stockApi.fixtures(),
          api.fixtures().catch(() => [] as ApiFixture[]),
        ]);
        if (!alive) return;
        setStockFixtures(stock);
        setCryptoFixtures(crypto);
        setMatchday((prev) => {
          if (prev !== null) return prev;
          const firstOpen = stock.find((x) => !x.settled)?.matchdayIndex ?? 0;
          return firstOpen;
        });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const t = setInterval(() => void load(), REFETCH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const matchdays = useMemo(() => {
    if (!stockFixtures) return [];
    const groups = new Map<number, StockApiFixture[]>();
    for (const f of stockFixtures) {
      const arr = groups.get(f.matchdayIndex) ?? [];
      arr.push(f);
      groups.set(f.matchdayIndex, arr);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [stockFixtures]);

  const current = matchdays.find(([md]) => md === matchday);
  const selectedDay = matchday === null ? null : stockMatchdayDate(matchday);

  const visibleStock = useMemo(() => {
    if (!current) return [];
    return current[1];
  }, [current]);

  const visibleCrypto = useMemo(() => {
    if (!cryptoFixtures || !selectedDay) return [];
    return cryptoFixtures.filter(
      (f) => utcDayKey(f.windowStart ?? f.kickoff) === selectedDay
    );
  }, [cryptoFixtures, selectedDay]);

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
            href="/stocks/standings"
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#1D4ED8] transition-colors hover:text-[#2E7CF6] dark:text-[#7db3ff] dark:hover:text-[#4B93FF]"
          >
            <Table2 className="h-4 w-4" /> Stock standings
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["all", "crypto", "stocks"] as LeagueFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn(
              "rounded-xl px-4 py-1.5 text-sm font-semibold transition-all active:scale-95",
              filter === f
                ? "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] text-white shadow-[0_0_16px_rgba(46,124,246,.45)]"
                : "glass text-zinc-500 hover:text-[#1D4ED8] dark:text-zinc-400 dark:hover:text-[#7db3ff]"
            )}
          >
            {f === "all" ? "All" : f === "crypto" ? "Crypto" : "Stocks"}
          </button>
        ))}
      </div>
      <p className="mb-6 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <CalendarDays className="h-4 w-4 text-[#2E7CF6]" />
        Stock Season 1, 21 matchdays, 1-hour windows, 1 matchday lasts 1 day, Nov 26 to Dec 16 2026, all times UTC
      </p>

      {!stockFixtures || matchday === null ? (
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
                  const open = list.some(
                    (f) => stockFixtureStatus(f, fixtureUpdates[f.fixtureId]) !== "settled"
                  );
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
                      title={`Matchday ${md + 1}, ${stockMatchdayDate(md)} UTC`}
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
                  {selectedDay} UTC, {current[1].length} stock matches
                  {filter === "all" && visibleCrypto.length > 0
                    ? `, ${visibleCrypto.length} crypto matches that day`
                    : ""}
                </span>
              </h2>

              {(filter === "all" || filter === "stocks") && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleStock.map((f) => (
                    <StockFixtureCard
                      key={`stock-${f.fixtureId}`}
                      fixture={f}
                      liveUpdate={fixtureUpdates[f.fixtureId]}
                    />
                  ))}
                </div>
              )}

              {(filter === "all" || filter === "crypto") && (
                <>
                  {filter === "all" && visibleStock.length > 0 && visibleCrypto.length > 0 && (
                    <h3 className="mb-4 mt-8 font-display text-base font-bold text-zinc-900 dark:text-white">
                      Crypto matches that day
                    </h3>
                  )}
                  {visibleCrypto.length === 0 ? (
                    filter === "crypto" ? (
                      <EmptyState title="No crypto fixtures that day." />
                    ) : null
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {visibleCrypto.map((f) => (
                        <FixtureCard
                          key={`crypto-${f.fixtureId}`}
                          fixture={f}
                          liveUpdate={fixtureUpdates[f.fixtureId]}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
              {filter === "all" && visibleStock.length === 0 && visibleCrypto.length === 0 && (
                <EmptyState title="No fixtures for this matchday." />
              )}
            </>
          )}
        </>
      )}

      <div className="mt-8">
        <StockScoringExplainer compact />
      </div>
    </div>
  );
}
