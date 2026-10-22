"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Activity, ArrowLeft, Trophy, X } from "lucide-react";
import { useCupBracket } from "../../../../hooks/useCupBracket";
import { useTickr } from "../../../../hooks/useTickr";
import { useTickBalance } from "../../../../hooks/useTickBalance";
import { CupMatchStakePanel } from "../../../../components/CupStakePanel";
import { CupTeamBadge } from "../../../../components/CupTeamBadge";
import { TradingViewChart } from "../../../../components/TradingViewChart";
import { Countdown } from "../../../../components/Countdown";
import { StakeDialog } from "../../../../components/StakeDialog";
import { cupMatchStatus } from "../../../../components/CupMatchCard";
import { CUP_ROUNDS, CUP_TBD, cupRoundOf, cupTeamName } from "../../../../lib/cup";
import { EmptyState, ErrorState } from "../../../../components/States";

export default function CupMatchPage() {
  const params = useParams<{ id: string }>();
  const matchId = Number(params.id);
  const { matches, error, reload } = useCupBracket(true);
  const { playerAddress, authenticated, login } = useTickr();
  const { balance, refresh } = useTickBalance(playerAddress);
  const [now, setNow] = useState(() => Date.now());
  const [stakeOpen, setStakeOpen] = useState(false);
  const [chartsOpen, setChartsOpen] = useState(false);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  if (!Number.isInteger(matchId) || matchId < 0 || matchId > 62) return <EmptyState title="Match not found" message="Choose a World Cup match from the bracket." />;
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  const match = matches?.[matchId];
  if (!match) return <div className="glass h-64 animate-pulse rounded-3xl" />;
  const status = cupMatchStatus(match, now);
  const stakable = status === "upcoming" && match.teamA !== CUP_TBD && match.teamB !== CUP_TBD;
  const onStaked = () => { void reload(); void refresh(); };
  return <div>
    <Link href="/cup" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-amber-600"><ArrowLeft className="h-4 w-4" /> World Cup</Link>
    <h1 className="mb-4 font-display text-xl font-extrabold">{CUP_ROUNDS[cupRoundOf(matchId)].name} · Match {matchId + 1}</h1>
    <div className="relative mb-6 overflow-hidden rounded-[2rem] border border-amber-400/30 bg-white p-5 text-zinc-900 shadow-[0_28px_80px_rgba(180,130,30,.12)] dark:border-amber-400/20 dark:bg-[#17130b] dark:text-white sm:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(251,191,36,.16),transparent_58%)] dark:bg-[radial-gradient(ellipse_at_50%_0%,rgba(251,191,36,.22),transparent_58%)]" />
      <div className="relative mb-7 flex items-center justify-between gap-3">
        <div><p className="text-[10px] font-extrabold uppercase tracking-[.24em] text-amber-700 dark:text-amber-300">Crypto Price World Cup · {CUP_ROUNDS[cupRoundOf(matchId)].name}</p><div className="mt-2">{status === "live" ? <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-[10px] font-extrabold uppercase text-amber-700 dark:text-amber-300">● In play</span> : status === "settled" ? <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-[10px] font-extrabold uppercase text-amber-700 dark:text-amber-300">FT · Full time</span> : status === "disputed" ? <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-[10px] font-extrabold uppercase text-amber-700 dark:text-amber-300">Disputed</span> : status === "awaiting" ? <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-[10px] font-extrabold uppercase text-amber-700 dark:text-amber-300">Finalizing</span> : <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-[10px] font-extrabold uppercase text-amber-700 dark:text-amber-300">Upcoming</span>}</div></div>
        <div className="text-right"><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-white/45">{status === "upcoming" ? "Kickoff in" : status === "live" ? "Time remaining" : "Match status"}</p><p className="mt-1 font-display text-xl font-extrabold tabular-nums">{status === "upcoming" ? match.kickoffMs ? <Countdown target={match.kickoffMs} /> : "TBA" : status === "live" ? match.endMs ? <Countdown target={match.endMs} /> : "TBA" : status === "settled" ? "MATCH COMPLETE" : status === "disputed" ? "UNDER REVIEW" : "AWAITING RESULT"}</p></div>
      </div>
      <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-8">
        <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row sm:text-left"><CupTeamBadge key={match.teamA} teamId={match.teamA} size={56} showName={false} /><div className="min-w-0"><p className="truncate font-display text-sm font-extrabold sm:text-lg">{cupTeamName(match.teamA)}</p><p className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-500">HOME</p></div></div>
        <div className="min-w-[112px] rounded-2xl border border-amber-400/30 bg-amber-500/[.08] px-4 py-3 text-center shadow-inner dark:border-amber-400/20 dark:bg-amber-500/[.1] sm:min-w-[160px] sm:px-6 sm:py-4"><p className="font-display text-4xl font-black tabular-nums text-amber-700 dark:text-amber-300 sm:text-6xl">{status === "settled" ? `${match.goalsA}–${match.goalsB}` : status === "live" ? "– : –" : "VS"}</p><p className="mt-1 text-[9px] font-extrabold uppercase tracking-[.22em] text-amber-700 dark:text-amber-300">{status === "settled" ? "Final score" : status === "live" ? "Score pending" : "Kickoff soon"}</p></div>
        <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row sm:justify-end sm:text-right"><div className="min-w-0"><p className="truncate font-display text-sm font-extrabold sm:text-lg">{cupTeamName(match.teamB)}</p><p className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-500">AWAY</p></div><CupTeamBadge key={match.teamB} teamId={match.teamB} size={56} showName={false} /></div>
      </div>
      <div className="relative mt-6 flex items-center justify-between border-t border-black/[.08] pt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-white/10"><span>Real price performance</span><span>Crypto Price World Cup</span></div>
    </div>
    {match.teamA !== CUP_TBD && match.teamB !== CUP_TBD && <details className="glass group mb-6 rounded-2xl p-5" onToggle={(event) => setChartsOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-display text-sm font-bold marker:hidden"><span className="flex items-center gap-2"><Activity className="h-4 w-4 text-amber-600" /> Recent price movements</span><span className="text-xs font-semibold text-amber-700 group-open:hidden dark:text-amber-300">Show charts</span><span className="hidden text-xs font-semibold text-amber-700 group-open:inline dark:text-amber-300">Hide charts</span></summary>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div><p className="mb-2 text-xs font-bold">{cupTeamName(match.teamA)}</p>{chartsOpen && <TradingViewChart teamId={match.teamA} cup />}</div>
        <div><p className="mb-2 text-xs font-bold">{cupTeamName(match.teamB)}</p>{chartsOpen && <TradingViewChart teamId={match.teamB} cup />}</div>
      </div>
    </details>}
    {stakable && <button onClick={() => setStakeOpen(true)} className="mb-6 flex w-full items-center justify-center rounded-2xl bg-gradient-to-b from-amber-400 to-amber-600 px-4 py-3.5 font-display text-base font-extrabold text-black shadow-[0_0_28px_rgba(251,191,36,.4)]">Stake on this match</button>}
    {status === "settled" && <div className="glass mb-6 rounded-2xl border-amber-400/25 p-5 text-center"><Trophy className="mx-auto mb-2 h-5 w-5 text-amber-500" /><p className="font-bold">{cupTeamName(match.winner)} wins</p><button onClick={() => setStakeOpen(true)} className="mt-3 text-sm font-semibold text-amber-700 dark:text-amber-300">View your stake and claim</button></div>}
    {status === "disputed" && <p className="glass rounded-2xl p-5 text-sm">This match is under DAO review. Settlement is paused until the ballot resolves.</p>}
    {stakeOpen && <StakeDialog title={`Stake on ${cupTeamName(match.teamA)} vs ${cupTeamName(match.teamB)}`} onClose={() => setStakeOpen(false)}><button onClick={() => setStakeOpen(false)} aria-label="Close stake form" className="mb-2 ml-auto grid h-8 w-8 place-items-center rounded-full bg-black/5 dark:bg-white/10"><X className="h-4 w-4" /></button><CupMatchStakePanel match={match} playerAddress={playerAddress} balance={balance} authenticated={authenticated} onLogin={login} onStaked={onStaked} /></StakeDialog>}
  </div>;
}
