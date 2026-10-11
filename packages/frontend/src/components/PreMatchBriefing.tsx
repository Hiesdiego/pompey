"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, BarChart3, Clock3, Trophy } from "lucide-react";
import { getTeamById } from "@tickr/shared/teams";
import { api, type ApiFixture, type ApiFixtureForm, type ApiPool, type ApiPriceHistoryPoint, type ApiTableRow, type ApiFormEntry } from "../lib/api";
import { CONTRACTS, MIN_STAKE_TICK, PREDICTION_POOL_ABI, TICK_DECIMALS } from "../lib/contracts";
import { formatSignedPct, formatTick } from "../lib/format";
import { getPublicClient } from "../hooks/usePublicClient";
import { cn } from "../lib/cn";

type PriceSeries = { values: number[]; change: number; range: number; lastAt: number };

function makeSeries(points: ApiPriceHistoryPoint[] | null): PriceSeries | null {
  const valid = (points ?? []).filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0).sort((a, b) => a.t - b.t);
  if (valid.length < 2 || Date.now() - valid[valid.length - 1].t > 30 * 60_000) return null;
  const first = valid[0].p;
  const values = valid.map((point) => ((point.p - first) / first) * 100);
  return {
    values,
    change: values[values.length - 1],
    range: Math.max(...values) - Math.min(...values),
    lastAt: valid[valid.length - 1].t,
  };
}

function formLabel(entry: ApiFormEntry): string {
  const opponent = getTeamById(entry.opponentTeamId)?.symbol ?? "opponent";
  return `${entry.result} vs ${opponent}, ${entry.goalsFor}–${entry.goalsAgainst}`;
}

function FormRow({ name, entries, ready, unavailable }: { name: string; entries: ApiFormEntry[]; ready: boolean; unavailable: boolean }) {
  return <div className="flex flex-wrap items-center justify-between gap-2">
    <span className="text-sm font-semibold">{name}</span>
    {!ready ? <span className="text-xs text-zinc-500">{unavailable ? "Recent results unavailable" : "Loading results…"}</span> : entries.length ? <div className="flex items-center gap-1.5" aria-label={`${name} recent form, newest first`}>
      {entries.map((entry) => <Link key={entry.fixtureId} href={`/match/${entry.fixtureId}`} title={formLabel(entry)} aria-label={formLabel(entry)} className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E7CF6]", entry.result === "W" ? "bg-emerald-500" : entry.result === "D" ? "bg-zinc-500" : "bg-red-500")}>{entry.result}</Link>)}
      <span className="ml-1 text-[11px] text-zinc-500">{entries.length}/5</span>
    </div> : <span className="text-xs text-zinc-500">No settled matches yet</span>}
  </div>;
}

export function PreMatchBriefing({ fixture, pool }: { fixture: ApiFixture; pool: ApiPool | null }) {
  const [table, setTable] = useState<ApiTableRow[] | null>(null);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [form, setForm] = useState<ApiFixtureForm | null>(null);
  const [formUnavailable, setFormUnavailable] = useState(false);
  const [homeHistory, setHomeHistory] = useState<ApiPriceHistoryPoint[] | null>(null);
  const [awayHistory, setAwayHistory] = useState<ApiPriceHistoryPoint[] | null>(null);
  const [feeBps, setFeeBps] = useState<number | null>(null);
  const home = fixture.home;
  const away = fixture.away;

  useEffect(() => {
    if (!home || !away) return;
    let alive = true;
    const load = () => {
      void Promise.allSettled([api.table(), api.priceHistory(home.symbol), api.priceHistory(away.symbol)]).then((results) => {
        if (!alive) return;
        setTable(results[0].status === "fulfilled" ? results[0].value : null);
        setHomeHistory(results[1].status === "fulfilled" ? results[1].value : null);
        setAwayHistory(results[2].status === "fulfilled" ? results[2].value : null);
        setSummaryLoaded(true);
      });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [home?.symbol, away?.symbol]);

  useEffect(() => {
    let alive = true;
    const load = () => void api.fixtureForm(fixture.fixtureId).then((value) => { if (alive) { setForm(value); setFormUnavailable(false); } }).catch(() => { if (alive) { setForm(null); setFormUnavailable(true); } });
    load();
    const timer = window.setInterval(load, 15_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [fixture.fixtureId]);

  useEffect(() => {
    if (!CONTRACTS.predictionPool) return;
    let alive = true;
    const load = () => void getPublicClient().readContract({
      address: CONTRACTS.predictionPool as `0x${string}`,
      abi: PREDICTION_POOL_ABI,
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
  const homeSeries = makeSeries(homeHistory);
  const awaySeries = makeSeries(awayHistory);
  const allValues = [...(homeSeries?.values ?? []), ...(awaySeries?.values ?? []), 0];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = Math.max(max - min, 0.1);
  const sparkline = (series: PriceSeries) => series.values.map((value, index) => `${index ? "L" : "M"}${(index / (series.values.length - 1)) * 240},${69 - ((value - min) / span) * 58}`).join(" ");
  const totals = pool ? [BigInt(pool.totalHome), BigInt(pool.totalDraw), BigInt(pool.totalAway)] : null;
  const totalStaked = totals?.reduce((sum, value) => sum + value, 0n) ?? 0n;
  const seed = pool ? BigInt(pool.seed ?? "0") : 0n;
  const exampleStake = BigInt(MIN_STAKE_TICK) * 10n ** BigInt(TICK_DECIMALS);
  const payout = (index: number): bigint | null => {
    if (!totals || feeBps === null || feeBps < 0 || feeBps > 10_000) return null;
    const distributable = ((totalStaked + seed + exampleStake) * BigInt(10_000 - feeBps)) / 10_000n;
    return (exampleStake * distributable) / (totals[index] + exampleStake);
  };

  return <section className="glass mb-6 rounded-3xl p-5 sm:p-6" aria-labelledby="pre-match-briefing-title">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#2E7CF6]">Pre-match briefing</p><h2 id="pre-match-briefing-title" className="mt-1 font-display text-xl font-extrabold">Know the matchup</h2></div>
      <span className="rounded-full bg-[#2E7CF6]/10 px-3 py-1 text-[11px] font-semibold text-[#1D4ED8] dark:text-[#7db3ff]">Historical context · not a prediction</span>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      {[{ team: home, row: homeRow, position: homePosition }, { team: away, row: awayRow, position: awayPosition }].map(({ team, row, position }) => <div key={team.teamId} className="rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
        <div className="flex items-center justify-between"><span className="font-display text-sm font-bold">{team.name}</span><Trophy className="h-4 w-4 text-[#2E7CF6]" /></div>
        <div className="mt-3 flex items-end gap-3"><strong className="font-display text-2xl font-black tabular-nums">{position ? `#${position}` : "—"}</strong><span className="pb-1 text-xs text-zinc-500">league position</span></div>
        <p className="mt-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{row ? `${row.won}W · ${row.drawn}D · ${row.lost}L · ${row.points} pts · GD ${row.goalDifference >= 0 ? "+" : ""}${row.goalDifference}` : summaryLoaded ? "Season record unavailable" : "Loading season record…"}</p>
      </div>)}
    </div>

    <div className="mt-3 rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-display text-sm font-bold">Recent match form</h3><span className="text-[11px] text-zinc-500">Last 5 settled · newest first</span></div>
      <div className="space-y-3"><FormRow name={home.name} entries={form?.home ?? []} ready={form?.ready ?? false} unavailable={formUnavailable} /><FormRow name={away.name} entries={form?.away ?? []} ready={form?.ready ?? false} unavailable={formUnavailable} /></div>
    </div>

    <div className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-display text-sm font-bold"><Activity className="h-4 w-4 text-[#2E7CF6]" /> Recent price movement</h3><span className="text-[11px] text-zinc-500">Binance spot · 5-minute closes · up to 24h</span></div>
      <div className="grid gap-3 sm:grid-cols-2">{[
        { team: home, series: homeSeries, color: "#1D9E75" },
        { team: away, series: awaySeries, color: "#2E7CF6" },
      ].map(({ team, series, color }) => <div key={team.teamId} className="rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
        <div className="flex items-center justify-between gap-2"><span className="font-display text-sm font-bold">{team.symbol}</span><strong className={cn("font-display text-lg tabular-nums", series && series.change < 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400")}>{series ? formatSignedPct(series.change) : "—"}</strong></div>
        {series ? <svg viewBox="0 0 240 80" preserveAspectRatio="none" className="mt-3 h-20 w-full" role="img" aria-label={`${team.name} price movement over the available 24-hour Binance history, on a shared percentage scale`}><line x1="0" x2="240" y1={69 - ((0 - min) / span) * 58} y2={69 - ((0 - min) / span) * 58} stroke="currentColor" className="text-zinc-300 dark:text-zinc-700" strokeDasharray="4 5" /><path d={sparkline(series)} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg> : <div className="mt-3 flex h-20 items-center justify-center text-xs text-zinc-500">{summaryLoaded ? "Price history unavailable" : "Loading price history…"}</div>}
        <div className="mt-2 flex flex-wrap justify-between gap-1 text-[11px] text-zinc-500"><span>{series ? `5-minute close range ${series.range.toFixed(2)}%` : summaryLoaded ? "Try again shortly" : ""}</span>{series && <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> Through {new Date(series.lastAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}</div>
      </div>)}</div>
      <p className="mt-2 text-[11px] text-zinc-500">Both charts use the same percentage scale. Binance history is market context; final match prices come from the on-chain oracle snapshots.</p>
    </div>

    <div className="mt-5 border-t border-black/[.07] pt-5 dark:border-white/[.07]">
      <h3 className="flex items-center gap-2 font-display text-sm font-bold"><BarChart3 className="h-4 w-4 text-[#2E7CF6]" /> Pool context</h3>
      <p className="mt-1 text-[11px] text-zinc-500">Stake shares show where players put TICK. They are not outcome probabilities. Seeded TICK is included in payout estimates, not in stake shares.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">{["Home", "Draw", "Away"].map((label, index) => <div key={label} className="min-w-0 rounded-xl bg-black/[.035] p-3 text-center dark:bg-white/[.04]">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
        <p className="mt-1 font-display text-lg font-black tabular-nums">{totalStaked > 0n && totals ? `${Number(totals[index] * 10_000n / totalStaked) / 100}%` : "—"}</p>
        <p className="mt-1 text-[10px] leading-tight text-zinc-500">{payout(index) === null ? "Payout unavailable" : `${formatTick(payout(index))} TICK if ${label.toLowerCase()} wins`}</p>
      </div>)}</div>
      <p className="mt-2 text-[11px] text-zinc-500">Example payout for a new {MIN_STAKE_TICK} TICK stake after the current on-chain fee. Estimates change as the pool or fee changes.</p>
    </div>
  </section>;
}
