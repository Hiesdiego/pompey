/**
 * FixtureCard — clickable match card used on Home + Fixtures pages.
 * Shows kickoff state: TBA / countdown / LIVE / FT (settled or window passed).
 */

"use client";

import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "../lib/cn";
import { isoToMs } from "../lib/format";
import { TICKR_V01_CONFIG } from "@tickr/shared/constants";
import type { ApiFixture } from "../lib/api";
import { TeamBadge } from "./TeamBadge";
import { Countdown } from "./Countdown";
import type { LiveFixtureUpdate } from "../hooks/useLiveFeed";

const MATCH_MS = TICKR_V01_CONFIG.MATCH_DURATION_SECONDS * 1000;

export type FixtureStatus = "tba" | "upcoming" | "live" | "awaiting" | "settled";

export function fixtureStatus(f: ApiFixture, liveUpdate?: LiveFixtureUpdate): FixtureStatus {
  if (f.settled || liveUpdate?.settled) return "settled";
  const kickoffMs = liveUpdate?.kickoffMs ?? isoToMs(f.kickoff);
  const revealed = liveUpdate?.kickoffRevealed ?? f.kickoffRevealed;
  if (!revealed || kickoffMs === null) return "tba";
  const now = Date.now();
  if (now < kickoffMs) return "upcoming";
  if (now <= kickoffMs + MATCH_MS) return "live";
  return "awaiting";
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
}: {
  fixture: ApiFixture;
  liveUpdate?: LiveFixtureUpdate;
}) {
  if (!fixture.home || !fixture.away) return null;
  const status = fixtureStatus(fixture, liveUpdate);
  const kickoffMs = liveUpdate?.kickoffMs ?? isoToMs(fixture.kickoff);

  return (
    <Link
      href={`/match/${fixture.fixtureId}`}
      className={cn(
        "glass card-interactive group block rounded-2xl p-4",
        status === "live" && "!border-red-500/40 shadow-[0_0_24px_rgba(239,68,68,.12)]"
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
          Matchday {fixture.matchdayIndex + 1}
        </span>
        <StatusPill status={status} kickoffMs={kickoffMs} />
      </div>
      <div className="space-y-3">
        <TeamBadge teamId={fixture.home.teamId} size={28} />
        <TeamBadge teamId={fixture.away.teamId} size={28} />
      </div>
    </Link>
  );
}
