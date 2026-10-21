"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Clock3, Trophy, X, Zap } from "lucide-react";
import { useCupBracket } from "../hooks/useCupBracket";
import { useCupOutrightTotals } from "../hooks/useCupPool";
import { useTickr } from "../hooks/useTickr";
import { useTickBalance } from "../hooks/useTickBalance";
import { CUP_TEAMS, cupConfigured, cupOutrightOpen, cupTeamName } from "../lib/cup";
import { formatTick } from "../lib/format";
import { Countdown } from "./Countdown";
import { CupTeamBadge } from "./CupTeamBadge";
import { CupOutrightPanel } from "./CupStakePanel";
import { StakeDialog } from "./StakeDialog";

export function CupOutrightMarketCard({ featured = false }: { featured?: boolean }) {
  const { matches, status, reload } = useCupBracket(cupConfigured);
  const { totals, settled, reload: reloadTotals } = useCupOutrightTotals(cupConfigured);
  const { playerAddress, authenticated, login } = useTickr();
  const { balance, refresh } = useTickBalance(playerAddress);
  const [quickPick, setQuickPick] = useState<number | null>(null);
  if (!cupConfigured) return null;
  const open = cupOutrightOpen(matches, status?.tournamentComplete ?? false);
  const total = Object.values(totals ?? {}).reduce((sum, value) => sum + value, 0n);
  const ranked = [...CUP_TEAMS].sort((a, b) => (totals?.[a.teamId] ?? 0n) > (totals?.[b.teamId] ?? 0n) ? -1 : (totals?.[a.teamId] ?? 0n) < (totals?.[b.teamId] ?? 0n) ? 1 : a.teamId - b.teamId);
  return <div className="group relative flex h-full flex-col"><Link href="/markets/cup-outright" className={`relative flex h-full flex-col overflow-hidden rounded-3xl border border-amber-400/35 bg-gradient-to-br from-amber-500/[.12] via-yellow-500/[.04] to-white p-5 shadow-[0_15px_50px_rgba(251,191,36,.1)] transition duration-300 hover:-translate-y-1 hover:border-amber-400/70 dark:to-[#101722] ${featured ? "sm:p-8" : ""}`}>
    <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-amber-400/15 blur-3xl" />
    <div className="relative flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.16em] text-amber-700 dark:text-amber-300"><span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-400/20"><Trophy className="h-4 w-4" /></span>World Cup outright</span><span className={`rounded-full px-3 py-1.5 text-[10px] font-extrabold uppercase ${open ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-amber-500/[.08] text-amber-700 dark:text-amber-300"}`}>{open ? "Open" : settled ? "Resolved" : "Closed"}</span></div>
    <h3 className={`relative mt-5 font-display font-bold leading-tight text-zinc-950 dark:text-white ${featured ? "text-2xl sm:text-3xl" : "text-lg"}`}>Who will win the Crypto Price World Cup?</h3>
    <p className="relative mt-2 text-sm text-zinc-500">Tournament market · 64 coins competing</p>
    <div className={`relative mt-6 grid grid-cols-2 gap-2 ${featured ? "sm:grid-cols-4" : ""}`}>
      {ranked.slice(0, featured ? 8 : 4).map((team) => { const amount = totals?.[team.teamId] ?? 0n; const pct = total > 0n ? Number(amount * 10_000n / total) / 100 : 0; return <div key={team.teamId} className={`min-w-0 rounded-2xl border p-3 ${amount > 0n && team.teamId === ranked[0].teamId ? "border-amber-500/40 bg-amber-500/[.08]" : "border-black/[.06] bg-black/[.02] dark:border-white/[.07] dark:bg-white/[.025]"}`}><div className="flex items-center gap-2"><CupTeamBadge teamId={team.teamId} size={20} showName={false} /><span className="min-w-0 flex-1 truncate text-xs font-bold text-zinc-800 dark:text-zinc-100" title={cupTeamName(team.teamId)}>{team.symbol}</span><span className="font-display text-xs font-black tabular-nums text-zinc-950 dark:text-white">{pct ? `${pct.toFixed(0)}%` : "—"}</span></div><div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-500" style={{ width: `${pct}%` }} /></div></div>; })}
    </div>
    <div className="relative mt-auto flex items-center justify-between gap-3 border-t border-black/[.06] pt-4 dark:border-white/[.07]" style={{ marginTop: featured ? 24 : 18 }}><div><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Total staked</p><p className="font-display text-sm font-extrabold tabular-nums">{formatTick(total)} <span className="text-xs text-zinc-500">TICK</span></p></div>{open && matches?.[62]?.kickoffMs ? <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><Clock3 className="h-3.5 w-3.5" /><Countdown target={matches[62].kickoffMs} /></span> : <span className="text-xs text-zinc-500">View market</span>}<span className="grid h-9 w-9 place-items-center rounded-full bg-amber-500 text-black transition-transform group-hover:translate-x-1"><ArrowUpRight className="h-4 w-4" /></span></div>
  </Link>
    {open && <div className="relative mt-2 flex flex-wrap items-center gap-1.5 px-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">{ranked.slice(0, 3).map((team) => <button key={team.teamId} onClick={() => setQuickPick(team.teamId)} className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/[.08] px-2.5 py-1 text-[11px] font-bold text-amber-700 hover:border-amber-500 dark:text-amber-300"><CupTeamBadge teamId={team.teamId} size={16} showName={false} /><span className="max-w-20 truncate">{team.symbol}</span><span>Pick</span></button>)}<span className="hidden items-center gap-1 text-[10px] font-bold uppercase text-amber-600 sm:flex"><Zap className="h-3 w-3" /> Quick</span></div>}
    {quickPick !== null && <StakeDialog title="World Cup outright winner" size="lg" onClose={() => setQuickPick(null)}><button onClick={() => setQuickPick(null)} aria-label="Close stake form" className="mb-2 ml-auto grid h-8 w-8 place-items-center rounded-full bg-black/5 dark:bg-white/10"><X className="h-4 w-4" /></button><CupOutrightPanel key={quickPick} outrightOpen={open} tournamentComplete={settled} initialTeamId={quickPick} lockedTeam embedded playerAddress={playerAddress} balance={balance} authenticated={authenticated} onLogin={login} onStaked={() => { void reload(); void reloadTotals(); void refresh(); }} /></StakeDialog>}
  </div>;
}
