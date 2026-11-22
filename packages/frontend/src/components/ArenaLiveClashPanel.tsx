"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Radio, Zap } from "lucide-react";
import { formatSignedPct } from "../lib/format";
import { cn } from "../lib/cn";
import { useCountdown } from "./Countdown";
import type { ClashSummary } from "../lib/arenaContracts";
import { arenaDisplaySymbol } from "../lib/arenaContracts";
import { formatUtcTime } from "../lib/utcTime";

/**
 * ArenaLiveClashPanel, live view for meme clashes.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/ArenaLiveClashPanel.tsx
 *
 * This is the Arena mirror of StockLiveMatchPanel in
 * ./StockLiveMatchPanel.tsx: same layout, same match-moment pulse and
 * history, same per-side percent bars, same footer notes. It cannot
 * reuse the stock panel directly because that panel is typed on
 * StockApiFixture and reads live NAV keyed by stock teamId from an
 * on-chain snapshot. A clash has no teamIds and no oracle snapshot:
 * the backend clash detail carries the live percent moves directly
 * (liveMemeMovePct and liveOppMovePct, refreshed by the detail query
 * poll), so this panel takes the clash summary instead.
 *
 * Two deliberate differences, both data-driven:
 *   1. Bar scale: stock bars fill at the 3 percent volatile cap. A
 *      clash voids at a 30 percent raw move, so these bars use
 *      |pct| / 30 * 100 and fill exactly at the breaker.
 *   2. Leader: the stock panel leads on the projected score. A clash
 *      is won on the raw move, so the LEADING pill follows the
 *      strictly greater live move, and a level move leads nobody.
 *
 * The chart slot is not here: on the clash page it is the BaseStonk
 * link card, rendered by the page in the chart position.
 */

type MatchMoment = { at: number; title: string; score: string };

function leaderOfMoves(meme: number | null, opp: number | null): "meme" | "opponent" | "draw" {
  if (meme === null || opp === null) return "draw";
  return meme > opp ? "meme" : opp > meme ? "opponent" : "draw";
}

function leaderOfScore(score: [number, number]): "meme" | "opponent" | "draw" {
  return score[0] > score[1] ? "meme" : score[1] > score[0] ? "opponent" : "draw";
}

function momentTitle(previous: [number, number], next: [number, number], memeName: string, oppName: string): string {
  const before = leaderOfScore(previous);
  const after = leaderOfScore(next);
  if (before !== after) {
    if (after === "draw") return "The projected clash is level";
    return `${after === "meme" ? memeName : oppName} takes the projected lead`;
  }
  return "Projected score changes";
}

export function ArenaLiveClashPanel({
  clash, projectedScore, windowEndMs,
}: {
  clash: ClashSummary;
  projectedScore: [number, number] | null;
  windowEndMs: number | null;
}) {
  const { expired } = useCountdown(windowEndMs);
  const [moments, setMoments] = useState<MatchMoment[]>([]);
  const [pulse, setPulse] = useState<MatchMoment | null>(null);
  const latest = useRef<{ meme: number | null; opp: number | null; score: [number, number] | null }>({ meme: null, opp: null, score: null });
  const previousScore = useRef<[number, number] | null>(null);

  const memePct = clash.liveMemeMovePct;
  const oppPct = clash.liveOppMovePct;
  latest.current = { meme: memePct, opp: oppPct, score: projectedScore };

  const memeName = clash.memeName ?? arenaDisplaySymbol(clash.memeSymbol);
  const oppName = clash.opponentName ?? arenaDisplaySymbol(clash.opponentSymbol);

  useEffect(() => {
    const sample = () => {
      const { meme, opp, score } = latest.current;
      if (meme === null || opp === null || score === null) {
        previousScore.current = null;
        return;
      }
      const at = Date.now();
      const previous = previousScore.current;
      if (previous && (previous[0] !== score[0] || previous[1] !== score[1])) {
        const moment = { at, title: momentTitle(previous, score, memeName, oppName), score: `${score[0]}–${score[1]}` };
        setMoments((events) => [moment, ...events].slice(0, 5));
        setPulse(moment);
      }
      previousScore.current = [...score];
    };
    sample();
    const timer = window.setInterval(sample, 5_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clash.id]);

  useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => setPulse(null), 6_000);
    return () => clearTimeout(timer);
  }, [pulse]);

  const leader = leaderOfMoves(memePct, oppPct);
  const breakerWatch =
    (memePct !== null && Math.abs(memePct) >= 30) || (oppPct !== null && Math.abs(oppPct) >= 30);

  return (
    <div className="glass relative overflow-hidden rounded-3xl border-red-500/20! p-5 shadow-[0_0_45px_rgba(239,68,68,.07)] sm:p-6">
      <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-red-500/[.07] blur-3xl" />
      <div className="relative mb-5 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/12 px-3 py-1 font-display text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-400"><Radio className="h-3.5 w-3.5" /> LIVE</span>
        <span className="inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"><Activity className="h-3.5 w-3.5 text-[#2E7CF6]" /> Clash momentum</span>
        <span className="font-display text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{windowEndMs === null ? "–" : expired ? "Window ended, awaiting result" : `Window ends in ${Math.max(0, Math.ceil((windowEndMs - Date.now()) / 60000))}m`}</span>
      </div>

      {pulse && <div key={pulse.at} className="relative mb-4 flex items-center gap-3 rounded-2xl border border-amber-400/35 bg-amber-400/10 p-3 shadow-[0_0_28px_rgba(251,191,36,.14)] motion-safe:animate-page-in" role="status">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/20 text-amber-600 dark:text-amber-300"><Zap className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><p className="text-xs font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300">Clash moment</p><p className="text-sm font-semibold">{pulse.title}</p></div>
        <strong className="font-display text-xl tabular-nums">{pulse.score}</strong>
      </div>}

      <div className="space-y-4">
        {[
          { name: memeName, pct: memePct, leading: leader === "meme", color: "bg-gradient-to-r from-[#1D9E75] to-[#34d399]" },
          { name: oppName, pct: oppPct, leading: leader === "opponent", color: "bg-gradient-to-r from-[#2E7CF6] to-[#8db4ff]" },
        ].map((row) => <div key={row.name}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm"><span className={cn("font-medium", row.leading ? "text-zinc-900 dark:text-white" : "text-zinc-500 dark:text-zinc-400")}>{row.name}{row.leading && <span className="ml-2 rounded-full bg-[#1D9E75]/12 px-1.5 py-0.5 text-[10px] font-bold text-[#0f7a55] dark:text-[#7fe0bd]">LEADING</span>}</span><span className={cn("font-display font-bold tabular-nums", row.pct === null ? "text-zinc-400" : row.pct >= 0 ? "text-[#0f7a55] dark:text-[#7fe0bd]" : "text-red-500")}>{row.pct === null ? "Waiting for price…" : formatSignedPct(row.pct)}</span></div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/8 dark:bg-white/8"><div className={cn("h-full rounded-full transition-all duration-1000 motion-reduce:transition-none", row.color)} style={{ width: `${row.pct === null ? 0 : Math.min(100, Math.max(2, Math.abs(row.pct) / 30 * 100))}%` }} /></div>
        </div>)}
      </div>

      {breakerWatch && <p className="mt-4 text-center text-sm text-amber-600 dark:text-amber-300">Breaker watch: a raw move of 30% or more on either side at the window end snapshot voids this clash and stakes refund 1:1.</p>}

      <div className="mt-5 border-t border-black/[.07] pt-4 dark:border-white/[.07]">
        <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[.18em] text-zinc-500">Projected score moments · this visit</p>
        {moments.length ? <ol className="space-y-2">{moments.map((moment) => <li key={moment.at} className="flex items-center gap-3 rounded-xl bg-black/[.025] px-3 py-2 text-xs dark:bg-white/[.035]"><time className="shrink-0 tabular-nums text-zinc-500">{formatUtcTime(moment.at)}</time><span className="flex-1">{moment.title}</span><strong className="font-display tabular-nums">{moment.score}</strong></li>)}</ol> : <p className="text-xs text-zinc-500">Moments appear when the projected score changes while you watch.</p>}
      </div>
      {memePct === null && oppPct === null && <p className="mt-4 text-center text-xs text-zinc-500">Waiting for the window start snapshot prices.</p>}
      <p className="mt-4 text-center text-[11px] text-zinc-500">Staking closed at window start. Live projections can change. The result settles from the snapshot prices at window end.</p>
    </div>
  );
}
