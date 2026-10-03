/**
 * Leaderboard page — two arenas:
 *  - Main League: the existing PlayerStats board (win-rate ranked), unchanged.
 *  - Prediction Markets: Supabase-backed, metric-filtered (PnL default).
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Crown } from "lucide-react";
import { useTickr } from "../../hooks/useTickr";
import { api, type ApiPlayer } from "../../lib/api";
import { social, type SocialMetric, type LeaderboardRow } from "../../lib/social";
import { SEASON_ID } from "../../lib/contracts";
import { formatTick, formatWinRateBps, truncateAddress } from "../../lib/format";
import { resolveIdentity } from "../../lib/profile";
import { TeamBadge } from "../../components/TeamBadge";
import { SectionTitle, ErrorState, EmptyState, SkeletonRows } from "../../components/States";
import { cn } from "../../lib/cn";

const RANK_STYLE = [
  "bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-[0_0_12px_rgba(251,191,36,.5)]",
  "bg-gradient-to-br from-zinc-200 to-zinc-400 text-zinc-700 shadow-[0_0_10px_rgba(160,160,170,.4)] dark:from-zinc-400 dark:to-zinc-600 dark:text-white",
  "bg-gradient-to-br from-amber-500 to-amber-700 text-white shadow-[0_0_10px_rgba(180,120,40,.45)]",
];

type Arena = "league" | "markets";

const METRICS: Array<{ id: SocialMetric; label: string; hint: string }> = [
  { id: "points", label: "Total points", hint: "10 per market created · 3 per correct prediction · 5 per resolved market" },
  { id: "correct", label: "Correct predictions", hint: "3 points per correct prediction" },
  { id: "created", label: "Markets created", hint: "10 points per market created" },
  { id: "resolved", label: "Markets resolved", hint: "5 points per market resolved" },
];

function metricValue(_metric: SocialMetric, v: string): { text: string; accent: string } {
  return { text: `${Number(v).toLocaleString()} pts`, accent: "text-[#2E7CF6]" };
}

function PredictorCell({ row, isYou }: { row: LeaderboardRow; isYou: boolean }) {
  const label = row.username ? `@${row.username}` : truncateAddress(row.walletAddress);
  const inner = (
    <span className="flex items-center gap-2.5">
      {row.favouriteTeamId !== null ? (
        <TeamBadge teamId={row.favouriteTeamId} size={26} showName={false} />
      ) : (
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-gradient-to-br from-[#2E7CF6] to-[#1D4ED8] font-display text-xs font-bold text-white">
          {(row.username ?? "?").slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="font-semibold text-zinc-800 dark:text-zinc-100">
        {label}
        {isYou && <span className="ml-1.5 text-xs font-medium text-zinc-400">(you)</span>}
      </span>
    </span>
  );
  return row.username ? (
    <Link
      href={`/${row.username}`}
      className="transition-colors hover:text-[#1D4ED8] hover:underline dark:hover:text-[#7db3ff]"
    >
      {inner}
    </Link>
  ) : (
    inner
  );
}

export default function LeaderboardPage() {
  const { playerAddress } = useTickr();
  const [arena, setArena] = useState<Arena>("markets");
  const [metric, setMetric] = useState<SocialMetric>("points");

  // Main league state
  const [players, setPlayers] = useState<ApiPlayer[] | null>(null);
  const [leagueError, setLeagueError] = useState<string | null>(null);

  // Markets board state
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [marketsError, setMarketsError] = useState<string | null>(null);

  useEffect(() => {
    if (arena !== "league" || players || leagueError) return;
    let alive = true;
    api
      .leaderboard()
      .then((p) => alive && setPlayers(p))
      .catch((e: Error) => alive && setLeagueError(e.message));
    return () => {
      alive = false;
    };
  }, [arena, players, leagueError]);

  useEffect(() => {
    if (arena !== "markets") return;
    let alive = true;
    setRows(null);
    setMarketsError(null);
    social
      .leaderboard(metric, Number(SEASON_ID))
      .then((b) => alive && setRows(b.rows))
      .catch((e: Error) => alive && setMarketsError(e.message));
    return () => {
      alive = false;
    };
  }, [arena, metric]);

  const error = arena === "league" ? leagueError : marketsError;
  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const activeMetric = METRICS.find((m) => m.id === metric)!;

  return (
    <div className="animate-page-in">
      <SectionTitle title="Leaderboard" />

      {/* arena segment */}
      <div className="mb-5 inline-flex rounded-2xl border border-black/10 bg-black/[.03] p-1 dark:border-white/10 dark:bg-white/[.03]">
        {(
          [
            { id: "markets", label: "Prediction Markets" },
            { id: "league", label: "Main League" },
          ] as Array<{ id: Arena; label: string }>
        ).map((a) => (
          <button
            key={a.id}
            onClick={() => setArena(a.id)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-bold transition-all active:scale-95",
              arena === a.id
                ? "bg-[#2E7CF6] text-white shadow-[0_0_16px_rgba(46,124,246,.45)]"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      {arena === "league" ? (
        <LeagueBoard players={players} playerAddress={playerAddress} />
      ) : (
        <MarketsBoard
          rows={rows}
          metric={metric}
          onMetric={setMetric}
          activeHint={activeMetric.hint}
          playerAddress={playerAddress}
        />
      )}
    </div>
  );
}

// ── main league board (existing PlayerStats table, unchanged) ─────────────────

function LeagueBoard({
  players,
  playerAddress,
}: {
  players: ApiPlayer[] | null;
  playerAddress: string | null;
}) {
  return (
    <div>
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

// ── prediction-markets board (metric-filtered) ───────────────────────────────

function MarketsBoard({
  rows,
  metric,
  onMetric,
  activeHint,
  playerAddress,
}: {
  rows: LeaderboardRow[] | null;
  metric: SocialMetric;
  onMetric: (m: SocialMetric) => void;
  activeHint: string;
  playerAddress: string | null;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {METRICS.map((m) => (
          <button
            key={m.id}
            onClick={() => onMetric(m.id)}
            title={m.hint}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-bold transition-all active:scale-95",
              metric === m.id
                ? "bg-[#2E7CF6] text-white shadow-[0_0_14px_rgba(46,124,246,.4)]"
                : "border border-black/10 text-zinc-500 hover:border-[#2E7CF6]/40 dark:border-white/10 dark:text-zinc-400"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mb-6 text-xs text-zinc-500 dark:text-zinc-400">
        {activeHint} · {rows?.length ?? "—"} predictors · Season {Number(SEASON_ID)}
      </p>

      {!rows ? (
        <SkeletonRows rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState title="No predictors yet.">
          Stake on a permissionless market and take the top spot.
        </EmptyState>
      ) : (
        <div className="glass overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-black/8 bg-white/70 text-left text-[11px] uppercase tracking-widest text-zinc-500 backdrop-blur-xl dark:border-white/8 dark:bg-black/60 dark:text-zinc-500">
                <th className="px-4 py-3">#</th>
                <th className="px-2 py-3">Predictor</th>
                <th className="px-2 py-3 text-center">Created</th>
                <th className="px-2 py-3 text-center">Correct</th>
                <th className="px-4 py-3 text-right">
                  {METRICS.find((m) => m.id === metric)?.label}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isYou =
                  !!playerAddress &&
                  r.walletAddress.toLowerCase() === playerAddress.toLowerCase();
                const mv = metricValue(metric, r.value);
                return (
                  <tr
                    key={r.walletAddress}
                    className={cn(
                      "border-b border-black/5 transition-colors last:border-0 hover:bg-[#2E7CF6]/6 dark:border-white/5 dark:hover:bg-[#2E7CF6]/8",
                      isYou && "bg-[#2E7CF6]/8 dark:bg-[#2E7CF6]/10"
                    )}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex h-7 w-7 items-center justify-center gap-1 rounded-full font-display text-xs font-bold",
                          RANK_STYLE[r.rank - 1] ??
                            "bg-black/5 text-zinc-500 dark:bg-white/8 dark:text-zinc-400"
                        )}
                      >
                        {r.rank === 1 && <Crown className="h-3 w-3" />}
                        {r.rank}
                      </span>
                    </td>
                    <td className="px-2 py-3">
                      <PredictorCell row={r} isYou={isYou} />
                    </td>
                    <td className="px-2 py-3 text-center font-display tabular-nums text-zinc-500 dark:text-zinc-400">{r.created}</td>
                    <td className="px-2 py-3 text-center font-display tabular-nums text-[#0f7a55] dark:text-[#7fe0bd]">{r.correct}</td>
                    <td className={cn("px-4 py-3 text-right font-display text-base font-bold tabular-nums text-zinc-900 dark:text-white", mv.accent)}>
                      {mv.text}
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
