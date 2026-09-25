/**
 * LiveMatchPanel — live match view (spec P3.7).
 * Real-time percentage-change bars per team (start price from
 * PriceOracle.getSnapshot vs live backend prices), rounded live score
 * display, and the 20-minute window countdown.
 */

"use client";

import { Radio } from "lucide-react";
import { PRICE_DECIMALS } from "../lib/contracts";
import { formatSignedPct, roundPctLikeOracle } from "../lib/format";
import { cn } from "../lib/cn";
import { useCountdown } from "./Countdown";
import { TeamBadge } from "./TeamBadge";
import type { ApiFixture } from "../lib/api";
import type { LivePrice } from "../hooks/useLiveFeed";

export interface Snapshot {
  homeStart: bigint;
  awayStart: bigint;
}

function pctChange(start: bigint, current: number | null): number | null {
  if (current === null || start <= 0n) return null;
  const startNum = Number(start) / 10 ** PRICE_DECIMALS;
  if (startNum <= 0) return null;
  return ((current - startNum) / startNum) * 100;
}

export function LiveMatchPanel({
  fixture,
  snapshot,
  prices,
  windowEndMs,
}: {
  fixture: ApiFixture;
  snapshot: Snapshot | null;
  prices: Record<number, LivePrice>;
  windowEndMs: number | null;
}) {
  const { expired } = useCountdown(windowEndMs);

  if (!fixture.home || !fixture.away) return null;

  const homePrice = prices[fixture.home.teamId]?.price;
  const awayPrice = prices[fixture.away.teamId]?.price;
  const homePct = snapshot ? pctChange(snapshot.homeStart, homePrice ? Number(homePrice) : null) : null;
  const awayPct = snapshot ? pctChange(snapshot.awayStart, awayPrice ? Number(awayPrice) : null) : null;

  const homeRounded = homePct === null ? null : roundPctLikeOracle(homePct);
  const awayRounded = awayPct === null ? null : roundPctLikeOracle(awayPct);

  const leader: "home" | "away" | "draw" =
    homePct === null || awayPct === null
      ? "draw"
      : homePct > awayPct
        ? "home"
        : awayPct > homePct
          ? "away"
          : "draw";

  const barFor = (pct: number | null) => {
    if (pct === null) return { width: 0, cls: "bg-zinc-600" };
    const w = Math.min(100, Math.abs(pct) * 10);
    return {
      width: Math.max(2, w),
      cls: pct >= 0 ? "bg-[#1D9E75]" : "bg-red-500",
    };
  };

  return (
    <div className="rounded-2xl border border-red-500/30 bg-[#141416] p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600/20 px-3 py-1 text-xs font-bold text-red-400">
          <Radio className="h-3.5 w-3.5 animate-pulse" /> LIVE
        </span>
        <span className="text-xs text-zinc-400">
          {windowEndMs === null
            ? "—"
            : expired
              ? "Full time — awaiting result"
              : `Window ends in ${Math.max(0, Math.ceil((windowEndMs - Date.now()) / 60000))}m`}
        </span>
      </div>

      {/* Rounded live score */}
      <div className="mb-6 grid grid-cols-3 items-center gap-2 text-center">
        <div>
          <TeamBadge teamId={fixture.home.teamId} size={40} showName={false} className="justify-center" />
          <p className="mt-1 text-sm font-semibold text-zinc-200">{fixture.home.name}</p>
        </div>
        <div className="rounded-xl bg-zinc-900 py-3">
          <div className="text-3xl font-black tracking-tight text-white">
            {homeRounded === null ? "–" : homeRounded}
            <span className="mx-1 text-zinc-600">:</span>
            {awayRounded === null ? "–" : awayRounded}
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-wider text-zinc-500">rounded % score</p>
        </div>
        <div>
          <TeamBadge teamId={fixture.away.teamId} size={40} showName={false} className="justify-center" />
          <p className="mt-1 text-sm font-semibold text-zinc-200">{fixture.away.name}</p>
        </div>
      </div>

      {/* % change bars */}
      <div className="space-y-4">
        {[
          { teamId: fixture.home.teamId, pct: homePct, name: fixture.home.name, leading: leader === "home" },
          { teamId: fixture.away.teamId, pct: awayPct, name: fixture.away.name, leading: leader === "away" },
        ].map((row) => {
          const bar = barFor(row.pct);
          return (
            <div key={row.teamId}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className={cn("font-medium", row.leading ? "text-white" : "text-zinc-400")}>
                  {row.name}
                  {row.leading && <span className="ml-2 text-[10px] font-bold text-[#1D9E75]">LEADING</span>}
                </span>
                <span
                  className={cn(
                    "font-mono font-bold",
                    row.pct === null ? "text-zinc-500" : row.pct >= 0 ? "text-[#1D9E75]" : "text-red-400"
                  )}
                >
                  {row.pct === null ? "waiting for price…" : formatSignedPct(row.pct)}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={cn("h-full rounded-full transition-all duration-1000", bar.cls)}
                  style={{ width: `${bar.width}%` }}
                />
              </div>
              {homePrice && awayPrice && (
                <p className="mt-1 text-[11px] text-zinc-600">
                  Live: ${Number(prices[row.teamId]?.price ?? 0).toLocaleString("en-US")} ·{" "}
                  {prices[row.teamId]?.source ?? "—"}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {!snapshot && (
        <p className="mt-4 text-center text-xs text-zinc-500">
          Kickoff snapshot not yet on-chain — bars appear once the backend submits start prices.
        </p>
      )}
    </div>
  );
}
