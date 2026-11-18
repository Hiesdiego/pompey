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
 *   Addition 2: settled and forfeit cards show the scoreline, so a
 *   finished stock match reads at a glance. Live cards show the live
 *   rounded score when the caller passes it.
 *
 * LiveFixtureUpdate is imported from ./FixtureCard, where the crypto
 * card defines it. There is no hooks/useLiveFeed.ts in the branch, so
 * do not import the type from there.
 *
 * Statuses: tba / scheduled / upcoming / live / awaiting / settled /
 * voided / forfeit. "scheduled" is the revealed-but-not-yet-kickoff
 * state the crypto card calls "upcoming" with a countdown, kept here as
 * an alias so callers from either naming can use it. Pills: TBA, LIVE,
 * FT, FORFEIT, VOID, Awaiting result.
 *
 * Rounds: 22 rounds, 6 fixtures per round. The card label reads
 * "Stocks · Round N". Rounds 21 and 22 share Dec 16, the double-header
 * finale, so those cards add the morning or evening wave to the label.
 *
 * Scoring reminder on every card footer: 1 goal = 0.05%, 1-hour window.
 */

"use client";

import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "../lib/cn";
import { isoToMs } from "../lib/format";
import { STOCK_MATCH_MS } from "../lib/stockMatchConfig";
import { formatStockScoreline, stockRoundWave } from "../lib/stockFormat";
import type { StockApiFixture } from "../lib/stockContracts";
import { StockTeamBadge } from "./StockLeagueTable";
import { Countdown } from "./Countdown";
import type { LiveFixtureUpdate } from "./FixtureCard";

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
  if (f.settled || liveUpdate?.settled) return f.forfeit ? "forfeit" : "settled";
  const kickoffMs = liveUpdate?.kickoffMs ?? isoToMs(f.kickoff);
  const revealed = liveUpdate?.kickoffRevealed ?? f.kickoffRevealed;
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
          TBA
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
  /** Live rounded score [home, away] when the parent has prices, else null. */
  liveScore?: [number, number] | null;
}) {
  if (!fixture.home || !fixture.away) return null;
  const status = stockFixtureStatus(fixture, liveUpdate);
  const kickoffMs = liveUpdate?.kickoffMs ?? isoToMs(fixture.kickoff);
  const showScore =
    status === "settled" || status === "forfeit" || status === "live";
  const scoreText =
    status === "live"
      ? liveScore
        ? `${liveScore[0]}-${liveScore[1]}`
        : "–"
      : status === "voided"
        ? "void"
        : formatStockScoreline(fixture.homeGoals ?? null, fixture.awayGoals ?? null, {
            forfeit: fixture.forfeit === true,
          });
  const wave = stockRoundWave(fixture.matchdayIndex);
  const roundLabel = `Stocks · Round ${fixture.matchdayIndex + 1}${wave ? `, ${wave} wave` : ""}`;

  return (
    <Link
      href={`/stocks/match/${fixture.fixtureId}`}
      className={cn(
        "glass card-interactive group block rounded-2xl p-4",
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
      <div className="space-y-3">
        <StockTeamBadge teamId={fixture.home.teamId} size={28} />
        <StockTeamBadge teamId={fixture.away.teamId} size={28} />
      </div>
      {showScore && (
        <p className="mt-3 font-display text-lg font-bold tabular-nums text-zinc-900 dark:text-white">
          {scoreText}
          {status === "forfeit" && (
            <span className="ml-2 text-xs font-semibold text-amber-600 dark:text-amber-300">
              Forfeit 3-0, one side had no performance
            </span>
          )}
        </p>
      )}
      {status === "voided" && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Void, both sides had no performance. Stakes refunded.
        </p>
      )}
    </Link>
  );
}
