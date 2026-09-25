/**
 * PoolBars — pool distribution across Home / Draw / Away with live TICK amounts.
 */

"use client";

import { formatTick, OUTCOME_LABELS, OUTCOME_SHORT } from "../lib/format";
import { cn } from "../lib/cn";
import type { ApiPool } from "../lib/api";

const BAR_COLORS = ["bg-[#7F77DD]", "bg-zinc-500", "bg-[#1D9E75]"];

export function PoolBars({ pool, compact = false }: { pool: ApiPool; compact?: boolean }) {
  const totals = [BigInt(pool.totalHome), BigInt(pool.totalDraw), BigInt(pool.totalAway)];
  const total = BigInt(pool.totalPool);
  const pcts = totals.map((t) => (total > 0n ? Number((t * 10_000n) / total) / 100 : 0));

  return (
    <div className="space-y-2">
      {totals.map((t, i) => (
        <div key={i}>
          {!compact && (
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-medium text-zinc-300">
                {OUTCOME_SHORT[i]} · {OUTCOME_LABELS[i]}
              </span>
              <span className="text-zinc-400">
                {pcts[i].toFixed(1)}% · {formatTick(t)} TICK
              </span>
            </div>
          )}
          <div
            className={cn(
              "w-full overflow-hidden rounded-full bg-zinc-800",
              compact ? "h-1.5" : "h-2.5"
            )}
          >
            <div
              className={cn("h-full rounded-full transition-all duration-500", BAR_COLORS[i])}
              style={{ width: `${Math.max(0, Math.min(100, pcts[i]))}%` }}
            />
          </div>
          {compact && (
            <div className="mt-0.5 flex justify-between text-[10px] text-zinc-500">
              <span>{OUTCOME_SHORT[i]}</span>
              <span>{pcts[i].toFixed(0)}%</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
