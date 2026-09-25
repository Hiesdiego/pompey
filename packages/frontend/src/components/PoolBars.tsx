/**
 * PoolBars — pool distribution across Home / Draw / Away with live TICK amounts.
 */

"use client";

import { formatTick, OUTCOME_LABELS, OUTCOME_SHORT } from "../lib/format";
import { cn } from "../lib/cn";
import type { ApiPool } from "../lib/api";

const BAR_GRADIENTS = [
  "bg-gradient-to-r from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_12px_rgba(46,124,246,.45)]",
  "bg-zinc-400 dark:bg-zinc-500",
  "bg-gradient-to-r from-[#1D9E75] to-[#17b183]",
];

export function PoolBars({ pool, compact = false }: { pool: ApiPool; compact?: boolean }) {
  const totals = [BigInt(pool.totalHome), BigInt(pool.totalDraw), BigInt(pool.totalAway)];
  const total = BigInt(pool.totalPool);
  const pcts = totals.map((t) => (total > 0n ? Number((t * 10_000n) / total) / 100 : 0));

  return (
    <div className="space-y-2.5">
      {totals.map((t, i) => (
        <div key={i}>
          {!compact && (
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-semibold text-zinc-600 dark:text-zinc-300">
                {OUTCOME_SHORT[i]} · {OUTCOME_LABELS[i]}
              </span>
              <span className="font-display tabular-nums text-zinc-500 dark:text-zinc-400">
                {pcts[i].toFixed(1)}% · {formatTick(t)} TICK
              </span>
            </div>
          )}
          <div
            className={cn(
              "w-full overflow-hidden rounded-full bg-black/8 dark:bg-white/8",
              compact ? "h-1.5" : "h-2.5"
            )}
          >
            <div
              className={cn("h-full rounded-full transition-all duration-500", BAR_GRADIENTS[i])}
              style={{ width: `${Math.max(0, Math.min(100, pcts[i]))}%` }}
            />
          </div>
          {compact && (
            <div className="mt-0.5 flex justify-between text-[10px] font-medium text-zinc-500 dark:text-zinc-500">
              <span>{OUTCOME_SHORT[i]}</span>
              <span className="font-display tabular-nums">{pcts[i].toFixed(0)}%</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
