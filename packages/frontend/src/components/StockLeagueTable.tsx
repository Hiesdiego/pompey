/**
 * StockLeagueTable, shared stock standings table.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/StockLeagueTable.tsx
 *
 * Reuses the LeagueTable pattern verbatim: same columns, same styling,
 * same rank medals. Two deliberate differences from crypto:
 *   1. Badges come from the stock roster (stockTeams.ts), not the crypto
 *      TeamBadge. Crypto teamIds 0 to 11 are different assets, so reusing
 *      the crypto badge would print the wrong names and logos.
 *   2. Rows decided by forfeit carry a FORFEIT badge. A forfeit counts
 *      as a 3-0 win for the opponent in P/W/D/L/GF/GA/GD/Pts, exactly like
 *      a played win, and the badge is the only visible marker.
 *
 * Logos are remote brand logos (see stockTeams.ts), verified live
 * Nov 18 2026. The local /public/stock-logos/ folder was never shipped,
 * so logos never point there. A failed logo falls back to a letter
 * avatar, it never blocks the row.
 *
 * Ordering: trust the backend order. The backend orders by points, then
 * goal difference, then goals scored, then wins, then fewest losses.
 * Do not re-sort here. If GF/GA arrive null (the backend background scan
 * has not finished), the standings page retries instead of rendering a
 * wrong table. See app/stocks/standings/page.tsx.
 *
 * Columns: P/W/D/L/GF/GA/GD/Pts. TP (TickrPoints) is NOT shown here.
 * TP is unified off-chain across crypto and stocks, and lives on the
 * player profile, not on a separate stock table.
 *
 * Season: 12 teams, 22 rounds, 132 fixtures, Nov 26 to Dec 16 2026.
 * Scoring reminder: 1 goal = 0.05% (5 bps), integer basis point math,
 * no-negative scorelines, max 10 goals per team per match, 3 pts win /
 * 1 draw / 0 loss, forfeit 3-0.
 */

"use client";

import { useState } from "react";
import { stockTeamById } from "../lib/stockTeams";
import type { StockApiTableRow } from "../lib/stockContracts";

const RANK_MEDAL = [
  "text-amber-500 dark:text-amber-400",
  "text-zinc-400 dark:text-zinc-300",
  "text-amber-700 dark:text-amber-600",
];

const gd = (v: number) => (v > 0 ? `+${v}` : `${v}`);

/**
 * Stock team badge: remote brand logo first, letter avatar fallback.
 * No CoinGecko dependency. The logo URL lives in stockTeams.ts and was
 * verified live Nov 18 2026. A missing logo never blocks the row, it
 * falls through to the letter avatar.
 */
export function StockTeamBadge({
  teamId,
  size = 22,
  showName = true,
}: {
  teamId: number;
  size?: number;
  showName?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const team = stockTeamById(teamId);
  if (!team) return <span className="text-sm text-zinc-500">Team #{teamId}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      {failed ? (
        <span
          className="flex items-center justify-center rounded-full bg-gradient-to-br from-[#2E7CF6] to-[#1D4ED8] font-display font-bold text-white"
          style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
          {team.symbol.slice(0, 1)}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logoPath}
          alt={team.symbol}
          width={size}
          height={size}
          onError={() => setFailed(true)}
          className="rounded-full bg-white ring-1 ring-black/10 dark:ring-white/10"
          style={{ width: size, height: size }}
        />
      )}
      {showName && (
        <span className="font-semibold text-zinc-800 dark:text-zinc-100">{team.name}</span>
      )}
    </span>
  );
}

export function StockLeagueTable({
  rows,
  limit,
  compact = false,
}: {
  rows: StockApiTableRow[];
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
                  <StockTeamBadge teamId={row.teamId} size={22} />
                  {(row.forfeits ?? 0) > 0 && (
                    <span
                      className="ml-2 rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
                      title={`${row.forfeits} fixture(s) decided by forfeit`}
                    >
                      FORFEIT
                    </span>
                  )}
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
