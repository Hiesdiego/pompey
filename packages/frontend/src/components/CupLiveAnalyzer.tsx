"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Radio, Sparkles, Zap } from "lucide-react";
import { cupTeamName } from "../lib/cup";
import { formatSignedPct } from "../lib/format";
import { formatUtcTime } from "../lib/utcTime";
import { CupTeamBadge } from "./CupTeamBadge";

type Sample = { at: number; a: number; b: number; score: [number, number] };

function linePath(samples: Sample[], side: "a" | "b", low: number, span: number) {
  if (!samples.length) return "";
  return samples.map((sample, index) => `${index ? "L" : "M"}${samples.length === 1 ? 50 : index * 100 / (samples.length - 1)},${100 - ((sample[side] - low) / span) * 100}`).join(" ");
}

export function CupLiveAnalyzer({ matchId, teamA, teamB, score, moves, prices, snapshot, fresh }: {
  matchId: number;
  teamA: number;
  teamB: number;
  score: [number, number] | null;
  moves: [number, number] | null;
  prices: [number, number] | null;
  snapshot: { startA: bigint; startB: bigint } | null;
  fresh: boolean;
}) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const latest = useRef({ score, moves });
  latest.current = { score, moves };

  useEffect(() => {
    setSamples([]);
    const sample = () => {
      const { score: currentScore, moves: currentMoves } = latest.current;
      if (!currentScore || !currentMoves) return;
      setSamples((previous) => [...previous, { at: Date.now(), a: currentMoves[0], b: currentMoves[1], score: currentScore }].slice(-60));
    };
    sample();
    const timer = window.setInterval(sample, 15_000);
    return () => window.clearInterval(timer);
  }, [matchId]);

  const values = samples.flatMap((sample) => [sample.a, sample.b, 0]);
  const low = Math.min(...values, -0.25);
  const high = Math.max(...values, 0.25);
  const span = Math.max(high - low, 0.5);
  const previous = samples.length > 1 ? samples[samples.length - 2] : null;
  const changed = previous && score && (previous.score[0] !== score[0] || previous.score[1] !== score[1]);
  const leader = score ? score[0] === score[1] ? "Level match" : `${cupTeamName(score[0] > score[1] ? teamA : teamB)} leads` : "Waiting for live prices";

  return <section className="relative mb-6 overflow-hidden rounded-[1.75rem] border border-amber-400/30 bg-[#100f1b] p-5 text-white shadow-[0_24px_70px_rgba(100,60,10,.2)] sm:p-7" aria-label="Live World Cup match analyzer">
    <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl" />
    <div className="relative flex flex-wrap items-center justify-between gap-3"><div><span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-red-300"><Radio className="h-3 w-3" /> Live match center</span><h2 className="mt-2 font-display text-xl font-black sm:text-2xl">The price battle</h2></div><div className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-amber-200/70">Projected score</p><p className="font-display text-2xl font-black tabular-nums text-amber-300">{score ? `${score[0]}–${score[1]}` : "— : —"}</p></div></div>
    <div className="relative mt-5 grid gap-3 sm:grid-cols-2">{([0, 1] as const).map((side) => { const teamId = side === 0 ? teamA : teamB; const move = moves?.[side]; return <div key={teamId} className="rounded-2xl border border-white/10 bg-white/[.045] p-4"><div className="flex items-center gap-2"><CupTeamBadge teamId={teamId} size={30} showName={false} /><span className="min-w-0 flex-1 truncate font-display text-sm font-bold">{cupTeamName(teamId)}</span><strong className={`font-display text-lg tabular-nums ${move === undefined ? "text-white/40" : move >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{move === undefined ? "—" : formatSignedPct(move)}</strong></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full transition-all duration-700 ${side === 0 ? "bg-gradient-to-r from-amber-500 to-yellow-200" : "bg-gradient-to-r from-cyan-600 to-cyan-200"}`} style={{ width: `${move === undefined ? 0 : Math.min(100, Math.max(3, Math.abs(move) * 12))}%` }} /></div><p className="mt-2 text-[11px] tabular-nums text-white/45">{prices ? `Live $${prices[side].toLocaleString("en-US")}` : "Waiting for a fresh quote"}</p></div>; })}</div>
    <div className="relative mt-4 rounded-2xl border border-white/10 bg-black/20 p-4"><div className="mb-3 flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-xs font-bold text-white/80"><Activity className="h-4 w-4 text-amber-300" /> Momentum while you watch</span><span className="text-[10px] text-white/40">0% baseline</span></div><div className="relative h-36 overflow-hidden rounded-xl bg-white/[.025]"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Recent price changes for both teams"><path d={`M0,${100 - ((0 - low) / span) * 100} H100`} stroke="white" strokeOpacity=".2" strokeDasharray="2 2" strokeWidth=".5" /><path d={linePath(samples, "a", low, span)} fill="none" stroke="#fbbf24" strokeWidth="1.7" vectorEffect="non-scaling-stroke" /><path d={linePath(samples, "b", low, span)} fill="none" stroke="#67e8f9" strokeWidth="1.7" vectorEffect="non-scaling-stroke" /></svg></div><div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] font-semibold"><span className="text-amber-300">● {cupTeamName(teamA)}</span><span className="text-cyan-300">● {cupTeamName(teamB)}</span><span className="ml-auto text-white/40">{samples.length ? `Since ${formatUtcTime(samples[0].at)}` : "Collecting live samples"}</span></div></div>
    <div className="relative mt-4 flex items-center gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[.06] p-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-300/10 text-amber-300">{changed ? <Zap className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}</span><div><p className="text-xs font-black text-amber-200">{changed ? "Projected score changed" : leader}</p><p className="text-[11px] text-white/55">{!snapshot ? "Waiting for the on-chain kickoff snapshot." : !fresh ? "Live price updates are delayed." : "Each 0.5% move can change the projected score. Final result comes from the oracle."}</p></div></div>
  </section>;
}
