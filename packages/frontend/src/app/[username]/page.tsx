/**
 * Profile page (spec P3.10): /[username] — public profile with stats.
 * Identity resolves from the device-local username directory
 * (on-chain/DB identity is backend-deferred).
 */

"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Flame, Target } from "lucide-react";
import { api, type ApiPlayer } from "../../lib/api";
import { findAddressByUsername, resolveIdentity } from "../../lib/profile";
import { formatTick, formatWinRateBps, truncateAddress } from "../../lib/format";
import { TeamBadge } from "../../components/TeamBadge";
import { LoadingState, ErrorState, EmptyState } from "../../components/States";

export default function ProfilePage() {
  const params = useParams();
  const username = decodeURIComponent(params.username as string);
  const [player, setPlayer] = useState<ApiPlayer | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    const address = findAddressByUsername(username);
    if (!address) {
      setNotFound(true);
      return;
    }
    Promise.all([api.player(address), api.leaderboard()])
      .then(([p, board]) => {
        if (!alive) return;
        setPlayer(p);
        const idx = board.findIndex(
          (b) => b.address.toLowerCase() === address.toLowerCase()
        );
        setRank(idx >= 0 ? idx + 1 : null);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [username]);

  if (notFound) {
    return (
      <div className="py-10">
        <EmptyState title={`No profile found for “${username}”.`}>
          Usernames are stored on each device for now — this profile hasn't been
          created on this device yet.
          <div className="mt-3">
            <Link href="/leaderboard" className="text-[#7F77DD] hover:underline">
              Back to leaderboard
            </Link>
          </div>
        </EmptyState>
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (!player) return <LoadingState label="Loading profile…" />;

  const identity = resolveIdentity(player.address);
  const stats: Array<{ label: string; value: string; icon?: ReactNode }> = [
    { label: "Wins", value: String(player.wins) },
    { label: "Draws", value: String(player.draws) },
    { label: "Losses", value: String(player.losses) },
    { label: "Win rate", value: formatWinRateBps(player.winRateBps), icon: <Target className="h-4 w-4" /> },
    { label: "Current streak", value: `${player.currentStreak}`, icon: <Flame className="h-4 w-4" /> },
    { label: "Longest streak", value: `${player.longestStreak}` },
    { label: "Total staked", value: `${formatTick(player.totalStakedTick, 0)} TICK` },
    { label: "Total won", value: `${formatTick(player.totalWonTick, 0)} TICK` },
  ];

  return (
    <div>
      <Link
        href="/leaderboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" /> Leaderboard
      </Link>

      <div className="mb-6 flex flex-col items-start gap-4 rounded-3xl border border-zinc-800 bg-[#141416] p-6 sm:flex-row sm:items-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7F77DD] to-[#1D9E75] text-2xl font-black text-white">
          {username.slice(0, 1).toUpperCase()}
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-black text-white">@{username}</h1>
          <p className="font-mono text-xs text-zinc-500">
            {truncateAddress(player.address, 6)}
          </p>
          {identity.favouriteTeamId !== null && (
            <div className="mt-2 flex items-center gap-2 text-sm text-zinc-400">
              <span>Favourite team:</span>
              <TeamBadge teamId={identity.favouriteTeamId} size={22} />
            </div>
          )}
        </div>
        {rank !== null && (
          <div className="rounded-2xl bg-zinc-900 px-5 py-3 text-center">
            <p className="text-2xl font-black text-white">#{rank}</p>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">rank</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-zinc-800 bg-[#141416] p-4">
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
              {s.icon}
              {s.label}
            </p>
            <p className="mt-1 text-xl font-black text-white">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
