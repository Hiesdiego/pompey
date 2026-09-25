/**
 * Leaderboard page (spec P3.9): username, favourite team, win-loss record.
 * Usernames resolve from the device-local directory (backend-deferred);
 * unknown addresses render truncated.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Crown } from "lucide-react";
import { useTickr } from "../hooks/useTickr";
import { api, type ApiPlayer } from "../lib/api";
import { formatTick, formatWinRateBps, truncateAddress } from "../lib/format";
import { resolveIdentity } from "../lib/profile";
import { TeamBadge } from "../components/TeamBadge";
import { SectionTitle, ErrorState, EmptyState, SkeletonRows } from "../components/States";
import { cn } from "../lib/cn";

const RANK_STYLE = [
  "bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-[0_0_12px_rgba(251,191,36,.5)]",
  "bg-gradient-to-br from-zinc-200 to-zinc-400 text-zinc-700 shadow-[0_0_10px_rgba(160,160,170,.4)] dark:from-zinc-400 dark:to-zinc-600 dark:text-white",
  "bg-gradient-to-br from-amber-500 to-amber-700 text-white shadow-[0_0_10px_rgba(180,120,40,.45)]",
];

export default function LeaderboardPage() {
  const { playerAddress } = useTickr();
  const [players, setPlayers] = useState<ApiPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .leaderboard()
      .then((p) => {
        if (alive) setPlayers(p);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div>
      <SectionTitle title="Leaderboard" />
      <p className="mb-6 font-display text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
        Ranked by win rate · {players?.length ?? "—"} predictors
      </p>

      {!players ? (
        <SkeletonRows rows={8} />
      ) : players.length === 0 ? (
        <EmptyState title="No predictors yet.">
          Be the first to stake on a match and claim your spot.
        </EmptyState>
      ) : (
        <div className="glass overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-black/8 bg-white/70 text-left text-[11px] uppercase tracking-widest text-zinc-500 backdrop-blur-xl dark:border-white/8 dark:bg-black/60 dark:text-zinc-500">
                <th className="px-4 py-3">#</th>
                <th className="px-2 py-3">Predictor</th>
                <th className="px-2 py-3">Team</th>
                <th className="px-2 py-3 text-center">W</th>
                <th className="px-2 py-3 text-center">D</th>
                <th className="px-2 py-3 text-center">L</th>
                <th className="px-2 py-3 text-center">Win rate</th>
                <th className="px-4 py-3 text-right">Won</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => {
                const identity = resolveIdentity(p.address);
                const isYou =
                  !!playerAddress &&
                  p.address.toLowerCase() === playerAddress.toLowerCase();
                const label = isYou
                  ? `${identity.username ?? "You"} (you)`
                  : (identity.username ?? truncateAddress(p.address));
                const profileHref = identity.username ? `/${identity.username}` : null;
                return (
                  <tr
                    key={p.address}
                    className={cn(
                      "border-b border-black/5 transition-colors last:border-0 hover:bg-[#2E7CF6]/6 dark:border-white/5 dark:hover:bg-[#2E7CF6]/8",
                      isYou && "bg-[#2E7CF6]/8 dark:bg-[#2E7CF6]/10"
                    )}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex h-7 w-7 items-center justify-center gap-1 rounded-full font-display text-xs font-bold",
                          RANK_STYLE[i] ??
                            "bg-black/5 text-zinc-500 dark:bg-white/8 dark:text-zinc-400"
                        )}
                      >
                        {i === 0 && <Crown className="h-3 w-3" />}
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-2 py-3 font-semibold text-zinc-800 dark:text-zinc-100">
                      {profileHref ? (
                        <Link
                          href={profileHref}
                          className="transition-colors hover:text-[#1D4ED8] hover:underline dark:hover:text-[#7db3ff]"
                        >
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                    </td>
                    <td className="px-2 py-3">
                      {identity.favouriteTeamId !== null ? (
                        <TeamBadge
                          teamId={identity.favouriteTeamId}
                          size={22}
                          showName={false}
                          showSymbol
                        />
                      ) : (
                        <span className="text-zinc-400 dark:text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-center font-display tabular-nums text-[#0f7a55] dark:text-[#7fe0bd]">{p.wins}</td>
                    <td className="px-2 py-3 text-center font-display tabular-nums text-zinc-500 dark:text-zinc-400">{p.draws}</td>
                    <td className="px-2 py-3 text-center font-display tabular-nums text-red-500 dark:text-red-400">{p.losses}</td>
                    <td className="px-2 py-3 text-center font-display font-bold tabular-nums text-zinc-900 dark:text-white">
                      {formatWinRateBps(p.winRateBps)}
                    </td>
                    <td className="px-4 py-3 text-right font-display tabular-nums text-zinc-600 dark:text-zinc-300">
                      {formatTick(p.totalWonTick, 0)} TICK
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
