"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Activity, ArrowLeft, Trophy, X } from "lucide-react";
import { useCupBracket } from "../../../../hooks/useCupBracket";
import { useTickr } from "../../../../hooks/useTickr";
import { useTickBalance } from "../../../../hooks/useTickBalance";
import { useCupMatchPool } from "../../../../hooks/useCupPool";
import { CupMatchStakePanel } from "../../../../components/CupStakePanel";
import { CupTeamBadge } from "../../../../components/CupTeamBadge";
import { TradingViewChart } from "../../../../components/TradingViewChart";
import { Countdown } from "../../../../components/Countdown";
import { StakeDialog } from "../../../../components/StakeDialog";
import { cupMatchStatus } from "../../../../components/CupMatchCard";
import { CUP_FEE_BPS, CUP_ROUNDS, CUP_TBD, cupRoundOf, cupTeamName } from "../../../../lib/cup";
import { EmptyState, ErrorState } from "../../../../components/States";
import { formatTick } from "../../../../lib/format";
import { ShareButtons } from "../../../../components/ShareButtons";

export default function CupMatchPage() {
  const params = useParams<{ id: string }>();
  const matchId = Number(params.id);
  const { matches, error, reload } = useCupBracket(true);
  const { playerAddress, authenticated, login } = useTickr();
  const { balance, refresh } = useTickBalance(playerAddress);
  const { pool, myStakeA, myStakeB, reload: reloadPool } = useCupMatchPool(Number.isInteger(matchId) && matchId >= 0 && matchId <= 62 ? matchId : null, playerAddress);
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
  const onStaked = () => { void reload(); void reloadPool(); void refresh(); setStakeOpen(false); };
  const stakeA = myStakeA ?? 0n;
  const stakeB = myStakeB ?? 0n;
  const myTotal = stakeA + stakeB;
  const poolTotal = pool ? pool.totalA + pool.totalB + pool.seed : 0n;
  const projected = (stake: bigint, sideTotal: bigint) => stake > 0n && sideTotal > 0n && poolTotal > 0n
    ? stake * (poolTotal * BigInt(10_000 - CUP_FEE_BPS) / 10_000n) / sideTotal : 0n;
  return <div>
    <Link href="/cup" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-amber-600"><ArrowLeft className="h-4 w-4" /> World Cup</Link>
    <div className="mb-4 flex items-center justify-between gap-3">
      <h1 className="font-display text-xl font-extrabold">{CUP_ROUNDS[cupRoundOf(matchId)].name} · Match {matchId + 1}</h1>
      {match.teamA !== CUP_TBD && match.teamB !== CUP_TBD && <ShareButtons path={`/cup/match/${match.matchId}`} text={`${cupTeamName(match.teamA)} vs ${cupTeamName(match.teamB)} — Crypto Price World Cup on TICKR`} compact />}
    </div>
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
    {playerAddress && myTotal > 0n && <section className="glass mb-6 rounded-2xl p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-amber-700 dark:text-amber-300">Stake tracker</p><h2 className="mt-1 font-display text-lg font-extrabold">Your position</h2></div><div className="text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Total staked</p><p className="font-display text-lg font-extrabold tabular-nums">{formatTick(myTotal)} TICK</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2">{([0, 1] as const).map((side) => {
        const stake = side === 0 ? stakeA : stakeB;
        if (stake === 0n) return null;
        const teamId = side === 0 ? match.teamA : match.teamB;
        const winning = status === "settled" && match.winner === teamId;
        return <div key={side} className="rounded-xl border border-amber-400/20 bg-amber-500/[.05] p-4"><div className="flex items-center gap-2"><CupTeamBadge teamId={teamId} size={28} showName={false} /><span className="font-display text-sm font-extrabold">{cupTeamName(teamId)}</span>{status === "settled" && <span className="ml-auto text-xs font-bold text-amber-700 dark:text-amber-300">{winning ? "Won" : "Lost"}</span>}</div><p className="mt-3 text-sm tabular-nums">{formatTick(stake)} TICK staked</p><p className="mt-1 text-xs text-zinc-500">{status === "settled" ? winning ? "Estimated payout" : "Final payout" : "Projected payout"}: <span className="font-bold tabular-nums text-zinc-800 dark:text-zinc-200">{formatTick(status === "settled" && !winning ? 0n : projected(stake, side === 0 ? pool?.totalA ?? 0n : pool?.totalB ?? 0n))} TICK</span></p></div>;
      })}</div>
      <p className="mt-3 text-xs text-zinc-500">{status === "settled" ? "Payout estimate uses the settled pool; claim from the match result below." : "Projection uses the current pool after fees. Final payout can change as others stake."}</p>
    </section>}
    {status === "settled" && <div className="glass mb-6 rounded-2xl border-amber-400/25 p-5 text-center"><Trophy className="mx-auto mb-2 h-5 w-5 text-amber-500" /><p className="font-bold">{cupTeamName(match.winner)} wins</p><button onClick={() => setStakeOpen(true)} className="mt-3 text-sm font-semibold text-amber-700 dark:text-amber-300">View your stake and claim</button></div>}
    {status === "disputed" && <p className="glass rounded-2xl p-5 text-sm">This match is under DAO review. Settlement is paused until the ballot resolves.</p>}
    {stakeOpen && <StakeDialog title={`${cupTeamName(match.teamA)} vs ${cupTeamName(match.teamB)}`} onClose={() => setStakeOpen(false)}><div className="mb-4 flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-amber-700 dark:text-amber-300">Your prediction</p><h3 className="mt-1 truncate font-display text-lg font-extrabold">{cupTeamName(match.teamA)} vs {cupTeamName(match.teamB)}</h3></div><button onClick={() => setStakeOpen(false)} aria-label="Close" className="shrink-0 rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-black/5 dark:hover:bg-white/10"><X className="h-5 w-5" /></button></div><CupMatchStakePanel match={match} bare playerAddress={playerAddress} balance={balance} authenticated={authenticated} onLogin={() => { setStakeOpen(false); login(); }} onStaked={onStaked} /></StakeDialog>}
  </div>;
}
