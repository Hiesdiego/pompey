"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronUp, Clock3, Crown, Search, ShieldCheck, Trophy, X } from "lucide-react";
import { CupOutrightPanel } from "../../../components/CupStakePanel";
import { CupTeamBadge } from "../../../components/CupTeamBadge";
import { Countdown } from "../../../components/Countdown";
import { StakeDialog } from "../../../components/StakeDialog";
import { ShareButtons } from "../../../components/ShareButtons";
import { useCupBracket } from "../../../hooks/useCupBracket";
import { useCupOutrightTotals } from "../../../hooks/useCupPool";
import { useTickr } from "../../../hooks/useTickr";
import { useTickBalance } from "../../../hooks/useTickBalance";
import { CUP_TEAMS, cupConfigured, cupOutrightOpen, cupTeamName } from "../../../lib/cup";
import { formatTick } from "../../../lib/format";
import { formatUtcDateTime } from "../../../lib/utcTime";

const QUESTION = "Who will win the Crypto Price World Cup?";

export default function CupOutrightPage() {
  const { matches, status, error, reload } = useCupBracket(cupConfigured);
  const { totals, settled, reload: reloadTotals } = useCupOutrightTotals(cupConfigured);
  const { playerAddress, authenticated, login } = useTickr();
  const { balance, refresh } = useTickBalance(playerAddress);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  const finalKickoff = matches?.[62]?.kickoffMs ?? 0;
  const bettingOpen = cupOutrightOpen(matches, status?.tournamentComplete ?? false) && (!finalKickoff || now < finalKickoff);
  const totalStaked = useMemo(() => Object.values(totals ?? {}).reduce((sum, value) => sum + value, 0n), [totals]);
  const ranked = useMemo(() => [...CUP_TEAMS].sort((a, b) => {
    const left = totals?.[a.teamId] ?? 0n;
    const right = totals?.[b.teamId] ?? 0n;
    return right > left ? 1 : right < left ? -1 : a.teamId - b.teamId;
  }), [totals]);
  const matching = ranked.filter((team) => `${team.symbol} ${cupTeamName(team.teamId)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visible = query || showAll ? matching : matching.slice(0, 8);
  const featured = ranked[0];
  const featuredShare = totalStaked > 0n ? Number((totals?.[featured.teamId] ?? 0n) * 10_000n / totalStaked) / 100 : 0;
  const onStaked = () => { void reload(); void reloadTotals(); void refresh(); setSelectedTeamId(null); };

  if (!cupConfigured) return <div className="mx-auto max-w-5xl py-10"><h1 className="font-display text-2xl font-black">World Cup market unavailable</h1><p className="mt-2 text-sm text-zinc-500">The Cup contracts are not configured on this network.</p></div>;

  return <div className="mx-auto min-w-0 max-w-5xl pb-28 lg:pb-0">
    <div className="mb-4 flex items-center justify-between gap-3"><Link href="/markets" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-amber-600"><ArrowLeft className="h-4 w-4" /> All markets</Link><ShareButtons path="/markets/cup-outright" text={`${QUESTION} — predict on TICKR`} compact /></div>

    <section className="relative mb-6 overflow-hidden rounded-[1.5rem] border border-black/[.08] bg-white p-5 text-zinc-900 shadow-[0_24px_80px_rgba(0,0,0,.12)] dark:border-white/10 dark:bg-[#0c111b] dark:text-white dark:shadow-[0_24px_80px_rgba(0,0,0,.28)] sm:rounded-[2rem] sm:p-9">
      <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-amber-400/15 blur-[90px] dark:bg-amber-400/20" />
      <div className="pointer-events-none absolute -bottom-28 left-1/3 h-56 w-80 rounded-full bg-yellow-400/10 blur-[85px]" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300"><Crown className="h-3.5 w-3.5" /> World Cup champion</span><span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300">{settled ? "Settled" : status?.tournamentComplete ? "Awaiting settlement" : bettingOpen ? "Open" : "Betting closed"}</span></div>
        <h1 className="mt-6 max-w-4xl font-display text-[clamp(1.75rem,7vw,3rem)] font-black leading-[1.08] tracking-tight sm:text-5xl">{QUESTION}</h1>
        <div className="mt-5 flex items-center gap-3 text-sm text-zinc-500 dark:text-white/60"><div className="flex -space-x-2">{ranked.slice(0, 4).map((team) => <span key={team.teamId} className="rounded-full ring-2 ring-white dark:ring-[#0c111b]"><CupTeamBadge teamId={team.teamId} size={30} showName={false} /></span>)}</div><span>64 coins · one champion</span></div>
        <div className="mt-7 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-black/[.08] pt-5 dark:border-white/10 sm:flex sm:flex-wrap sm:items-center sm:gap-x-7">
          <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500 dark:text-white/40">Created by</div><div className="text-sm font-semibold">TICKR World Cup</div></div>
          <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500 dark:text-white/40">{bettingOpen ? "Closes in" : "Betting"}</div><div className="font-display text-lg font-extrabold tabular-nums">{bettingOpen ? finalKickoff ? <Countdown target={finalKickoff} /> : "TBA" : "Closed"}</div></div>
          <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500 dark:text-white/40">Total staked</div><div className="font-display text-lg font-extrabold tabular-nums">{formatTick(totalStaked)} <span className="text-xs text-zinc-500 dark:text-white/50">TICK</span></div></div>
          <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500 dark:text-white/40">Outcomes</div><div className="font-display text-lg font-extrabold">64 coins</div></div>
        </div>
      </div>
    </section>

    {error && <p className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/[.06] p-4 text-sm text-red-600">Could not refresh the tournament status. <button onClick={() => void reload()} className="font-bold underline">Retry</button></p>}

    <div className="grid min-w-0 gap-6 lg:grid-cols-3">
      <div className="order-2 min-w-0 lg:order-1 lg:col-span-2">
        <section className="glass mb-6 min-w-0 rounded-2xl p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-lg font-extrabold">Outcomes</h2><p className="mt-1 text-xs text-zinc-500">{bettingOpen ? "Select a coin to stake on the champion." : "Final shares of the outright stakes."}</p></div><span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-300">64 outcomes</span></div>
          <p className="mb-4 text-xs text-zinc-500">Pool share shows the portion of stakes backing each coin. Final payout depends on the settled pool.</p>
          <label className="mb-4 flex items-center gap-2 rounded-xl border border-black/10 bg-black/[.02] px-3 py-2 dark:border-white/10 dark:bg-white/[.03]"><Search className="h-4 w-4 text-zinc-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all 64 coins" aria-label="Search outcomes" className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400" /></label>
          <div className="space-y-2.5">{visible.map((team) => {
            const amount = totals?.[team.teamId] ?? 0n;
            const share = totalStaked > 0n ? Number(amount * 10_000n / totalStaked) / 100 : 0;
            const winner = status?.tournamentComplete && status.champion === team.teamId;
            return <button key={team.teamId} onClick={() => bettingOpen && setSelectedTeamId(team.teamId)} disabled={!bettingOpen} className={`group w-full min-w-0 rounded-2xl border p-3 text-left transition-all sm:p-4 ${winner ? "border-amber-400/60 bg-amber-500/[.1]" : "border-black/5 bg-black/[.02] dark:border-white/10 dark:bg-white/[.03]"} ${bettingOpen ? "hover:-translate-y-0.5 hover:border-amber-400/60 hover:shadow-[0_8px_28px_rgba(251,191,36,.15)]" : "cursor-default"}`}>
              <div className="flex min-w-0 items-center gap-2 sm:gap-3"><CupTeamBadge teamId={team.teamId} size={36} showName={false} /><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1"><span className="min-w-0 truncate font-display text-sm font-extrabold sm:text-base">{cupTeamName(team.teamId)}</span>{winner && <span className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-extrabold uppercase text-black">Winner</span>}</div><div className="truncate text-[11px] text-zinc-500 sm:text-xs">{team.symbol} · {formatTick(amount)} TICK</div></div><div className="shrink-0 text-right"><div className="font-display text-lg font-black tabular-nums sm:text-2xl">{share.toFixed(1)}%</div><div className="text-[10px] font-bold text-zinc-500 sm:text-[11px]">Pool share</div>{bettingOpen && <div className="hidden text-[11px] font-bold text-amber-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-amber-300 sm:block">Tap to stake →</div>}</div></div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.06]"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-[width] duration-700" style={{ width: `${share}%` }} /></div>
            </button>;
          })}{visible.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">No coins match your search.</p>}</div>
          {!query && matching.length > 8 && <button onClick={() => setShowAll((value) => !value)} className="mt-4 flex w-full items-center justify-center gap-1 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-bold text-zinc-600 hover:border-amber-400/50 dark:border-white/10 dark:text-zinc-300">{showAll ? <><ChevronUp className="h-4 w-4" /> Show less</> : <><ChevronDown className="h-4 w-4" /> Show all {matching.length} outcomes</>}</button>}
        </section>
        {status?.tournamentComplete && <section className="glass mb-6 rounded-2xl p-6"><h2 className="mb-2 font-display text-lg font-extrabold">Result</h2><div className="flex items-center gap-3"><Trophy className="h-5 w-5 text-amber-500" /><CupTeamBadge teamId={status.champion ?? 65535} size={34} /></div>{settled ? <button onClick={() => setSelectedTeamId(status.champion)} className="mt-4 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-5 py-2.5 text-sm font-bold text-black">View claim</button> : <p className="mt-3 text-sm text-zinc-500">The outright pool is awaiting settlement.</p>}</section>}
      </div>

      <aside className="order-1 min-w-0 lg:order-2">
        <div className="glass relative z-20 mb-6 min-w-0 rounded-2xl p-5 lg:sticky lg:top-4"><div className="text-center"><div className="text-[11px] font-bold uppercase tracking-[.16em] text-zinc-500">{totalStaked > 0n ? "Most backed" : "Featured outcome"}</div><div className="mt-1 font-display text-4xl font-black tabular-nums text-amber-600 dark:text-amber-300">{featuredShare.toFixed(1)}%</div><div className="mt-1 flex min-w-0 items-center justify-center gap-2 text-sm font-bold"><CupTeamBadge teamId={featured.teamId} size={22} showName={false} /><span className="min-w-0 truncate">{cupTeamName(featured.teamId)} · pool share</span></div></div><button onClick={() => bettingOpen && setSelectedTeamId(featured.teamId)} disabled={!bettingOpen} className="mt-5 hidden w-full rounded-2xl bg-gradient-to-b from-amber-400 to-amber-600 py-4 font-display text-lg font-extrabold text-black shadow-[0_0_24px_rgba(251,191,36,.35)] transition-all hover:shadow-[0_0_36px_rgba(251,191,36,.5)] active:scale-[.98] disabled:opacity-40 disabled:shadow-none lg:block">{bettingOpen ? "Stake now" : settled ? "Market settled" : "Betting closed"}</button><p className="mt-3 hidden text-center text-[11px] text-zinc-500 lg:block">Choose any outcome to place your stake.</p></div>
        <div className="glass rounded-2xl p-5"><h2 className="flex items-center gap-2 font-display text-base font-extrabold"><ShieldCheck className="h-4 w-4 text-amber-500" /> How this resolves</h2><p className="mt-3 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">The coin that wins the final is the World Cup champion. Match results come from on-chain price performance and the tournament registry. The outright pool closes when the final kicks off.</p>{finalKickoff > 0 && <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500"><Clock3 className="h-3.5 w-3.5" /> Final kickoff: {formatUtcDateTime(finalKickoff)}</p>}</div>
      </aside>
    </div>

    {selectedTeamId !== null && <StakeDialog title={`Stake on ${cupTeamName(selectedTeamId)}`} size="lg" onClose={() => setSelectedTeamId(null)}><button onClick={() => setSelectedTeamId(null)} aria-label="Close stake form" className="mb-2 ml-auto grid h-8 w-8 place-items-center rounded-full bg-black/5 dark:bg-white/10"><X className="h-4 w-4" /></button><CupOutrightPanel key={selectedTeamId} outrightOpen={bettingOpen} tournamentComplete={settled} initialTeamId={selectedTeamId} lockedTeam embedded playerAddress={playerAddress} balance={balance} authenticated={authenticated} onLogin={() => { setSelectedTeamId(null); login(); }} onStaked={onStaked} /></StakeDialog>}
    {bettingOpen && selectedTeamId === null && <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 md:bottom-0 lg:hidden"><div className="border-t border-black/10 bg-white/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur dark:border-white/10 dark:bg-[#101722]/95"><div className="mx-auto flex max-w-5xl items-center gap-3 px-4"><div className="min-w-0 flex-1"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500">Most backed</div><div className="truncate font-display text-sm font-extrabold">{cupTeamName(featured.teamId)} · {featuredShare.toFixed(1)}% share</div></div><button onClick={() => setSelectedTeamId(featured.teamId)} className="shrink-0 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-6 py-2.5 font-display text-sm font-extrabold text-black">Stake</button></div></div></div>}
  </div>;
}
