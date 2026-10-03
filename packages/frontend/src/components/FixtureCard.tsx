/**
 * FixtureCard — clickable match card used on Home + Fixtures pages.
 * Shows kickoff state: TBA / scheduled (deterministic slot, provisional until
 * the on-chain reveal) / countdown / LIVE / FT (settled or window passed).
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "../lib/cn";
import { isoToMs } from "../lib/format";
import { getMatchDurationMs } from "../lib/matchConfig";
import type { ApiFixture, ApiPool } from "../lib/api";
import { api } from "../lib/api";
import { TeamBadge } from "./TeamBadge";
import { Countdown } from "./Countdown";
import { QuickStakeChips, QuickStakeSheet, type QuickStakeOutcome } from "./QuickStake";

export interface LiveFixtureUpdate {
  settled?: boolean;
  kickoffMs?: number | null;
  kickoffRevealed?: boolean;
}

export type FixtureStatus = "tba" | "scheduled" | "upcoming" | "live" | "awaiting" | "settled" | "voided";

export function fixtureStatus(f: ApiFixture, liveUpdate?: LiveFixtureUpdate): FixtureStatus {
  if (f.voided) return "voided";
  if (f.settled || liveUpdate?.settled) return "settled";
  const kickoffMs = liveUpdate?.kickoffMs ?? isoToMs(f.kickoff);
  const revealed = liveUpdate?.kickoffRevealed ?? f.kickoffRevealed;
  if (revealed && kickoffMs !== null) {
    const now = Date.now();
    if (now < kickoffMs) return "upcoming";
    // On-chain match duration (fetched at startup) — never a hardcoded constant.
    if (now <= kickoffMs + getMatchDurationMs()) return "live";
    return "awaiting";
  }
  // Not yet revealed on-chain — but the backend publishes the deterministic
  // schedule, so the start time is known well in advance. Provisional until
  // the on-chain reveal confirms it (~2h before kickoff).
  if (isoToMs(f.scheduledKickoff) !== null) return "scheduled";
  return "tba";
}

function StatusPill({ status, kickoffMs }: { status: FixtureStatus; kickoffMs: number | null }) {
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
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#2E7CF6]/10 px-2.5 py-0.5 text-xs font-semibold text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]">
          <Clock className="h-3 w-3" />
          <Countdown target={kickoffMs} />
        </span>
      );
    case "scheduled":
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-400/70 px-2.5 py-0.5 text-xs font-semibold text-zinc-500 dark:border-zinc-500/70 dark:text-zinc-400"
          title="Scheduled start — confirmed on-chain about 2h before kickoff"
        >
          <Clock className="h-3 w-3" />
          <Countdown target={kickoffMs} />
        </span>
      );
    case "voided":
      return (
        <span className="rounded-full bg-zinc-500/12 px-2.5 py-0.5 font-display text-xs font-bold text-zinc-500 dark:bg-zinc-500/15 dark:text-zinc-400">
          VOID
        </span>
      );
    case "settled":
      return (
        <span className="rounded-full bg-[#2E7CF6]/10 px-2.5 py-0.5 font-display text-xs font-bold text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]">
          FT
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

export function FixtureCard({
  fixture,
  liveUpdate,
  score,
}: {
  fixture: ApiFixture;
  liveUpdate?: LiveFixtureUpdate;
  score?: [number, number] | null;
}) {
  if (!fixture.home || !fixture.away) return null;
  const status = fixtureStatus(fixture, liveUpdate);
  const kickoffMs = liveUpdate?.kickoffMs ?? isoToMs(fixture.kickoff);
  // The pill counts down to the confirmed kickoff, or the scheduled slot
  // while the on-chain reveal is still pending.
  const pillMs = kickoffMs ?? isoToMs(fixture.scheduledKickoff);
  const stakable = status === "upcoming" || status === "scheduled";

  // Quick-stake: 1/X/2 chips on upcoming matches. Pool totals come from the
  // backend on chip click (one light API call) so the sheet can estimate
  // payouts without every card polling.
  const [quickPick, setQuickPick] = useState<QuickStakeOutcome | null>(null);
  const [pool, setPool] = useState<ApiPool | null>(null);
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
      setPool(await api.pool(fixture.fixtureId));
    } catch {
      // Pool read failed — open the sheet with zeroed pools so staking still
      // works (on-chain enforces everything; only the payout estimate shows —).
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
      href={`/match/${fixture.fixtureId}`}
      className={cn(
        "glass card-interactive group block flex-1 rounded-2xl p-4",
        status === "live" && "!border-red-500/40 shadow-[0_0_24px_rgba(239,68,68,.12)]"
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
          Matchday {fixture.matchdayIndex + 1}
        </span>
        <StatusPill status={status} kickoffMs={pillMs} />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1">
        <div className="flex min-w-0 flex-col items-center text-center">
          <TeamBadge teamId={fixture.home.teamId} size={34} showName={false} />
          <span className="mt-1 w-full truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{fixture.home.name}</span>
        </div>
        <span className={`font-display font-extrabold tabular-nums ${score !== undefined && (status === "live" || status === "settled") ? "text-xl text-zinc-950 dark:text-white" : "text-[11px] uppercase tracking-[.18em] text-zinc-400"}`}>
          {score !== undefined && (status === "live" || status === "settled") ? score ? `${score[0]}–${score[1]}` : "– : –" : "VS"}
        </span>
        <div className="flex min-w-0 flex-col items-center text-center">
          <TeamBadge teamId={fixture.away.teamId} size={34} showName={false} />
          <span className="mt-1 w-full truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{fixture.away.name}</span>
        </div>
      </div>
    </Link>
      {stakable && (
        <div className="mt-2 px-1">
          <QuickStakeChips outcomes={quickOutcomes} bettingOpen onPick={openQuickStake} />
        </div>
      )}
      <QuickStakeSheet
        variant="match"
        marketId={BigInt(fixture.fixtureId)}
        question={`${fixture.home.name} vs ${fixture.away.name} — who comes out on top?`}
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
