"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, Trophy } from "lucide-react";
import {
  STOCK_CONTRACTS,
  STOCK_MIN_STAKE_TICK,
  STOCK_PREDICTION_POOL_ABI,
  stockApi,
  type StockApiFixture,
  type StockApiPool,
  type StockApiTableRow,
} from "../lib/stockContracts";
import { TICK_DECIMALS } from "../lib/contracts";
import { stockTeamById } from "../lib/stockTeams";
import type { ApiFixtureForm, ApiFormEntry } from "../lib/api";
import { formatTick } from "../lib/format";
import { getPublicClient } from "../hooks/usePublicClient";
import { cn } from "../lib/cn";

/**
 * StockPreMatchBriefing, pre-match briefing for stock fixtures.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/StockPreMatchBriefing.tsx
 *
 * This is the stock mirror of the crypto PreMatchBriefing in
 * ./PreMatchBriefing.tsx: same sections in the same order, league
 * position cards, recent match form, pool context with the example
 * payout for a minimum stake. Only the data source differs: the stock
 * table, the stock pool fee read on-chain, and form derived from the
 * stock fixtures list.
 *
 * Two deliberate differences from crypto, both data-driven:
 *   1. Recent form: the backend serves no
 *      /api/stocks/fixtures/:id/form endpoint (see
 *      packages/backend/src/api/stockRoutes.ts, which lists teams,
 *      fixtures, table, prices and players only). Form is therefore
 *      derived client-side from /api/stocks/fixtures: settled,
 *      non-void fixtures with goals, newest first, last 5 per team.
 *      A forfeit counts as a 3-0 result here, exactly as it does in
 *      the table. When the backend adds a form endpoint, swap this
 *      derivation for a stockApi.fixtureForm call.
 *   2. No TradingView chart section. The crypto chart widget resolves
 *      a Binance symbol from a crypto teamId; stock teamIds would
 *      resolve to the wrong assets, and tokenized stocks have no
 *      Binance spot chart. Charts stay out until a stock chart source
 *      is wired, rather than showing a wrong chart.
 */

function formLabel(entry: ApiFormEntry): string {
  const opponent = stockTeamById(entry.opponentTeamId)?.symbol ?? "opponent";
  return `${entry.result} vs ${opponent}, ${entry.goalsFor}–${entry.goalsAgainst}`;
}

function FormRow({ name, entries, ready, unavailable }: { name: string; entries: ApiFormEntry[]; ready: boolean; unavailable: boolean }) {
  return <div className="flex flex-wrap items-center justify-between gap-2">
    <span className="text-sm font-semibold">{name}</span>
    {entries.length ? <div className="flex items-center gap-1.5" aria-label={`${name} recent form, newest first`}>
      {entries.map((entry) => <Link key={entry.fixtureId} href={`/stocks/match/${entry.fixtureId}`} title={formLabel(entry)} aria-label={formLabel(entry)} className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E7CF6]", entry.result === "W" ? "bg-emerald-500" : entry.result === "D" ? "bg-zinc-500" : "bg-red-500")}>{entry.result}</Link>)}
      <span className="ml-1 text-[11px] text-zinc-500">{entries.length}/5</span>
    </div> : <span className="text-xs text-zinc-500">{!ready ? unavailable ? "Recent results unavailable" : "Loading results…" : "No settled matches yet"}</span>}
  </div>;
}

function formFromFixtures(fixtures: StockApiFixture[], fixture: StockApiFixture): ApiFixtureForm {
  const settled = fixtures
    .filter((item) => item.settled && !item.voided && item.home && item.away && item.homeGoals !== null && item.homeGoals !== undefined && item.awayGoals !== null && item.awayGoals !== undefined)
    .sort((a, b) => Date.parse(b.kickoff ?? b.windowEnd) - Date.parse(a.kickoff ?? a.windowEnd) || Number(BigInt(b.fixtureId) - BigInt(a.fixtureId)));
  const recent = (teamId: number): ApiFormEntry[] => settled
    .filter((item) => item.home?.teamId === teamId || item.away?.teamId === teamId)
    .slice(0, 5)
    .map((item) => {
      const isHome = item.home?.teamId === teamId;
      const goalsFor = isHome ? item.homeGoals! : item.awayGoals!;
      const goalsAgainst = isHome ? item.awayGoals! : item.homeGoals!;
      return {
        fixtureId: item.fixtureId,
        opponentTeamId: isHome ? item.away!.teamId : item.home!.teamId,
        result: goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D",
        goalsFor,
        goalsAgainst,
      } satisfies ApiFormEntry;
    });
  return { ready: true, home: recent(fixture.home!.teamId), away: recent(fixture.away!.teamId) };
}

export function StockPreMatchBriefing({ fixture, pool }: { fixture: StockApiFixture; pool: StockApiPool | null }) {
  const [table, setTable] = useState<StockApiTableRow[] | null>(null);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [form, setForm] = useState<ApiFixtureForm | null>(null);
  const [formUnavailable, setFormUnavailable] = useState(false);
  const [feeBps, setFeeBps] = useState<number | null>(null);
  const home = fixture.home;
  const away = fixture.away;

  useEffect(() => {
    if (!home || !away) return;
    let alive = true;
    const load = () => {
      void stockApi.table().then((rows) => {
        if (!alive) return;
        setTable(rows);
        setSummaryLoaded(true);
      }).catch(() => { if (alive) setSummaryLoaded(true); });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [home?.symbol, away?.symbol]);

  useEffect(() => {
    let alive = true;
    const load = () => void stockApi.fixtures()
      .then((fixtures) => { if (alive) { setForm(formFromFixtures(fixtures, fixture)); setFormUnavailable(false); } })
      .catch(() => { if (alive) setFormUnavailable(true); });
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [fixture.fixtureId]);

  useEffect(() => {
    if (!STOCK_CONTRACTS.predictionPool) return;
    let alive = true;
    const load = () => void getPublicClient().readContract({
      address: STOCK_CONTRACTS.predictionPool as `0x${string}`,
      abi: STOCK_PREDICTION_POOL_ABI,
      functionName: "platformFeeBps",
    }).then((value) => { if (alive) setFeeBps(Number(value)); }).catch(() => { if (alive) setFeeBps(null); });
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  if (!home || !away) return null;

  const homeRow = table?.find((row) => row.teamId === home.teamId);
  const awayRow = table?.find((row) => row.teamId === away.teamId);
  const homePosition = homeRow && table ? table.indexOf(homeRow) + 1 : null;
  const awayPosition = awayRow && table ? table.indexOf(awayRow) + 1 : null;
  const totals = pool ? [BigInt(pool.totalHome), BigInt(pool.totalDraw), BigInt(pool.totalAway)] : null;
  const totalStaked = totals?.reduce((sum, value) => sum + value, 0n) ?? 0n;
  const seed = pool ? BigInt(pool.seed ?? "0") : 0n;
  const exampleStake = BigInt(STOCK_MIN_STAKE_TICK) * 10n ** BigInt(TICK_DECIMALS);
  const payout = (index: number): bigint | null => {
    if (!totals || feeBps === null || feeBps < 0 || feeBps > 10_000) return null;
    const distributable = ((totalStaked + seed + exampleStake) * BigInt(10_000 - feeBps)) / 10_000n;
    return (exampleStake * distributable) / (totals[index] + exampleStake);
  };

  return <section className="glass mb-6 rounded-3xl p-5 sm:p-6" aria-labelledby="stock-pre-match-briefing-title">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#2E7CF6]">Pre-match briefing</p><h2 id="stock-pre-match-briefing-title" className="mt-1 font-display text-xl font-extrabold">Know the matchup</h2></div>
      <span className="rounded-full bg-[#2E7CF6]/10 px-3 py-1 text-[11px] font-semibold text-[#1D4ED8] dark:text-[#7db3ff]">Historical context · not a prediction</span>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      {[{ team: home, row: homeRow, position: homePosition }, { team: away, row: awayRow, position: awayPosition }].map(({ team, row, position }) => <div key={team.teamId} className="rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
        <div className="flex items-center justify-between"><span className="font-display text-sm font-bold">{team.name}</span><Trophy className="h-4 w-4 text-[#2E7CF6]" /></div>
        <div className="mt-3 flex items-end gap-3"><strong className="font-display text-2xl font-black tabular-nums">{position ? `#${position}` : "–"}</strong><span className="pb-1 text-xs text-zinc-500">league position</span></div>
        <p className="mt-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{row ? `${row.won}W · ${row.drawn}D · ${row.lost}L · ${row.points} pts · GD ${row.goalDifference >= 0 ? "+" : ""}${row.goalDifference}` : summaryLoaded ? "Season record unavailable" : "Loading season record…"}</p>
      </div>)}
    </div>

    <div className="mt-3 rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-display text-sm font-bold">Recent match form</h3><span className="text-[11px] text-zinc-500">Last 5 settled · newest first</span></div>
      <div className="space-y-3"><FormRow name={home.name} entries={form?.home ?? []} ready={form?.ready ?? false} unavailable={formUnavailable} /><FormRow name={away.name} entries={form?.away ?? []} ready={form?.ready ?? false} unavailable={formUnavailable} /></div>
    </div>

    <div className="mt-5 border-t border-black/[.07] pt-5 dark:border-white/[.07]">
      <h3 className="flex items-center gap-2 font-display text-sm font-bold"><BarChart3 className="h-4 w-4 text-[#2E7CF6]" /> Pool context</h3>
      <p className="mt-1 text-[11px] text-zinc-500">Stake shares show where players put TICK. They are not outcome probabilities. Seeded TICK is included in payout estimates, not in stake shares.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">{["Home", "Draw", "Away"].map((label, index) => <div key={label} className="min-w-0 rounded-xl bg-black/[.035] p-3 text-center dark:bg-white/[.04]">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
        <p className="mt-1 font-display text-lg font-black tabular-nums">{totalStaked > 0n && totals ? `${Number(totals[index] * 10_000n / totalStaked) / 100}%` : "–"}</p>
        <p className="mt-1 text-[10px] leading-tight text-zinc-500">{payout(index) === null ? "Payout unavailable" : `${formatTick(payout(index))} TICK if ${label.toLowerCase()} wins`}</p>
      </div>)}</div>
      <p className="mt-2 text-[11px] text-zinc-500">Example payout for a new {STOCK_MIN_STAKE_TICK} TICK stake after the current on-chain fee. Estimates change as the pool or fee changes.</p>
    </div>
  </section>;
}
