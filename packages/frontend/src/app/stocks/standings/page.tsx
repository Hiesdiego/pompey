/**
 * Stock standings page.
 *
 * Target location in the repo:
 *   packages/frontend/src/app/stocks/standings/page.tsx
 *
 * League switcher: All / Crypto / Stocks. Default is All, which shows
 * both tables stacked, crypto first, then stocks, each with its own
 * heading. Crypto shows the crypto LeagueTable, Stocks shows the
 * StockLeagueTable. The switcher is local state on this page. The
 * fixtures and match pages carry the same All / Crypto / Stocks
 * control, linking to the matching fixtures view.
 *
 * Same copy pattern as the crypto standings page: section title, one
 * line stating the season and the tiebreak, skeleton while loading,
 * empty state when no results exist yet.
 *
 * Ordering: the table trusts the backend order (points, then goal
 * difference, then goals scored, then wins, then fewest losses). If
 * GF/GA arrive null, the backend background scan has not finished, so
 * this page retries up to 3 times at 1.5s intervals instead of rendering
 * a wrong table. After 3 retries it renders what the backend returned
 * and shows a note that goals are still loading.
 *
 * Season: 12 teams, double round-robin, 22 rounds, 132 fixtures,
 * Nov 26 to Dec 16 2026. Dec 16 hosts rounds 21 and 22 in two waves.
 * Scoring: 1 goal = 0.05% (5 bps), integer basis point math, 0.03% is
 * the first scoring move, no-negative scorelines, max 10 goals per
 * team, 3 pts win / 1 draw / 0 loss, forfeit 3-0. TP (TickrPoints) is
 * unified off-chain and is not a stock table. It lives on the player
 * profile.
 *
 * Prices: this page adds no price polling. It reads no prices at all.
 */

"use client";

import { useEffect, useState } from "react";
import { Table2 } from "lucide-react";
import { api, type ApiTableRow } from "../../../lib/api";
import { stockApi, type StockApiTableRow } from "../../../lib/stockContracts";
import { LeagueTable } from "../../../components/LeagueTable";
import { StockLeagueTable } from "../../../components/StockLeagueTable";
import { StockScoringExplainer } from "../../../components/StockScoringExplainer";
import { SectionTitle, ErrorState, SkeletonRows } from "../../../components/States";
import { cn } from "../../../lib/cn";

export type LeagueFilter = "all" | "crypto" | "stocks";

export function LeagueSwitcher({
  value,
  onChange,
}: {
  value: LeagueFilter;
  onChange: (f: LeagueFilter) => void;
}) {
  const items: { key: LeagueFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "crypto", label: "Crypto" },
    { key: "stocks", label: "Stocks" },
  ];
  return (
    <div
      className="glass inline-flex rounded-2xl p-1"
      role="tablist"
      aria-label="League filter"
    >
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          role="tab"
          aria-selected={value === item.key}
          className={cn(
            "rounded-xl px-4 py-1.5 text-sm font-semibold transition-all active:scale-95",
            value === item.key
              ? "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] text-white shadow-[0_0_16px_rgba(46,124,246,.45)]"
              : "text-zinc-500 hover:text-[#1D4ED8] dark:text-zinc-400 dark:hover:text-[#7db3ff]"
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when any row is missing GF/GA, meaning the backend scan is incomplete. */
function hasNullGoals(rows: StockApiTableRow[]): boolean {
  return rows.some(
    (r) =>
      (r as unknown as { goalsFor: unknown }).goalsFor === null ||
      (r as unknown as { goalsAgainst: unknown }).goalsAgainst === null
  );
}

export default function StockStandingsPage() {
  const [stockTable, setStockTable] = useState<StockApiTableRow[] | null>(null);
  const [cryptoTable, setCryptoTable] = useState<ApiTableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goalsPending, setGoalsPending] = useState(false);
  const [filter, setFilter] = useState<LeagueFilter>("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [stock, crypto] = await Promise.all([
          (async () => {
            let rows = await stockApi.table();
            let attempts = 0;
            while (hasNullGoals(rows) && attempts < 3) {
              attempts += 1;
              if (alive) setGoalsPending(true);
              await sleep(1500);
              rows = await stockApi.table();
            }
            if (alive) setGoalsPending(hasNullGoals(rows));
            return rows;
          })(),
          api.table().catch(() => null),
        ]);
        if (!alive) return;
        setStockTable(stock);
        if (crypto) setCryptoTable(crypto);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div>
      <SectionTitle title="League standings" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <LeagueSwitcher value={filter} onChange={setFilter} />
      </div>
      <p className="mb-6 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Table2 className="h-4 w-4 text-[#2E7CF6]" />
        Stock Season 1, Nov 26 to Dec 16 2026, 12 teams, 22 rounds, 132 fixtures, ordered by points, then goal difference, goals scored, wins, fewest losses
      </p>

      {goalsPending && (
        <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
          Goals are still loading from the backend scan. The table below may show points before goals catch up.
        </p>
      )}

      {!stockTable ? (
        <SkeletonRows rows={12} />
      ) : stockTable.length === 0 ? (
        <p className="glass rounded-2xl p-6 text-center text-sm text-zinc-500 dark:text-zinc-500">
          No results yet, the table fills in as fixtures settle.
        </p>
      ) : (
        <div className="space-y-8">
          {(filter === "all" || filter === "crypto") && cryptoTable && (
            <section>
              <h2 className="mb-3 font-display text-base font-bold text-zinc-900 dark:text-white">
                Crypto league
              </h2>
              <LeagueTable rows={cryptoTable} />
            </section>
          )}
          {(filter === "all" || filter === "stocks") && (
            <section>
              <h2 className="mb-3 font-display text-base font-bold text-zinc-900 dark:text-white">
                Stock league
              </h2>
              <StockLeagueTable rows={stockTable} />
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                FORFEIT badge: a fixture decided 3-0 because one side had no performance. TP is unified across crypto and stocks and lives on your profile, not in this table.
              </p>
            </section>
          )}
        </div>
      )}

      <div className="mt-8">
        <StockScoringExplainer />
      </div>
    </div>
  );
}
