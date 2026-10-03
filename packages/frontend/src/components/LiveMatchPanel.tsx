/**
 * LiveMatchPanel — live match view (spec P3.7).
 * Real-time percentage-change bars per team (start price from
 * PriceOracle.getSnapshot vs live backend prices), rounded live score
 * display, and the 20-minute window countdown.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Radio } from "lucide-react";
import { PRICE_DECIMALS } from "../lib/contracts";
import { formatSignedPct } from "../lib/format";
import { cn } from "../lib/cn";
import { useCountdown } from "./Countdown";
import { TeamBadge } from "./TeamBadge";
import type { ApiFixture } from "../lib/api";

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
  prices: Record<string, number>;
  windowEndMs: number | null;
}) {
  const { expired } = useCountdown(windowEndMs);
  const [trend, setTrend] = useState<[number, number][]>([]);
  const latest = useRef<[number | null, number | null]>([null, null]);

  if (!fixture.home || !fixture.away) return null;

  const homePrice = prices[fixture.home.symbol];
  const awayPrice = prices[fixture.away.symbol];
  const homePct = snapshot ? pctChange(snapshot.homeStart, homePrice ?? null) : null;
  const awayPct = snapshot ? pctChange(snapshot.awayStart, awayPrice ?? null) : null;
  latest.current = [homePct, awayPct];

  useEffect(() => {
    const timer = window.setInterval(() => {
      const [home, away] = latest.current;
      if (home === null || away === null) return;
      setTrend((points) => [...points.slice(-35), [home, away]]);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const leader: "home" | "away" | "draw" =
    homePct === null || awayPct === null
      ? "draw"
      : homePct > awayPct
        ? "home"
        : awayPct > homePct
          ? "away"
          : "draw";

  const barFor = (pct: number | null) => {
    if (pct === null) return { width: 0, cls: "bg-zinc-400 dark:bg-zinc-600", live: false };
    const w = Math.min(100, Math.abs(pct) * 10);
    return {
      width: Math.max(2, w),
      cls:
        pct >= 0
          ? "bg-gradient-to-r from-[#1D9E75] to-[#34d399] shadow-[0_0_14px_rgba(29,158,117,.5)]"
          : "bg-gradient-to-r from-red-500 to-red-400 shadow-[0_0_14px_rgba(239,68,68,.5)]",
      live: true,
    };
  };

  const chart = (key: 0 | 1) => {
    if (trend.length < 2) return "M0 74 L600 74";
    const values = trend.map((p) => p[key]);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const range = max - min || 1;
    return values.map((value, i) => `${i ? "L" : "M"}${(i / (values.length - 1)) * 600},${72 - ((value - min) / range) * 58}`).join(" ");
  };

  return (
    <div className="glass relative overflow-hidden rounded-3xl border-red-500/20! p-5 shadow-[0_0_45px_rgba(239,68,68,.07)] sm:p-6">
      <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-red-500/[.07] blur-3xl" />
      <div className="relative mb-5 flex items-center justify-between">
        <span className="inline-flex animate-glow-pulse items-center gap-1.5 rounded-full bg-red-500/12 px-3 py-1 font-display text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-400">
          <Radio className="h-3.5 w-3.5 animate-pulse" /> LIVE
        </span>
        <span className="inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          <Activity className="h-3.5 w-3.5 text-[#2E7CF6]" /> Coin momentum
        </span>
        <span className="font-display text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {windowEndMs === null
            ? "—"
            : expired
              ? "Full time — awaiting result"
              : `Window ends in ${Math.max(0, Math.ceil((windowEndMs - Date.now()) / 60000))}m`}
        </span>
      </div>

      <div className="relative mb-5 overflow-hidden rounded-2xl border border-black/[.06] bg-black/[.025] px-3 py-4 dark:border-white/[.07] dark:bg-white/[.025]">
        <div className="mb-2 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400"><span>Kickoff</span><span>Live momentum</span><span>Now</span></div>
        <svg viewBox="0 0 600 90" preserveAspectRatio="none" className="h-32 w-full overflow-visible sm:h-40" aria-label="Live coin momentum graph">
          <defs><linearGradient id="homeMomentumGlow" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#22c55e" stopOpacity=".22" /><stop offset="1" stopColor="#22c55e" stopOpacity="0" /></linearGradient><linearGradient id="awayMomentumGlow" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2E7CF6" stopOpacity=".18" /><stop offset="1" stopColor="#2E7CF6" stopOpacity="0" /></linearGradient></defs>
          {[20, 45, 70].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="currentColor" className="text-zinc-300/50 dark:text-zinc-700/60" strokeDasharray="4 8" />)}
          <path d={`${chart(0)} L600 90 L0 90 Z`} fill="url(#homeMomentumGlow)" />
          <path d={`${chart(1)} L600 90 L0 90 Z`} fill="url(#awayMomentumGlow)" />
          <path d={chart(0)} fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" className="drop-shadow-[0_0_7px_rgba(34,197,94,.45)]" />
          <path d={chart(1)} fill="none" stroke="#2E7CF6" strokeWidth="3" strokeLinecap="round" className="drop-shadow-[0_0_7px_rgba(46,124,246,.45)]" />
          {trend.length > 0 && <><circle cx="600" cy={72 - ((trend[trend.length - 1][0] - Math.min(...trend.map((p) => p[0]), 0)) / (Math.max(...trend.map((p) => p[0]), 0) - Math.min(...trend.map((p) => p[0]), 0) || 1)) * 58} r="4" fill="#22c55e" /><circle cx="600" cy={72 - ((trend[trend.length - 1][1] - Math.min(...trend.map((p) => p[1]), 0)) / (Math.max(...trend.map((p) => p[1]), 0) - Math.min(...trend.map((p) => p[1]), 0) || 1)) * 58} r="4" fill="#2E7CF6" /></>}
        </svg>
      </div>

      {/* % change bars */}
      <div className="space-y-4">
        {[
          { teamId: fixture.home.teamId, symbol: fixture.home.symbol, pct: homePct, name: fixture.home.name, leading: leader === "home", bar: "bg-gradient-to-r from-[#1D9E75] to-[#34d399]" },
          { teamId: fixture.away.teamId, symbol: fixture.away.symbol, pct: awayPct, name: fixture.away.name, leading: leader === "away", bar: "bg-gradient-to-r from-[#2E7CF6] to-[#8db4ff]" },
        ].map((row) => {
          const bar = barFor(row.pct);
          return (
            <div key={row.teamId}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className={cn("font-medium", row.leading ? "text-zinc-900 dark:text-white" : "text-zinc-500 dark:text-zinc-400")}>
                  {row.name}
                  {row.leading && (
                    <span className="ml-2 rounded-full bg-[#1D9E75]/12 px-1.5 py-0.5 text-[10px] font-bold text-[#0f7a55] dark:bg-[#1D9E75]/15 dark:text-[#7fe0bd]">
                      LEADING
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "font-display font-bold tabular-nums",
                    row.pct === null ? "text-zinc-400 dark:text-zinc-500" : row.pct >= 0 ? "text-[#0f7a55] dark:text-[#7fe0bd]" : "text-red-500 dark:text-red-400"
                  )}
                >
                  {row.pct === null ? "waiting for price…" : formatSignedPct(row.pct)}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/8 dark:bg-white/8">
                <div
                  className={cn("h-full rounded-full transition-all duration-1000", row.bar, bar.live && "bar-shimmer")}
                  style={{ width: `${bar.width}%` }}
                />
              </div>
              {prices[row.symbol] !== undefined && (
                <p className="mt-1 font-display text-[11px] tabular-nums text-zinc-400 dark:text-zinc-600">
                  Live: ${Number(prices[row.symbol] ?? 0).toLocaleString("en-US")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {!snapshot && (
        <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-500">
          Kickoff snapshot not yet on-chain — bars appear once the backend submits start prices.
        </p>
      )}
    </div>
  );
}
