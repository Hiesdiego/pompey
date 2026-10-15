"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Radio, Zap } from "lucide-react";
import { PRICE_DECIMALS } from "../lib/contracts";
import { formatSignedPct } from "../lib/format";
import { cn } from "../lib/cn";
import { useCountdown } from "./Countdown";
import type { ApiFixture } from "../lib/api";
import { TradingViewChart } from "./TradingViewChart";

export interface Snapshot {
  homeStart: bigint;
  awayStart: bigint;
}

type MatchMoment = { at: number; title: string; score: string };

function pctChange(start: bigint, current: number | null): number | null {
  if (current === null || start <= 0n) return null;
  const startNum = Number(start) / 10 ** PRICE_DECIMALS;
  return startNum > 0 ? ((current - startNum) / startNum) * 100 : null;
}

function leaderOf(score: [number, number]): "home" | "away" | "draw" {
  return score[0] > score[1] ? "home" : score[1] > score[0] ? "away" : "draw";
}

function momentTitle(previous: [number, number], next: [number, number], homeName: string, awayName: string): string {
  const before = leaderOf(previous);
  const after = leaderOf(next);
  if (before !== after) {
    if (after === "draw") return "The projected match is level";
    return `${after === "home" ? homeName : awayName} takes the projected lead`;
  }
  return "Projected score changes";
}

export function LiveMatchPanel({
  fixture, snapshot, prices, pricesFresh, projectedScore, windowEndMs,
}: {
  fixture: ApiFixture;
  snapshot: Snapshot | null;
  prices: Record<string, number>;
  pricesFresh: boolean;
  projectedScore: [number, number] | null;
  windowEndMs: number | null;
}) {
  const { expired } = useCountdown(windowEndMs);
  const [moments, setMoments] = useState<MatchMoment[]>([]);
  const [pulse, setPulse] = useState<MatchMoment | null>(null);
  const [chartsOpen, setChartsOpen] = useState(false);
  const latest = useRef<{ home: number | null; away: number | null; score: [number, number] | null }>({ home: null, away: null, score: null });
  const previousScore = useRef<[number, number] | null>(null);

  const homePct = snapshot && pricesFresh && fixture.home ? pctChange(snapshot.homeStart, prices[fixture.home.symbol] ?? null) : null;
  const awayPct = snapshot && pricesFresh && fixture.away ? pctChange(snapshot.awayStart, prices[fixture.away.symbol] ?? null) : null;
  latest.current = { home: homePct, away: awayPct, score: pricesFresh ? projectedScore : null };

  useEffect(() => {
    const sample = () => {
      const { home, away, score } = latest.current;
      if (home === null || away === null || score === null) {
        previousScore.current = null;
        return;
      }
      const at = Date.now();
      const previous = previousScore.current;
      if (previous && (previous[0] !== score[0] || previous[1] !== score[1])) {
        const moment = { at, title: momentTitle(previous, score, fixture.home?.name ?? "Home", fixture.away?.name ?? "Away"), score: `${score[0]}–${score[1]}` };
        setMoments((events) => [moment, ...events].slice(0, 5));
        setPulse(moment);
      }
      previousScore.current = [...score];
    };
    sample();
    const timer = window.setInterval(sample, 5_000);
    return () => window.clearInterval(timer);
  }, [fixture]);

  useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => setPulse(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  const leader = projectedScore ? leaderOf(projectedScore) : "draw";
  const home = fixture.home;
  const away = fixture.away;
  if (!home || !away) return null;

  return (
    <div className="glass relative overflow-hidden rounded-3xl border-red-500/20! p-5 shadow-[0_0_45px_rgba(239,68,68,.07)] sm:p-6">
      <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-red-500/[.07] blur-3xl" />
      <div className="relative mb-5 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/12 px-3 py-1 font-display text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-400"><Radio className="h-3.5 w-3.5" /> LIVE</span>
        <span className="inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"><Activity className="h-3.5 w-3.5 text-[#2E7CF6]" /> Coin momentum</span>
        <span className="font-display text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{windowEndMs === null ? "—" : expired ? "Full time — awaiting result" : `Window ends in ${Math.max(0, Math.ceil((windowEndMs - Date.now()) / 60000))}m`}</span>
      </div>

      {pulse && <div key={pulse.at} className="relative mb-4 flex items-center gap-3 rounded-2xl border border-amber-400/35 bg-amber-400/10 p-3 shadow-[0_0_28px_rgba(251,191,36,.14)] motion-safe:animate-page-in" role="status">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/20 text-amber-600 dark:text-amber-300"><Zap className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><p className="text-xs font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300">Match moment</p><p className="text-sm font-semibold">{pulse.title}</p></div>
        <strong className="font-display text-xl tabular-nums">{pulse.score}</strong>
      </div>}

      <details onToggle={(event) => setChartsOpen(event.currentTarget.open)} className="group relative mb-5 rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-display text-sm font-bold marker:hidden"><span className="flex items-center gap-2"><Activity className="h-4 w-4 text-[#2E7CF6]" /> Recent price movements</span><span className="text-xs font-semibold text-[#2E7CF6] group-open:hidden">Show charts</span><span className="hidden text-xs font-semibold text-[#2E7CF6] group-open:inline">Hide charts</span></summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div><p className="mb-2 text-xs font-bold">{home.symbol} · oracle start {snapshot ? `$${(Number(snapshot.homeStart) / 10 ** PRICE_DECIMALS).toLocaleString("en-US")}` : "pending"}</p>{chartsOpen && <TradingViewChart teamId={home.teamId} />}</div>
          <div><p className="mb-2 text-xs font-bold">{away.symbol} · oracle start {snapshot ? `$${(Number(snapshot.awayStart) / 10 ** PRICE_DECIMALS).toLocaleString("en-US")}` : "pending"}</p>{chartsOpen && <TradingViewChart teamId={away.teamId} />}</div>
        </div>
      </details>

      <div className="space-y-4">
        {[
          { team: home, pct: homePct, leading: leader === "home", color: "bg-gradient-to-r from-[#1D9E75] to-[#34d399]" },
          { team: away, pct: awayPct, leading: leader === "away", color: "bg-gradient-to-r from-[#2E7CF6] to-[#8db4ff]" },
        ].map((row) => <div key={row.team.teamId}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm"><span className={cn("font-medium", row.leading ? "text-zinc-900 dark:text-white" : "text-zinc-500 dark:text-zinc-400")}>{row.team.name}{row.leading && <span className="ml-2 rounded-full bg-[#1D9E75]/12 px-1.5 py-0.5 text-[10px] font-bold text-[#0f7a55] dark:text-[#7fe0bd]">LEADING</span>}</span><span className={cn("font-display font-bold tabular-nums", row.pct === null ? "text-zinc-400" : row.pct >= 0 ? "text-[#0f7a55] dark:text-[#7fe0bd]" : "text-red-500")}>{row.pct === null ? "Waiting for price…" : formatSignedPct(row.pct)}</span></div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/8 dark:bg-white/8"><div className={cn("h-full rounded-full transition-all duration-1000 motion-reduce:transition-none", row.color)} style={{ width: `${row.pct === null ? 0 : Math.min(100, Math.max(2, Math.abs(row.pct) * 10))}%` }} /></div>
          {pricesFresh && prices[row.team.symbol] !== undefined && <p className="mt-1 font-display text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">Live: ${prices[row.team.symbol].toLocaleString("en-US")}</p>}
        </div>)}
      </div>

      <div className="mt-5 border-t border-black/[.07] pt-4 dark:border-white/[.07]">
        <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[.18em] text-zinc-500">Projected score moments · this visit</p>
        {moments.length ? <ol className="space-y-2">{moments.map((moment) => <li key={moment.at} className="flex items-center gap-3 rounded-xl bg-black/[.025] px-3 py-2 text-xs dark:bg-white/[.035]"><time className="shrink-0 tabular-nums text-zinc-500">{new Date(moment.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><span className="flex-1">{moment.title}</span><strong className="font-display tabular-nums">{moment.score}</strong></li>)}</ol> : <p className="text-xs text-zinc-500">Moments appear when the projected score changes while you watch.</p>}
      </div>
      {!snapshot && <p className="mt-4 text-center text-xs text-zinc-500">Waiting for the on-chain kickoff snapshot.</p>}
      {snapshot && !pricesFresh && <p className="mt-4 text-center text-xs text-amber-600 dark:text-amber-300">Live price updates are delayed. Projected score moments are paused.</p>}
      <p className="mt-4 text-center text-[11px] text-zinc-500">Live projections can change. The oracle records the final score at full time.</p>
    </div>
  );
}
