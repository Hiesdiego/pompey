/**
 * /cup — CRYPTO PRICE WORLD CUP home.
 *
 * Tournament-gold theme. Round tabs (R64 → Final) with draws / upcoming /
 * live / FT cards, per-match binary staking, the outright champion pool,
 * and the rules section with full DAO disclosure.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Gavel, ShieldCheck, Swords, Trophy, Users, X } from "lucide-react";
import { useCupBracket } from "../../hooks/useCupBracket";
import { CupMatchCard } from "../../components/CupMatchCard";
import { Countdown } from "../../components/Countdown";
import { CupFavoritePicker } from "../../components/CupFavoritePicker";
import { CupMatchStakePanel } from "../../components/CupStakePanel";
import { StakeDialog } from "../../components/StakeDialog";
import { useTickr } from "../../hooks/useTickr";
import { useTickBalance } from "../../hooks/useTickBalance";
import { SectionTitle, ErrorState, EmptyState, SkeletonCards } from "../../components/States";
import {
  CUP_ROUNDS,
  CUP_STATE,
  CUP_TEAM_SYMBOLS,
  CUP_TOURNAMENT_START,
  cupConfigured,
} from "../../lib/cup";
import { cn } from "../../lib/cn";

const ROUND_DATES = ["Nov 1–6", "Nov 7–9", "Nov 10–11", "Nov 12", "Nov 13", "Nov 15"];

export default function CupPage() {
  const { matches, status, error, reload } = useCupBracket(true);
  const { authenticated, login, playerAddress } = useTickr();
  const { balance, refresh } = useTickBalance(playerAddress);
  const [round, setRound] = useState(0);
  const [stakePick, setStakePick] = useState<{ matchId: number; side: 0 | 1 } | null>(null);
  // Refresh the display clock whenever the bracket polls (30s).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
  }, [matches]);

  const roundMatches = useMemo(() => {
    if (!matches) return [];
    const r = CUP_ROUNDS[round];
    return matches.filter((m) => m.matchId >= r.start && m.matchId <= r.end);
  }, [matches, round]);

  // Default to the first round with an undecided match (once, on load).
  const defaultedRef = useRef(false);
  useEffect(() => {
    if (!matches || defaultedRef.current) return;
    defaultedRef.current = true;
    const firstOpen = CUP_ROUNDS.findIndex((r) =>
      matches.some(
        (m) => m.matchId >= r.start && m.matchId <= r.end && m.state !== CUP_STATE.Settled
      )
    );
    if (firstOpen > 0) setRound(firstOpen);
  }, [matches]);

  if (!cupConfigured) {
    return (
      <div className="py-10">
        <EmptyState
          title="World Cup not configured"
          message="The cup contract addresses aren't set yet — fill in NEXT_PUBLIC_CUP_* in .env.local."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-10">
        <CupFavoritePicker address={playerAddress} authenticated={authenticated} login={login} />
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────── */}
      <div className="relative mb-8 overflow-hidden rounded-3xl border border-amber-400/20 bg-gradient-to-br from-amber-500/15 via-yellow-500/5 to-transparent p-8 sm:p-10">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-300">
            <Trophy className="h-3.5 w-3.5" /> Nov 1–15 · 64 coins · single elimination
          </div>
          <h1 className="font-display text-3xl font-black tracking-tight text-zinc-900 dark:text-white sm:text-5xl">
            Crypto Price <span className="bg-gradient-to-b from-amber-300 to-amber-600 bg-clip-text text-transparent">World Cup</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300 sm:text-base">
            64 cryptocurrencies. 63 knockout ties. One-hour matches decided by price
            performance — 1 goal per 0.5% move. Back match winners or call the
            champion.
          </p>
          {now < CUP_TOURNAMENT_START && <div className="mt-6 inline-flex flex-wrap items-center gap-4 rounded-2xl border border-amber-300/40 bg-zinc-950 px-5 py-4 text-white shadow-[0_16px_48px_rgba(180,110,0,.2)] sm:px-7"><span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-400/15 text-amber-300"><Trophy className="h-6 w-6" /></span><div><p className="text-[10px] font-extrabold uppercase tracking-[.22em] text-amber-300">Kickoff · Nov 1, 10:00 UTC</p><p className="mt-1 font-display text-2xl font-black tracking-tight tabular-nums sm:text-3xl"><Countdown target={CUP_TOURNAMENT_START} /></p></div><span className="text-xs font-semibold text-zinc-400">until the tournament begins</span></div>}
          <div className="mt-4 flex flex-wrap gap-4 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <Swords className="h-4 w-4 text-amber-500" /> 63 matches
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4 text-amber-500" /> 64 teams · 4 pots
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-amber-500" /> Nov 1–15
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-amber-500" /> DAO-disputed · no owner calls
            </span>
          </div>
          {status && (
            <div className="mt-4">
              {!status.drawExecuted ? (
                <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-300">
                  Awaiting the draw
                </span>
              ) : status.tournamentComplete && status.champion !== null ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-400/20 px-4 py-1.5 text-sm font-black text-amber-700 dark:text-amber-300">
                  <Trophy className="h-4 w-4" /> Champions: {CUP_TEAM_SYMBOLS[status.champion]}
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-300">
                  Tournament live
                </span>
              )}
            </div>
          )}
          <CupFavoritePicker address={playerAddress} authenticated={authenticated} login={login} />
        </div>
      </div>

      {/* ── Round tabs ───────────────────────────────────── */}
      {!matches ? (
        <SkeletonCards cards={6} />
      ) : (
        <>
          <div className="glass mb-6 flex items-center gap-2 overflow-x-auto rounded-2xl p-2">
            {CUP_ROUNDS.map((r, i) => {
              const list = matches.filter((m) => m.matchId >= r.start && m.matchId <= r.end);
              const open = list.some((m) => m.state !== CUP_STATE.Settled);
              return (
                <button
                  key={r.short}
                  onClick={() => {
                    setRound(i);
                  }}
                  className={cn(
                    "relative shrink-0 rounded-xl px-4 py-2 font-display text-sm font-bold transition-all active:scale-95",
                    i === round
                      ? "bg-gradient-to-b from-amber-400 to-amber-600 text-black shadow-[0_0_16px_rgba(251,191,36,.45)]"
                      : "bg-black/5 text-zinc-500 hover:bg-amber-400/10 hover:text-amber-700 dark:bg-white/5 dark:text-zinc-400 dark:hover:text-amber-300"
                  )}
                  title={`${r.name} · ${ROUND_DATES[i]}`}
                >
                  {r.short}
                  <span className="ml-1.5 hidden text-[10px] font-medium opacity-70 sm:inline">
                    {ROUND_DATES[i]}
                  </span>
                  {open && i !== round && (
                    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(251,191,36,.8)]" />
                  )}
                </button>
              );
            })}
          </div>

          <SectionTitle
            title={CUP_ROUNDS[round].name}
            action={
              <span className="text-xs font-semibold text-zinc-400">
                {ROUND_DATES[round]} · {roundMatches.length} ties
              </span>
            }
          />

          {roundMatches.length === 0 ? (
            <EmptyState title="No ties yet" message="The draw hasn't placed teams in this round." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {roundMatches.map((m) => (
                <CupMatchCard
                  key={m.matchId}
                  match={m}
                  now={now}
                  onStake={(side) => setStakePick({ matchId: m.matchId, side })}
                />
              ))}
            </div>
          )}

        </>
      )}

      {/* ── Rules ──────────────────────────────────────── */}
      {stakePick && matches?.[stakePick.matchId] && <StakeDialog title="Stake on World Cup match" onClose={() => setStakePick(null)}><button onClick={() => setStakePick(null)} aria-label="Close stake form" className="mb-2 ml-auto grid h-8 w-8 place-items-center rounded-full bg-black/5 dark:bg-white/10"><X className="h-4 w-4" /></button><CupMatchStakePanel key={`${stakePick.matchId}-${stakePick.side}`} match={matches[stakePick.matchId]} initialSide={stakePick.side} playerAddress={playerAddress} balance={balance} authenticated={authenticated} onLogin={login} onStaked={() => { void reload(); void refresh(); }} /></StakeDialog>}
      <div className="mt-12 rounded-3xl border border-amber-400/20 bg-amber-500/[.04] p-6 sm:p-8">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-black text-zinc-900 dark:text-white">
          <Gavel className="h-5 w-5 text-amber-500" /> Rules & fair play
        </h2>
        <ul className="grid gap-3 text-sm text-zinc-600 dark:text-zinc-300 sm:grid-cols-2">
          <li><strong className="text-zinc-900 dark:text-white">Scoring.</strong> 1 goal per 0.5% price move over the 1-hour match, half-up rounding. Negative moves count for the opponent — every tie produces a winner.</li>
          <li><strong className="text-zinc-900 dark:text-white">Tiebreak.</strong> Level on goals? The better raw price move advances (best-mover rule).</li>
          <li><strong className="text-zinc-900 dark:text-white">Pools.</strong> Parimutuel pools. Min stake 10 TICK.</li>
          <li><strong className="text-zinc-900 dark:text-white">Staking windows.</strong> Match pools open once both teams are known and close at kickoff. The outright champion pool stays open until the final kicks off.</li>
          <li><strong className="text-zinc-900 dark:text-white">Circuit breaker.</strong> A ±30% raw price spike by either team inside the match window pauses settlement — scorelines alone never trigger it.</li>
          <li><strong className="text-zinc-900 dark:text-white">DAO disputes — full disclosure.</strong> When the breaker trips, ANYONE may open a 24-hour ballot (100 TICK fee to the treasury, one vote per wallet). Quorum is 5 votes; simple majority decides; a tie or no quorum means the result stands. A manipulated verdict disqualifies the offender and the opponent advances. The tournament owner cannot vote, cannot veto, and cannot decide — manipulation calls are DAO-only.</li>
        </ul>
      </div>
    </div>
  );
}
