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
import { SectionTitle, LoadingState, ErrorState, EmptyState } from "../components/States";
import { cn } from "../lib/cn";

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
      <p className="mb-6 text-sm text-zinc-400">
        Ranked by win rate · {players?.length ?? "—"} predictors
      </p>

      {!players ? (
        <LoadingState label="Loading leaderboard…" />
      ) : players.length === 0 ? (
        <EmptyState title="No predictors yet.">
          Be the first to stake on a match and claim your spot.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-[#141416]">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wider text-zinc-500">
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
                      "border-b border-zinc-800/50 last:border-0",
                      isYou && "bg-[#7F77DD]/10"
                    )}
                  >
                    <td className="px-4 py-3">
                      <span className="inline-flex w-7 items-center justify-center gap-1 font-black text-zinc-400">
                        {i === 0 && <Crown className="h-3.5 w-3.5 text-amber-400" />}
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-2 py-3 font-semibold text-zinc-100">
                      {profileHref ? (
                        <Link href={profileHref} className="hover:text-[#7F77DD] hover:underline">
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
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-center text-[#1D9E75]">{p.wins}</td>
                    <td className="px-2 py-3 text-center text-zinc-400">{p.draws}</td>
                    <td className="px-2 py-3 text-center text-red-400">{p.losses}</td>
                    <td className="px-2 py-3 text-center font-semibold text-white">
                      {formatWinRateBps(p.winRateBps)}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-300">
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
