/**
 * LeagueTable — shared standings table.
 *
 * Ordering (applied by the backend): points > goal difference >
 * goals scored > games won > fewer games lost.
 *
 * `limit` slices the top N rows (home-page snapshot); `compact` hides the
 * W/D/L/GF/GA columns for tight spaces.
 */

"use client";

import { TeamBadge } from "./TeamBadge";
import type { ApiTableRow } from "../lib/api";

const RANK_MEDAL = [
  "text-amber-500 dark:text-amber-400",
  "text-zinc-400 dark:text-zinc-300",
  "text-amber-700 dark:text-amber-600",
];

const gd = (v: number) => (v > 0 ? `+${v}` : `${v}`);

export function LeagueTable({
  rows,
  limit,
  compact = false,
}: {
  rows: ApiTableRow[];
  limit?: number;
  compact?: boolean;
}) {
  const visible = typeof limit === "number" ? rows.slice(0, limit) : rows;
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0">
            <tr className="border-b border-black/8 text-left text-[11px] uppercase tracking-widest text-zinc-500 dark:border-white/8 dark:text-zinc-500">
              <th className="px-4 py-2.5">#</th>
              <th className="px-2 py-2.5">Team</th>
              <th className="px-2 py-2.5 text-center" title="Played">
                P
              </th>
              {!compact && (
                <>
                  <th className="hidden px-2 py-2.5 text-center sm:table-cell" title="Won">
                    W
                  </th>
                  <th className="hidden px-2 py-2.5 text-center sm:table-cell" title="Drawn">
                    D
                  </th>
                  <th className="hidden px-2 py-2.5 text-center sm:table-cell" title="Lost">
                    L
                  </th>
                  <th className="hidden px-2 py-2.5 text-center md:table-cell" title="Goals for">
                    GF
                  </th>
                  <th className="hidden px-2 py-2.5 text-center md:table-cell" title="Goals against">
                    GA
                  </th>
                </>
              )}
              <th className="px-2 py-2.5 text-center" title="Goal difference">
                GD
              </th>
              <th className="px-4 py-2.5 text-right" title="Points">
                Pts
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr
                key={row.teamId}
                className="border-b border-black/5 transition-colors last:border-0 hover:bg-[#2E7CF6]/6 dark:border-white/5 dark:hover:bg-[#2E7CF6]/8"
              >
                <td
                  className={`px-4 py-2.5 font-display font-bold ${
                    RANK_MEDAL[i] ?? "text-zinc-400 dark:text-zinc-500"
                  }`}
                >
                  {i + 1}
                </td>
                <td className="px-2 py-2.5">
                  <TeamBadge teamId={row.teamId} size={22} />
                </td>
                <td className="px-2 py-2.5 text-center tabular-nums text-zinc-500 dark:text-zinc-400">
                  {row.played}
                </td>
                {!compact && (
                  <>
                    <td className="hidden px-2 py-2.5 text-center tabular-nums text-zinc-500 sm:table-cell dark:text-zinc-400">
                      {row.won}
                    </td>
                    <td className="hidden px-2 py-2.5 text-center tabular-nums text-zinc-500 sm:table-cell dark:text-zinc-400">
                      {row.drawn}
                    </td>
                    <td className="hidden px-2 py-2.5 text-center tabular-nums text-zinc-500 sm:table-cell dark:text-zinc-400">
                      {row.lost}
                    </td>
                    <td className="hidden px-2 py-2.5 text-center tabular-nums text-zinc-500 md:table-cell dark:text-zinc-400">
                      {row.goalsFor}
                    </td>
                    <td className="hidden px-2 py-2.5 text-center tabular-nums text-zinc-500 md:table-cell dark:text-zinc-400">
                      {row.goalsAgainst}
                    </td>
                  </>
                )}
                <td className="px-2 py-2.5 text-center tabular-nums text-zinc-500 dark:text-zinc-400">
                  {gd(row.goalDifference)}
                </td>
                <td className="px-4 py-2.5 text-right font-display font-bold tabular-nums text-zinc-900 dark:text-white">
                  {row.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Shape-matched loading skeleton for the league table — same chrome and
 * columns as the real table (so the layout doesn't jump when data lands),
 * with shimmer placeholders in place of the rows.
 */
export function LeagueTableSkeleton({
  rows = 8,
  compact = false,
}: {
  rows?: number;
  compact?: boolean;
}) {
  return (
    <div className="glass overflow-hidden rounded-2xl" aria-hidden>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0">
            <tr className="border-b border-black/8 text-left text-[11px] uppercase tracking-widest text-zinc-500 dark:border-white/8 dark:text-zinc-500">
              <th className="px-4 py-2.5">#</th>
              <th className="px-2 py-2.5">Team</th>
              <th className="px-2 py-2.5 text-center">P</th>
              {!compact && (
                <>
                  <th className="hidden px-2 py-2.5 text-center sm:table-cell">W</th>
                  <th className="hidden px-2 py-2.5 text-center sm:table-cell">D</th>
                  <th className="hidden px-2 py-2.5 text-center sm:table-cell">L</th>
                  <th className="hidden px-2 py-2.5 text-center md:table-cell">GF</th>
                  <th className="hidden px-2 py-2.5 text-center md:table-cell">GA</th>
                </>
              )}
              <th className="px-2 py-2.5 text-center">GD</th>
              <th className="px-4 py-2.5 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => {
              const delay = { animationDelay: `${i * 90}ms` };
              return (
                <tr key={i} className="border-b border-black/5 last:border-0 dark:border-white/5">
                  <td className="px-4 py-2.5">
                    <div className="skeleton h-4 w-4 rounded-md" style={delay} />
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="skeleton h-[22px] w-[22px] rounded-full" style={delay} />
                      <div className="skeleton h-4 w-24 rounded-md" style={delay} />
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="skeleton mx-auto h-4 w-5 rounded-md" style={delay} />
                  </td>
                  {!compact && (
                    <>
                      <td className="hidden px-2 py-2.5 sm:table-cell">
                        <div className="skeleton mx-auto h-4 w-5 rounded-md" style={delay} />
                      </td>
                      <td className="hidden px-2 py-2.5 sm:table-cell">
                        <div className="skeleton mx-auto h-4 w-5 rounded-md" style={delay} />
                      </td>
                      <td className="hidden px-2 py-2.5 sm:table-cell">
                        <div className="skeleton mx-auto h-4 w-5 rounded-md" style={delay} />
                      </td>
                      <td className="hidden px-2 py-2.5 md:table-cell">
                        <div className="skeleton mx-auto h-4 w-6 rounded-md" style={delay} />
                      </td>
                      <td className="hidden px-2 py-2.5 md:table-cell">
                        <div className="skeleton mx-auto h-4 w-6 rounded-md" style={delay} />
                      </td>
                    </>
                  )}
                  <td className="px-2 py-2.5">
                    <div className="skeleton mx-auto h-4 w-6 rounded-md" style={delay} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="skeleton ml-auto h-4 w-7 rounded-md" style={delay} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
