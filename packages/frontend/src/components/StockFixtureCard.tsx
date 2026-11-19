/**
 * StockFixtureCard, clickable stock match card for Home and Fixtures pages.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/StockFixtureCard.tsx
 *
 * Reuses the crypto FixtureCard status logic, with two fixes and two
 * additions:
 *   Fix: match length is STOCK_MATCH_MS (60 minutes, from
 *   stockMatchConfig.ts), never the stale 45-minute shared constant the
 *   crypto card reads. See stockMatchConfig.ts for the full bug note.
 *   Addition 1: status "forfeit" (settled 3-0 by forfeit, FORFEIT pill)
 *   and status "voided" (both sides had no performance, stakes refunded,
 *   VOID pill). A forfeit is settled, so it sorts and links like any
 *   settled fixture, with the pill as the only difference.
 *   Addition 2: settled, forfeit and live cards show the scoreline in
 *   the centre cell of the team line, so a finished stock match reads
 *   at a glance. Live cards show the live rounded score when the
 *   caller passes it.
 *
 * Team line mirrors the crypto FixtureCard exactly: a
 * grid grid-cols-[1fr_auto_1fr] row, home badge (size 34, no name) over
 * the truncated team name, centre cell, away badge over its name.
 * Centre cell shows VS before kickoff, the scoreline with an en dash
 * when live, settled, or forfeit, and an en dash on each side of a
 * colon when live or settled with no score yet. Settled score comes
 * from fixture.homeGoals and fixture.awayGoals; a forfeit is 3-0 via
 * forfeitScoreline using forfeitingTeamId.
 *
 * Quick stake mirrors the crypto FixtureCard: chips under the card for
 * upcoming and TBA stock matches only, never live, settled, forfeit,
 * voided or awaiting. Tapping a chip loads the stock pool totals via
 * stockApi.pool and opens the sheet with variant "stock-match" and
 * league "stocks", so the sheet stakes on the stock pool with stock
 * team badges.
 *
 * Unrevealed fixtures are TBD, never a countdown: unlike crypto, the
 * stock API carries no scheduledKickoff, and the deterministic backend
 * slot is not shown before the reveal, so the card exposes no time at
 * all until kickoffRevealed is true and kickoff is set. Revealed
 * upcoming fixtures show a countdown pill plus the kickoff date and
 * time in UTC under the teams.
 *
 * LiveFixtureUpdate is imported from ./FixtureCard, where the crypto
 * card defines it. There is no hooks/useLiveFeed.ts in the branch, so
 * do not import the type from there.
 *
 * Statuses: tba / scheduled / upcoming / live / awaiting / settled /
 * voided / forfeit. "tba" is the unrevealed state: the pill reads TBD
 * and the card exposes no kickoff time and no countdown, because the
 * kickoff is not set until the on-chain reveal. "scheduled" is kept as
 * an alias of "upcoming" so callers from either naming can use it, but
 * this function never returns it for an unrevealed fixture. A settled
 * flag is only honoured when the match can actually have been played:
 * a forfeit, a recorded scoreline, or a kickoff that has already
 * started. A settled flag on a fixture with no kickoff and no result
 * falls through to tba or upcoming instead of showing FT.
 *
 * Rounds: 22 rounds, 6 fixtures per round. The card label reads
 * "Stocks · Round N". Rounds 21 and 22 share Dec 16, the double-header
 * finale, so those cards add the morning or evening wave to the label.
 *
 * Scoring reminder on every card footer: 1 goal = 0.05%, 1-hour window.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "../lib/cn";
import { isoToMs } from "../lib/format";
import { STOCK_MATCH_MS } from "../lib/stockMatchConfig";
import { forfeitScoreline, formatUtcDateTime, stockRoundWave } from "../lib/stockFormat";
import { stockApi, type StockApiFixture, type StockApiPool } from "../lib/stockContracts";
import { StockTeamBadge } from "./StockLeagueTable";
import { Countdown } from "./Countdown";
import type { LiveFixtureUpdate } from "./FixtureCard";
import { QuickStakeChips, QuickStakeSheet, type QuickStakeOutcome } from "./QuickStake";

export type StockFixtureStatus =
  | "tba"
  | "scheduled"
  | "upcoming"
  | "live"
  | "awaiting"
  | "settled"
  | "voided"
  | "forfeit";

export function stockFixtureStatus(
  f: StockApiFixture,
  liveUpdate?: LiveFixtureUpdate
): StockFixtureStatus {
  if (f.voided) return "voided";
  const kickoffMs = liveUpdate?.kickoffMs ?? isoToMs(f.kickoff);
  const revealed = liveUpdate?.kickoffRevealed ?? f.kickoffRevealed;
  if (f.settled || liveUpdate?.settled) {
    // A settled flag alone is not proof the match was played. Honour it
    // only when the result exists (forfeit, or a recorded scoreline) or
    // the kickoff has already started. Otherwise fall through to the
    // time-based branches below, so an unplayed fixture can never read
    // as full time because of a stray settled flag in the payload.
    const hasResult =
      f.forfeit === true ||
      (f.homeGoals !== null && f.homeGoals !== undefined && f.awayGoals !== null && f.awayGoals !== undefined);
    const windowStarted = kickoffMs !== null && Date.now() >= kickoffMs;
    if (hasResult || windowStarted) return f.forfeit ? "forfeit" : "settled";
  }
  if (!revealed || kickoffMs === null) return "tba";
  const now = Date.now();
  if (now < kickoffMs) return "upcoming";
  if (now <= kickoffMs + STOCK_MATCH_MS) return "live";
  return "awaiting";
}

function StatusPill({
  status,
  kickoffMs,
}: {
  status: StockFixtureStatus;
  kickoffMs: number | null;
}) {
  switch (status) {
    case "live":
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
    case "scheduled":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#2E7CF6]/10 px-2.5 py-0.5 text-xs font-semibold text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]">
          <Clock className="h-3 w-3" />
          <Countdown target={kickoffMs} />
        </span>
      );
    case "settled":
      return (
        <span className="rounded-full bg-[#2E7CF6]/10 px-2.5 py-0.5 font-display text-xs font-bold text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]">
          FT
        </span>
      );
    case "forfeit":
      return (
        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-display text-xs font-bold text-amber-600 dark:bg-amber-500/20 dark:text-amber-300">
          FORFEIT
        </span>
      );
    case "voided":
      return (
        <span className="rounded-full bg-zinc-500/12 px-2.5 py-0.5 font-display text-xs font-bold text-zinc-500 dark:bg-zinc-500/15 dark:text-zinc-300">
          VOID
        </span>
      );
    case "awaiting":
      return (
        <span className="rounded-full bg-amber-500/12 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
          Awaiting result
        </span>
      );
    default:
      return (
        <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
          TBD
        </span>
      );
  }
}

export function StockFixtureCard({
  fixture,
  liveUpdate,
  liveScore,
}: {
  fixture: StockApiFixture;
  liveUpdate?: LiveFixtureUpdate;
  /** Live rounded score [home, away] when the parent has prices, else null.
   *  Also used as the fallback scoreline for a settled fixture whose API
   *  goals are missing. */
  liveScore?: [number, number] | null;
}) {
  if (!fixture.home || !fixture.away) return null;
  const status = stockFixtureStatus(fixture, liveUpdate);
  const kickoffMs = liveUpdate?.kickoffMs ?? isoToMs(fixture.kickoff);
  const kickoffIso = kickoffMs !== null ? new Date(kickoffMs).toISOString() : null;
  // Centre-cell scoreline, same rule as the crypto card. Live cards show
  // the live score. Settled cards show the recorded goals, falling back
  // to the snapshot-derived score the parent passes as liveScore. A
  // forfeit is 3-0 to the side that did not forfeit, from
  // forfeitingTeamId; when that id is missing the recorded goals are
  // used, and 3-0 is the last resort. Any other status shows VS.
  const apiGoals =
    fixture.homeGoals !== null && fixture.homeGoals !== undefined && fixture.awayGoals !== null && fixture.awayGoals !== undefined
      ? ([fixture.homeGoals, fixture.awayGoals] as [number, number])
      : null;
  const forfeitGoals: [number, number] | null =
    status === "forfeit"
      ? fixture.forfeitingTeamId === fixture.home.teamId
        ? forfeitScoreline("home")
        : fixture.forfeitingTeamId === fixture.away.teamId
          ? forfeitScoreline("away")
          : apiGoals ?? [3, 0]
      : null;
  const centreScore: [number, number] | null =
    status === "live"
      ? liveScore ?? null
      : status === "forfeit"
        ? forfeitGoals
        : status === "settled"
          ? apiGoals ?? liveScore ?? null
          : null;
  const showCentreScore = status === "live" || status === "settled" || status === "forfeit";
  const wave = stockRoundWave(fixture.matchdayIndex);
  const roundLabel = `Stocks · Round ${fixture.matchdayIndex + 1}${wave ? `, ${wave} wave` : ""}`;

  // Quick-stake: 1/X/2 chips on upcoming and TBA matches. Pool totals
  // come from the backend on chip click (one light API call) so the
  // sheet can estimate payouts without every card polling.
  const stakable = status === "upcoming" || status === "scheduled" || status === "tba";
  const [quickPick, setQuickPick] = useState<QuickStakeOutcome | null>(null);
  const [pool, setPool] = useState<StockApiPool | null>(null);
  const quickOutcomes: QuickStakeOutcome[] = [0, 1, 2].map((index) => ({
    index,
    label: index === 0 ? fixture.home!.symbol : index === 2 ? fixture.away!.symbol : "Draw",
    share: 0, // filled when the pool loads
    total: 0n,
    teamId: index === 0 ? fixture.home!.teamId : index === 2 ? fixture.away!.teamId : null,
  }));
  async function openQuickStake(o: QuickStakeOutcome) {
    setQuickPick(o);
    try {
      setPool(await stockApi.pool(fixture.fixtureId));
    } catch {
      // Pool read failed, open the sheet with zeroed pools so staking
      // still works (on-chain enforces everything; only the payout
      // estimate shows no pool behind it).
      setPool({
        seasonId: fixture.seasonId,
        fixtureId: fixture.fixtureId,
        totalHome: "0",
        totalDraw: "0",
        totalAway: "0",
        seed: "0",
        totalPool: "0",
        settled: false,
        voided: false,
        winningOutcome: null,
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Link
        href={`/stocks/match/${fixture.fixtureId}`}
        className={cn(
          "glass card-interactive group block flex-1 rounded-2xl p-4",
          status === "live" && "!border-red-500/40 shadow-[0_0_24px_rgba(239,68,68,.12)]",
          status === "forfeit" && "!border-amber-500/40"
        )}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
            {roundLabel}
          </span>
          <StatusPill status={status} kickoffMs={kickoffMs} />
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1">
          <div className="flex min-w-0 flex-col items-center text-center">
            <StockTeamBadge teamId={fixture.home.teamId} size={34} showName={false} />
            <span className="mt-1 w-full truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{fixture.home.name}</span>
          </div>
          <span className={`font-display font-extrabold tabular-nums ${showCentreScore ? "text-xl text-zinc-950 dark:text-white" : "text-[11px] uppercase tracking-[.18em] text-zinc-400"}`}>
            {showCentreScore ? (centreScore ? `${centreScore[0]}–${centreScore[1]}` : "– : –") : "VS"}
          </span>
          <div className="flex min-w-0 flex-col items-center text-center">
            <StockTeamBadge teamId={fixture.away.teamId} size={34} showName={false} />
            <span className="mt-1 w-full truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{fixture.away.name}</span>
          </div>
        </div>
        {(status === "upcoming" || status === "scheduled") && kickoffIso !== null && (
          <p className="mt-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            Kickoff {formatUtcDateTime(kickoffIso)}
          </p>
        )}
        {status === "forfeit" && (
          <p className="mt-3 text-xs font-semibold text-amber-600 dark:text-amber-300">
            Forfeit 3-0, one side had no performance
          </p>
        )}
        {status === "voided" && (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Void, both sides had no performance. Stakes refunded.
          </p>
        )}
      </Link>
      {stakable && (
        <div className="mt-2 px-1">
          <QuickStakeChips outcomes={quickOutcomes} bettingOpen onPick={openQuickStake} league="stocks" />
        </div>
      )}
      <QuickStakeSheet
        variant="stock-match"
        marketId={BigInt(fixture.fixtureId)}
        question={`${fixture.home.name} vs ${fixture.away.name}, who comes out on top?`}
        outcome={
          quickPick && pool
            ? {
                ...quickPick,
                total: BigInt([pool.totalHome, pool.totalDraw, pool.totalAway][quickPick.index] ?? "0"),
                share:
                  BigInt(pool.totalPool) > 0n
                    ? Number(
                        (BigInt([pool.totalHome, pool.totalDraw, pool.totalAway][quickPick.index] ?? "0") *
                          10_000n) /
                          BigInt(pool.totalPool)
                      ) / 100
                    : 0,
              }
            : null
        }
        outcomeTotals={
          pool
            ? [
                BigInt(pool.totalHome),
                BigInt(pool.totalDraw),
                BigInt(pool.totalAway),
              ]
            : [0n, 0n, 0n]
        }
        totalStaked={pool ? BigInt(pool.totalPool) : 0n}
        seedAmount={pool ? BigInt(pool.seed ?? "0") : 0n}
        onClose={() => setQuickPick(null)}
      />
    </div>
  );
}
