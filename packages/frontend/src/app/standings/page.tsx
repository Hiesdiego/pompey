"use client";

import { useEffect, useState } from "react";
import { Table2 } from "lucide-react";
import { api, type ApiTableRow } from "../../lib/api";
import { stockApi, type StockApiTableRow } from "../../lib/stockContracts";
import { SEASON_DISPLAY_NAME } from "../../lib/contracts";
import { LeagueTable, LeagueTableSkeleton } from "../../components/LeagueTable";
import { StockLeagueTable } from "../../components/StockLeagueTable";
import { StockScoringExplainer } from "../../components/StockScoringExplainer";
import { SectionTitle, ErrorState } from "../../components/States";
import { cn } from "../../lib/cn";

type LeagueFilter = "all" | "crypto" | "stocks";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hasNullGoals = (rows: StockApiTableRow[]) => rows.some((row) => row.goalsFor === null || row.goalsAgainst === null);

export default function StandingsPage() {
  const [cryptoTable, setCryptoTable] = useState<ApiTableRow[] | null>(null);
  const [stockTable, setStockTable] = useState<StockApiTableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goalsPending, setGoalsPending] = useState(false);
  const [filter, setFilter] = useState<LeagueFilter>("all");

  useEffect(() => {
    const requestedLeague = new URLSearchParams(window.location.search).get("league");
    if (requestedLeague === "crypto" || requestedLeague === "stocks" || requestedLeague === "all") setFilter(requestedLeague);
    let alive = true;
    (async () => {
      try {
        const [crypto, stocks] = await Promise.all([
          api.table(),
          (async () => {
            let rows = await stockApi.table();
            for (let attempt = 0; hasNullGoals(rows) && attempt < 3; attempt += 1) {
              if (alive) setGoalsPending(true);
              await sleep(1500);
              rows = await stockApi.table();
            }
            if (alive) setGoalsPending(hasNullGoals(rows));
            return rows;
          })(),
        ]);
        if (alive) { setCryptoTable(crypto); setStockTable(stocks); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  if (error) return <div className="py-10"><ErrorState message={error} onRetry={() => window.location.reload()} /></div>;
  const filters: { value: LeagueFilter; label: string }[] = [{ value: "all", label: "All" }, { value: "crypto", label: "Crypto" }, { value: "stocks", label: "Stocks" }];
  return <div>
    <SectionTitle title="League standings" />
    <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Standings league">
      {filters.map(({ value, label }) => <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={cn("rounded-xl px-4 py-1.5 text-sm font-semibold", filter === value ? "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] text-white" : "glass text-zinc-500 dark:text-zinc-400")}>{label}</button>)}
    </div>
    <p className="mb-6 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"><Table2 className="h-4 w-4 text-[#2E7CF6]" />Crypto and stock league tables, each ordered by points and league tiebreaks</p>
    {goalsPending && filter !== "crypto" && <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">Stock goal totals are syncing from the backend. GF and GA will appear when the scan finishes.</p>}
    <div className="space-y-8">
      {(filter === "all" || filter === "crypto") && <section><h2 className="mb-3 font-display text-base font-bold text-zinc-900 dark:text-white">Crypto league · {SEASON_DISPLAY_NAME}</h2>{cryptoTable ? cryptoTable.length ? <LeagueTable rows={cryptoTable} /> : <p className="glass rounded-2xl p-6 text-center text-sm text-zinc-500">No results yet, the table fills in as fixtures settle.</p> : <LeagueTableSkeleton rows={20} />}</section>}
      {(filter === "all" || filter === "stocks") && <section><h2 className="mb-3 font-display text-base font-bold text-zinc-900 dark:text-white">Stock league · Season 1</h2>{stockTable ? stockTable.length ? <StockLeagueTable rows={stockTable} /> : <p className="glass rounded-2xl p-6 text-center text-sm text-zinc-500">No results yet, the table fills in as fixtures settle.</p> : <LeagueTableSkeleton rows={12} />}<p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">FORFEIT marks a 3–0 result when one side had no performance. TickrPoints are unified across both leagues and appear on player profiles.</p></section>}
    </div>
    {filter !== "crypto" && <div className="mt-8"><StockScoringExplainer /></div>}
  </div>;
}
