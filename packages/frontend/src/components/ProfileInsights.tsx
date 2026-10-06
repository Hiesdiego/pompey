"use client";

import Link from "next/link";
import { ArrowUpRight, BarChart3, LockKeyhole, TrendingDown, TrendingUp } from "lucide-react";
import type { SocialAnalytics } from "../lib/social";
import { TEMPLATE_NAMES } from "../lib/marketFactory";
import { formatTick } from "../lib/format";

const panel = "rounded-[1.5rem] border border-black/[.08] bg-white dark:border-white/[.09] dark:bg-[#101821]";

function signed(value: string) {
  const raw = BigInt(value);
  return `${raw > 0n ? "+" : raw < 0n ? "−" : ""}${formatTick(raw < 0n ? -raw : raw)}`;
}

function PerformanceChart({ data }: { data: SocialAnalytics["pnlCurve"] }) {
  if (!data.length) return <div className="flex h-44 items-center justify-center text-sm text-zinc-500">The first settled market will start this chart.</div>;
  const values = data.map((point) => Number(BigInt(point.cumPnlTick)) / 1e18);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = Math.max(1, max - min);
  const x = (i: number) => data.length === 1 ? 300 : 20 + i * 560 / (data.length - 1);
  const y = (v: number) => 174 - (v - min) / span * 150;
  const path = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return <div className="min-w-0"><svg viewBox="0 0 600 200" preserveAspectRatio="none" className="h-40 w-full sm:h-48" role="img" aria-label="Cumulative settled market profit and loss over time"><line x1="0" x2="600" y1={y(0)} y2={y(0)} stroke="currentColor" strokeDasharray="4 5" className="text-zinc-300 dark:text-zinc-700" /><path d={path} fill="none" stroke="#2E7CF6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="5" fill="#2E7CF6" /></svg><div className="flex justify-between gap-2 text-[11px] text-zinc-500"><span>{new Date(data[0].t).toLocaleDateString()}</span><span className="hidden sm:inline">Market resolution dates</span><span>{new Date(data[data.length - 1].t).toLocaleDateString()}</span></div></div>;
}

export function ProfileInsights({ analytics, loading, error }: { analytics: SocialAnalytics | null; loading: boolean; error: string | null }) {
  if (error) return <div className={`${panel} p-6 text-sm text-red-500`}>Private analytics could not load: {error}</div>;
  if (loading || !analytics) return <div className={`${panel} p-8 text-sm text-zinc-500`}>Loading your market performance…</div>;
  const net = BigInt(analytics.netPnlTick);
  const resolvedStake = BigInt(analytics.resolvedStakeTick);
  const roi = resolvedStake > 0n ? Number(net * 10_000n / resolvedStake) / 100 : null;
  const rate = analytics.resolvedMarkets ? analytics.profitableMarkets / analytics.resolvedMarkets * 100 : null;

  return <div className="min-w-0 space-y-5">
    <div className="flex items-start gap-2 text-xs text-zinc-500"><LockKeyhole className="h-4 w-4 shrink-0" /> Only you can view these financial figures. Results use final market payouts and are grouped by market.</div>
    {(analytics.incompleteSettlements > 0 || analytics.undatedSettlements > 0) && <div className="rounded-xl border border-amber-500/25 bg-amber-500/[.08] p-4 text-sm text-amber-800 dark:text-amber-300">{analytics.incompleteSettlements} market settlements are missing payout data. {analytics.undatedSettlements} settled markets have no resolution time and are omitted from the chart. Totals only include markets with complete payout data.</div>}
    <section className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Private performance metrics">
      <div className="min-w-0 rounded-[1.5rem] bg-[#0d224b] p-4 text-white sm:p-5"><p className="text-xs font-semibold text-white/60">Net settled P&L</p><p className="mt-3 font-display text-2xl font-black tabular-nums [overflow-wrap:anywhere] sm:text-3xl">{signed(analytics.netPnlTick)}</p><p className="mt-1 text-xs text-white/60">TICK · payouts minus stakes</p></div>
      <div className={`${panel} min-w-0 p-4 sm:p-5`}><p className="text-xs text-zinc-500">Return on settled stakes</p><p className="mt-3 font-display text-2xl font-black tabular-nums [overflow-wrap:anywhere] sm:text-3xl">{roi === null ? "—" : `${roi > 0 ? "+" : ""}${roi.toFixed(1)}%`}</p><p className="mt-1 text-xs text-zinc-500 [overflow-wrap:anywhere]">Net P&L ÷ {formatTick(resolvedStake)} TICK staked</p></div>
      <div className={`${panel} min-w-0 p-4 sm:p-5`}><p className="text-xs text-zinc-500">Profitable markets</p><p className="mt-3 font-display text-2xl font-black tabular-nums [overflow-wrap:anywhere] sm:text-3xl">{analytics.profitableMarkets}<span className="text-base text-zinc-400"> / {analytics.resolvedMarkets}</span></p><p className="mt-1 text-xs text-zinc-500">{rate === null ? "No resolved markets" : `${rate.toFixed(1)}% finished ahead`}</p></div>
      <div className={`${panel} min-w-0 p-4 sm:p-5`}><p className="text-xs text-zinc-500">Staked in open markets</p><p className="mt-3 font-display text-2xl font-black tabular-nums [overflow-wrap:anywhere] sm:text-3xl">{formatTick(analytics.openStakeTick)}</p><p className="mt-1 text-xs text-zinc-500">TICK · excluded from settled P&L</p></div>
    </section>
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,1fr)]">
      <section className={`${panel} p-5 sm:p-6`}><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-[#2E7CF6]" /><h2 className="font-display text-lg font-black">Settled performance</h2></div><p className="mt-1 text-xs text-zinc-500">Cumulative net TICK, plotted when each market resolved.</p><div className="mt-5"><PerformanceChart data={analytics.pnlCurve} /></div></section>
      <section className={`${panel} p-5 sm:p-6`}><h2 className="font-display text-lg font-black">By market format</h2><p className="mt-1 text-xs text-zinc-500">Markets with positive net payout after all stakes.</p><div className="mt-5 space-y-5">{analytics.byTemplate.length ? analytics.byTemplate.map((row) => { const pct = row.resolved ? row.profitable / row.resolved * 100 : 0; return <div key={row.templateId}><div className="flex justify-between gap-3 text-sm"><span className="font-semibold">{TEMPLATE_NAMES[row.templateId] ?? "Market"}</span><span className="tabular-nums text-zinc-500">{row.profitable}/{row.resolved}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded-full bg-[#2E7CF6]" style={{ width: `${pct}%` }} /></div></div>; }) : <p className="text-sm text-zinc-500">No resolved market positions yet.</p>}</div></section>
    </div>
    <section className={`${panel} min-w-0 overflow-hidden`}><div className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-4 sm:p-5 sm:px-6"><div className="min-w-0"><h2 className="font-display text-lg font-black">Recent settlements</h2><p className="mt-1 text-xs text-zinc-500">Net result includes every stake you placed in each market.</p></div><span className="text-xs text-zinc-500 [overflow-wrap:anywhere]">Total market volume: {formatTick(analytics.volumeTick)} TICK</span></div><div className="divide-y divide-black/[.06] dark:divide-white/[.07]">{analytics.recentResults.length ? analytics.recentResults.map((row) => { const positive = BigInt(row.netTick) >= 0n; return <Link key={row.marketId} href={`/markets/${row.marketId}`} className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)_16px] gap-x-3 gap-y-1 px-4 py-3.5 transition hover:bg-black/[.03] dark:hover:bg-white/[.03] sm:flex sm:items-center sm:px-6"><div className={`row-span-2 grid h-9 w-9 shrink-0 place-items-center self-start rounded-xl sm:self-auto ${positive ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>{positive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{TEMPLATE_NAMES[row.templateId] ?? "Market"} #{row.marketId}</p><p className="text-xs text-zinc-500 [overflow-wrap:anywhere]">{new Date(row.resolvedAt).toLocaleDateString()} · {formatTick(row.stakeTick)} TICK staked</p></div><span className={`col-start-2 row-start-2 min-w-0 text-sm font-black tabular-nums [overflow-wrap:anywhere] sm:ml-auto ${positive ? "text-emerald-600" : "text-red-500"}`}>{signed(row.netTick)} TICK</span><ArrowUpRight className="col-start-3 row-start-1 h-4 w-4 shrink-0 text-zinc-400" /></Link>; }) : <p className="px-4 py-8 text-sm text-zinc-500 sm:px-6">No market settlements yet.</p>}</div></section>
  </div>;
}
