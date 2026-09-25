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
            <Link
              href="/leaderboard"
              className="font-semibold text-[#1D4ED8] hover:underline dark:text-[#7db3ff]"
            >
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
    { label: "Win rate", value: formatWinRateBps(player.winRateBps), icon: <Target className="h-4 w-4 text-[#2E7CF6]" /> },
    { label: "Current streak", value: `${player.currentStreak}`, icon: <Flame className="h-4 w-4 text-amber-500 dark:text-amber-400" /> },
    { label: "Longest streak", value: `${player.longestStreak}` },
    { label: "Total staked", value: `${formatTick(player.totalStakedTick, 0)} TICK` },
    { label: "Total won", value: `${formatTick(player.totalWonTick, 0)} TICK` },
  ];

  return (
    <div>
      <Link
        href="/leaderboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-[#1D4ED8] dark:text-zinc-400 dark:hover:text-[#7db3ff]"
      >
        <ArrowLeft className="h-4 w-4" /> Leaderboard
      </Link>

      <div className="glass relative mb-6 flex flex-col items-start gap-4 overflow-hidden rounded-3xl p-6 sm:flex-row sm:items-center">
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#2E7CF6]/15 blur-3xl dark:bg-[#2E7CF6]/20"
          aria-hidden
        />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2E7CF6] to-[#1D4ED8] font-display text-2xl font-bold text-white shadow-[0_0_28px_rgba(46,124,246,.45)]">
          {username.slice(0, 1).toUpperCase()}
        </span>
        <div className="relative flex-1">
          <h1 className="font-display text-2xl font-bold text-zinc-900 dark:text-white">@{username}</h1>
          <p className="font-mono text-xs text-zinc-500">
            {truncateAddress(player.address, 6)}
          </p>
          {identity.favouriteTeamId !== null && (
            <div className="mt-2 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <span>Favourite team:</span>
              <TeamBadge teamId={identity.favouriteTeamId} size={22} />
            </div>
          )}
        </div>
        {rank !== null && (
          <div className="relative rounded-2xl border border-black/8 bg-black/[.03] px-5 py-3 text-center dark:border-white/8 dark:bg-white/[.03]">
            <p className="font-display text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">#{rank}</p>
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">rank</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="glass card-interactive rounded-2xl p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
              {s.icon}
              {s.label}
            </p>
            <p className="mt-1 font-display text-xl font-bold tabular-nums text-zinc-900 dark:text-white">
              {s.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
