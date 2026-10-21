"use client";

import Link from "next/link";
import { Clock } from "lucide-react";
import type { CupMatch } from "../hooks/useCupBracket";
import { CUP_STATE, CUP_TBD, cupRoundOf, CUP_ROUNDS, cupTeamName, cupScheduledKickoff } from "../lib/cup";
import { Countdown } from "./Countdown";
import { CupTeamBadge } from "./CupTeamBadge";

export function cupMatchStatus(match: CupMatch, now: number): "upcoming" | "live" | "awaiting" | "settled" | "disputed" {
  if (match.state === CUP_STATE.Disputed) return "disputed";
  if (match.state === CUP_STATE.Settled) return "settled";
  if (match.kickoffMs && now >= match.kickoffMs) return match.endMs && now >= match.endMs ? "awaiting" : "live";
  return "upcoming";
}

export function CupMatchCard({ match, now, onStake }: { match: CupMatch; now: number; onStake?: (side: 0 | 1) => void }) {
  const status = cupMatchStatus(match, now);
  const scored = status === "settled" || status === "live";
  const stakable = status === "upcoming" && match.teamA !== CUP_TBD && match.teamB !== CUP_TBD;
  const scheduledKickoff = match.kickoffMs || cupScheduledKickoff(match.matchId);
  return <div className="group flex h-full flex-col"><Link href={`/cup/match/${match.matchId}`} className={`glass block flex-1 rounded-2xl !border-amber-400/25 p-4 transition duration-300 hover:-translate-y-0.5 hover:!border-amber-400/60 hover:shadow-[0_12px_40px_rgba(251,191,36,.18)] ${status === "live" ? "!border-amber-400/60 shadow-[0_0_24px_rgba(251,191,36,.18)]" : ""}`}>
    <div className="mb-3 flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">{CUP_ROUNDS[cupRoundOf(match.matchId)].name} · Match {match.matchId + 1}</span>
      {status === "live" ? <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 font-display text-xs font-bold text-amber-700 dark:text-amber-300"><i className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /> LIVE</span>
        : status === "settled" ? <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-display text-xs font-bold text-amber-700 dark:text-amber-300">FT</span>
        : status === "disputed" ? <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">Disputed</span>
        : status === "awaiting" ? <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600">Awaiting result</span>
        : scheduledKickoff && scheduledKickoff > now ? <span title={match.kickoffMs ? "Confirmed on-chain kickoff" : "Scheduled start — confirmed on-chain before kickoff"} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${match.kickoffMs ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "border border-dashed border-zinc-400/70 text-zinc-500 dark:border-zinc-500/70 dark:text-zinc-400"}`}><Clock className="h-3 w-3" /><Countdown target={scheduledKickoff} /></span>
        : <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-white/8">TBA</span>}
    </div>
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1">
      <div className="flex min-w-0 flex-col items-center gap-1 text-center"><CupTeamBadge key={match.teamA} teamId={match.teamA} showName={false} /><span className="w-full truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{cupTeamName(match.teamA)}</span></div>
      <span className={`font-display font-extrabold tabular-nums ${scored ? "text-xl text-zinc-950 dark:text-white" : "text-[11px] uppercase tracking-[.18em] text-zinc-400"}`}>{status === "settled" ? `${match.goalsA}–${match.goalsB}` : status === "live" ? "– : –" : "VS"}</span>
      <div className="flex min-w-0 flex-col items-center gap-1 text-center"><CupTeamBadge key={match.teamB} teamId={match.teamB} showName={false} /><span className="w-full truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{cupTeamName(match.teamB)}</span></div>
    </div>
  </Link>{stakable && onStake && <div className="relative mt-2 flex flex-wrap gap-1.5 px-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">{([0, 1] as const).map((side) => <button key={side} onClick={() => onStake(side)} className="rounded-full border border-amber-500/30 bg-amber-500/[.08] px-2.5 py-1 text-[11px] font-bold text-amber-700 hover:border-amber-500 dark:text-amber-300">{side === 0 ? cupTeamName(match.teamA) : cupTeamName(match.teamB)} · Pick</button>)}</div>}</div>;
}
