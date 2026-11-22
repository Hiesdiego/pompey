/**
 * MemeClashCard, the clash card for the home page, the fixtures board
 * and the markets board. Rebuilt for the v2 delivery on the
 * StockFixtureCard shell, per the parity rule: a new surface reuses the
 * existing equivalent surface exactly.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/MemeClashCard.tsx
 *
 * Shell mapping to StockFixtureCard (see the delivery report for the
 * full list):
 *   - Outer wrapper: flex h-full flex-col, then a Link with classes
 *     "glass card-interactive group block flex-1 rounded-2xl p-4",
 *     with the same live modifier (!border-red-500/40 plus the red
 *     glow shadow) when the clash is in play.
 *   - Header row: mb-3 flex items-center justify-between, the left
 *     label in the same text-[11px] font-semibold uppercase
 *     tracking-widest zinc style ("Memes · Clash", with the cup round
 *     appended for cup ties), the status pill on the right.
 *   - Status pills reuse the StockFixtureCard pill classes verbatim:
 *     the live pill with the ping dot, the upcoming pill with Clock
 *     plus Countdown, the settled pill in the FT style, and the void
 *     pill in the VOID style. Settled reads "Yes wins" or "No wins"
 *     where the stock pill reads FT, because a clash has no draw.
 *   - Team line: the same grid grid-cols-[1fr_auto_1fr] items-center
 *     gap-2 py-1 row, logo at size 34 over the truncated team name on
 *     each side, centre cell in the same font-display treatment: the
 *     scoreline with an en dash at text-xl when live or settled, and
 *     VS in the small tracked style before the window. A voided clash
 *     shows VOID in the centre cell, mirroring the stock void copy
 *     under the team line.
 *   - Under the team line: the outperform question, then the window
 *     timing lines in the same text-xs font-semibold zinc style the
 *     stock card uses for its kickoff line.
 *   - Yes and No pool split: two rows in the StockMarketCard outcome
 *     row style (rounded-2xl border px-4 py-3, multiplier on the
 *     right, share bar under), because the stock fixture card has no
 *     pool rows and the clash is a Yes and No market.
 *   - Quick stake: the StockFixtureCard pattern is chips under the
 *     card while staking is open, and nothing once it closes. A clash
 *     stakes through the MemeClashFactory stake call, not through the
 *     league pool or the market factory the QuickStakeSheet writes to,
 *     so there is no sheet here: staking happens on the clash detail
 *     page, like stock price targets. The card follows the pattern in
 *     time only: while staking is open it shows the countdown to the
 *     window start and the staking note, and once the window starts
 *     staking is closed and the note goes away.
 *
 * Scoreline: clashScoreline from lib/arenaContracts (1 goal per
 * 0.5 percent, half-up, no-negative), falling back to the backend live
 * goals when the percent moves are missing, exactly the fallback order
 * the first delivery used. Window times are UTC via lib/utcTime.
 * The card links to /arena/clash/[id].
 */

"use client";

import Link from "next/link";
import { Clock, Trophy, Zap } from "lucide-react";
import { cn } from "../lib/cn";
import {
  arenaClashQuestionFor,
  arenaDisplaySymbol,
  clashScoreline,
  isBlitzWindow,
  type ClashSummary,
} from "../lib/arenaContracts";
import { formatSignedPct } from "../lib/format";
import { formatMarketOdds } from "../lib/marketOdds";
import { formatUtcDateTime } from "../lib/utcTime";
import { Countdown } from "./Countdown";
import { MemeLogo } from "./MemeLogo";
import { StockLogo } from "./StockLogo";

export type MemeClashStatus = "upcoming" | "inplay" | "settled" | "voided";

export function memeClashStatus(clash: ClashSummary): MemeClashStatus {
  return clash.status;
}

function StatusPill({ clash }: { clash: ClashSummary }) {
  switch (clash.status) {
    case "inplay":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/12 px-2.5 py-0.5 font-display text-xs font-bold text-red-600 shadow-[0_0_14px_rgba(239,68,68,.3)] dark:bg-red-500/15 dark:text-red-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          LIVE
        </span>
      );
    case "upcoming":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#2E7CF6]/10 px-2.5 py-0.5 text-xs font-semibold text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]">
          <Clock className="h-3 w-3" />
          <Countdown target={clash.windowStart * 1000} />
        </span>
      );
    case "settled":
      return (
        <span className="rounded-full bg-[#2E7CF6]/10 px-2.5 py-0.5 font-display text-xs font-bold text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]">
          {clash.winner === 0 ? "Yes wins" : "No wins"}
        </span>
      );
    case "voided":
      return (
        <span className="rounded-full bg-zinc-500/12 px-2.5 py-0.5 font-display text-xs font-bold text-zinc-500 dark:bg-zinc-500/15 dark:text-zinc-300">
          VOID
        </span>
      );
  }
}

export function MemeClashCard({ clash }: { clash: ClashSummary }) {
  const status = memeClashStatus(clash);
  const question = arenaClashQuestionFor(clash);
  const blitz = isBlitzWindow(clash.windowDuration);
  const derby = clash.opponentKind === "meme";
  const nowSec = Math.floor(Date.now() / 1000);
  const stakingOpen = status === "upcoming" && nowSec < clash.windowStart;
  const totals = clash.outcomeTotals.map((t) => {
    try {
      return BigInt(t);
    } catch {
      return 0n;
    }
  });
  const stakedTotal = totals.reduce((sum, value) => sum + value, 0n);

  const liveScore =
    clash.liveMemeMovePct !== null && clash.liveOppMovePct !== null
      ? clashScoreline(clash.liveMemeMovePct, clash.liveOppMovePct)
      : clash.liveMemeGoals !== null && clash.liveOppGoals !== null
        ? { memeGoals: clash.liveMemeGoals, oppGoals: clash.liveOppGoals }
        : null;
  const finalScore =
    clash.memeMovePct !== null && clash.oppMovePct !== null
      ? clashScoreline(clash.memeMovePct, clash.oppMovePct)
      : null;
  const centreScore = status === "inplay" ? liveScore : status === "settled" ? finalScore : null;
  const showCentreScore = (status === "inplay" || status === "settled") && centreScore !== null;
  const cardLabel = `Memes · Clash${clash.cupTie && clash.cup ? ` · Cup Round ${clash.cup.round + 1}` : ""}`;
  const memePct = status === "inplay" ? clash.liveMemeMovePct : clash.memeMovePct;
  const oppPct = status === "inplay" ? clash.liveOppMovePct : clash.oppMovePct;

  return (
    <div className="flex h-full flex-col">
      <Link
        href={`/arena/clash/${clash.id}`}
        className={cn(
          "glass card-interactive group block flex-1 rounded-2xl p-4",
          status === "inplay" && "!border-red-500/40 shadow-[0_0_24px_rgba(239,68,68,.12)]"
        )}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
            {cardLabel}
          </span>
          <StatusPill clash={clash} />
        </div>
        {(clash.cupTie || blitz || derby || clash.featured) && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {clash.cupTie && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 font-display text-xs font-bold text-amber-600 dark:bg-amber-500/20 dark:text-amber-300">
                <Trophy className="h-3 w-3" />
                Meme Cup
              </span>
            )}
            {blitz && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#2E7CF6]/10 px-2.5 py-0.5 text-xs font-semibold text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]">
                <Zap className="h-3 w-3" />
                Blitz, 1 hour
              </span>
            )}
            {derby && (
              <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
                Derby
              </span>
            )}
            {clash.featured && (
              <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
                Featured
              </span>
            )}
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1">
          <div className="flex min-w-0 flex-col items-center text-center">
            <MemeLogo symbol={clash.memeSymbol} logoUrl={clash.memeLogoUrl} size={34} />
            <span className="mt-1 w-full truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{clash.memeName}</span>
            {(status === "inplay" || status === "settled") && memePct !== null && (
              <span className={`mt-0.5 text-xs font-bold tabular-nums ${memePct >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                {formatSignedPct(memePct)}
              </span>
            )}
          </div>
          <span className={`font-display font-extrabold tabular-nums ${showCentreScore || status === "voided" ? "text-xl text-zinc-950 dark:text-white" : "text-[11px] uppercase tracking-[.18em] text-zinc-400"}`}>
            {status === "voided" ? "VOID" : showCentreScore && centreScore ? `${centreScore.memeGoals}–${centreScore.oppGoals}` : status === "inplay" || status === "settled" ? "– : –" : "VS"}
          </span>
          <div className="flex min-w-0 flex-col items-center text-center">
            {derby ? (
              <MemeLogo symbol={clash.opponentSymbol} logoUrl={clash.opponentLogoUrl} size={34} />
            ) : (
              <StockLogo symbol={clash.opponentSymbol} iconUrl={clash.opponentLogoUrl} size={34} />
            )}
            <span className="mt-1 w-full truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{clash.opponentName}</span>
            {(status === "inplay" || status === "settled") && oppPct !== null && (
              <span className={`mt-0.5 text-xs font-bold tabular-nums ${oppPct >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                {formatSignedPct(oppPct)}
              </span>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{question}</p>
        <div className="mt-3 grid grid-cols-1 gap-2">
          {totals.map((amount, index) => {
            const pct = stakedTotal > 0n ? Number((amount * 10_000n) / stakedTotal) / 100 : 0;
            const leading = stakedTotal > 0n && amount > 0n && amount === totals.reduce((a, b) => (b > a ? b : a), 0n);
            const isWinner = status === "settled" && clash.winner === index;
            return (
              <div
                key={index}
                className={`min-w-0 rounded-2xl border px-4 py-3 ${isWinner ? "border-emerald-500/40 bg-emerald-500/[.07]" : leading ? "border-[#2E7CF6]/35 bg-[#2E7CF6]/[.07]" : "border-black/[.06] bg-black/[.02] dark:border-white/[.07] dark:bg-white/[.025]"}`}
              >
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm font-extrabold text-zinc-800 dark:text-zinc-100">
                    {index === 0 ? "Yes" : "No"}{isWinner ? " · Winner" : ""}
                  </span>
                  <span className="shrink-0 font-display text-base font-black tabular-nums text-zinc-950 dark:text-white">
                    {formatMarketOdds(clash.multipliers?.[index] ?? null)}
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
                  <div className={`h-full rounded-full ${leading || isWinner ? "bg-gradient-to-r from-[#2E7CF6] to-cyan-400" : "bg-zinc-300 dark:bg-zinc-600"}`} style={{ width: `${Math.max(pct, pct ? 3 : 0)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        {status === "upcoming" && (
          <p className="mt-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            Window {formatUtcDateTime(clash.windowStart * 1000)} to {formatUtcDateTime(clash.windowEnd * 1000)}
          </p>
        )}
        {status === "inplay" && (
          <p className="mt-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            Window ends {formatUtcDateTime(clash.windowEnd * 1000)}
          </p>
        )}
        {status === "voided" && (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Void, a move of 30 percent or more on either side. Stakes refunded.
          </p>
        )}
        {stakingOpen && (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Staking closes at window start. Yes wins only on a strictly greater percent move, {arenaDisplaySymbol(clash.memeSymbol)} against {arenaDisplaySymbol(clash.opponentSymbol)}.
          </p>
        )}
      </Link>
    </div>
  );
}
