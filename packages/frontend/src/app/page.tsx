/**
 * Home page (spec P3.4): hero, live price ticker, live/closing-soon
 * matches, league table snapshot, leaderboard preview.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Flame, Table2, Trophy } from "lucide-react";
import { useTickr } from "../hooks/useTickr";
import { useLiveFeed } from "../hooks/useLiveFeed";
import { api, type ApiFixture, type ApiPlayer, type ApiTableRow } from "../lib/api";
import { isoToMs } from "../lib/format";
import { FixtureCard, fixtureStatus } from "../components/FixtureCard";
import { SectionTitle, LoadingState, ErrorState, SkeletonCards, SkeletonRows } from "../components/States";
import { TeamBadge } from "../components/TeamBadge";
import { truncateAddress } from "../lib/format";
import { resolveIdentity } from "../lib/profile";

function PriceTicker() {
  const { prices } = useLiveFeed(true);
  const items = useMemo(() => {
    const list = Object.values(prices).filter((p) => p.price !== null && p.ok);
    list.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return list;
  }, [prices]);

  if (items.length === 0) return null;

  const row = (key: string) => (
    <div key={key} className="flex shrink-0 items-center" aria-hidden={key !== "a"}>
      {items.map((p) => (
        <span
          key={`${key}-${p.teamId}`}
          className="mx-4 inline-flex items-center gap-1.5 font-display text-xs font-semibold tabular-nums text-zinc-500 dark:text-zinc-400"
        >
          <span className="text-zinc-700 dark:text-zinc-300">{p.symbol}</span>
          <span>${Number(p.price).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
          <span className="h-1 w-1 rounded-full bg-[#2E7CF6]/60" />
        </span>
      ))}
    </div>
  );

  return (
    <div className="relative mb-8 overflow-hidden rounded-2xl border border-black/8 bg-black/[.02] py-2.5 dark:border-white/8 dark:bg-white/[.02]">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-white to-transparent dark:from-black" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-white to-transparent dark:from-black" />
      <div className="flex w-max animate-marquee">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}

const RANK_MEDAL = [
  "text-amber-500 dark:text-amber-400",
  "text-zinc-400 dark:text-zinc-300",
  "text-amber-700 dark:text-amber-600",
];

export default function HomePage() {
  const { authenticated, login, playerAddress } = useTickr();
  const { fixtureUpdates } = useLiveFeed(true);
  const [fixtures, setFixtures] = useState<ApiFixture[] | null>(null);
  const [table, setTable] = useState<ApiTableRow[] | null>(null);
  const [leaders, setLeaders] = useState<ApiPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.fixtures(), api.table(), api.leaderboard()])
      .then(([f, t, l]) => {
        if (!alive) return;
        setFixtures(f);
        setTable(t);
        setLeaders(l);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const spotlight = useMemo(() => {
    if (!fixtures) return { live: [], closing: [] };
    const now = Date.now();
    const live: ApiFixture[] = [];
    const closing: ApiFixture[] = [];
    for (const f of fixtures) {
      const status = fixtureStatus(f, fixtureUpdates[f.fixtureId]);
      if (status === "live") live.push(f);
      else if (status === "upcoming") {
        const kickoff = fixtureUpdates[f.fixtureId]?.kickoffMs ?? isoToMs(f.kickoff);
        if (kickoff !== null && kickoff - now < 2 * 3600_000) closing.push(f);
      }
    }
    const byKickoff = (a: ApiFixture, b: ApiFixture) =>
      (isoToMs(a.kickoff) ?? Infinity) - (isoToMs(b.kickoff) ?? Infinity);
    live.sort(byKickoff);
    closing.sort(byKickoff);
    return { live: live.slice(0, 3), closing: closing.slice(0, 3) };
  }, [fixtures, fixtureUpdates]);

  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <PriceTicker />

      {/* Hero */}
      <section className="glass relative overflow-hidden rounded-3xl p-8 md:p-12">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#2E7CF6]/20 blur-3xl dark:bg-[#2E7CF6]/25"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-[#1D4ED8]/10 blur-3xl dark:bg-[#1D4ED8]/15"
          aria-hidden
        />
        <div className="relative max-w-2xl">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#2E7CF6]/25 bg-[#2E7CF6]/8 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#1D4ED8] dark:bg-[#2E7CF6]/12 dark:text-[#7db3ff]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2E7CF6] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#2E7CF6]" />
            </span>
            Season 1 · live on Base Sepolia
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-zinc-900 md:text-6xl dark:text-white">
            Predict the market.{" "}
            <span className="text-gradient-animate">Win TICK.</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-zinc-500 md:text-base dark:text-zinc-400">
            Twenty crypto teams. Every match is decided by real price performance
            over a 20-minute window. Stake TICK on home win, draw, or away win —
            winners split the pool.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            {authenticated ? (
              <Link
                href="/fixtures"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] px-6 py-3 text-sm font-bold text-white shadow-[0_0_28px_rgba(46,124,246,.45)] transition-all hover:shadow-[0_0_40px_rgba(46,124,246,.6)] active:scale-[.98]"
              >
                Browse fixtures <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <button
                onClick={login}
                className="rounded-xl bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] px-6 py-3 text-sm font-bold text-white shadow-[0_0_28px_rgba(46,124,246,.45)] transition-all hover:shadow-[0_0_40px_rgba(46,124,246,.6)] active:scale-[.98]"
              >
                Sign in & play — it's gasless
              </button>
            )}
            <Link
              href="/leaderboard"
              className="rounded-xl border border-black/10 bg-white/60 px-6 py-3 text-sm font-bold text-zinc-700 backdrop-blur-xl transition-all hover:border-[#2E7CF6]/40 hover:text-[#1D4ED8] active:scale-[.98] dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-[#2E7CF6]/40 dark:hover:text-[#7db3ff]"
            >
              Leaderboard
            </Link>
          </div>
        </div>
      </section>

      {/* Live + closing soon */}
      <section>
        <SectionTitle
          title="Happening now"
          action={
            <Link
              href="/fixtures"
              className="text-sm font-semibold text-[#1D4ED8] transition-colors hover:text-[#2E7CF6] dark:text-[#7db3ff] dark:hover:text-[#4B93FF]"
            >
              All fixtures
            </Link>
          }
        />
        {!fixtures ? (
          <SkeletonCards cards={3} />
        ) : spotlight.live.length === 0 && spotlight.closing.length === 0 ? (
          <p className="glass rounded-2xl p-6 text-center text-sm text-zinc-500 dark:text-zinc-500">
            No matches live right now — check the fixtures calendar for upcoming games.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {spotlight.live.map((f) => (
              <FixtureCard key={f.fixtureId} fixture={f} liveUpdate={fixtureUpdates[f.fixtureId]} />
            ))}
            {spotlight.closing.map((f) => (
              <FixtureCard key={f.fixtureId} fixture={f} liveUpdate={fixtureUpdates[f.fixtureId]} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* League table snapshot */}
        <section>
          <SectionTitle
            title="League table"
            action={
              <Link
                href="/fixtures"
                className="inline-flex items-center gap-1 text-sm font-semibold text-[#1D4ED8] transition-colors hover:text-[#2E7CF6] dark:text-[#7db3ff] dark:hover:text-[#4B93FF]"
              >
                <Table2 className="h-4 w-4" /> Full season
              </Link>
            }
          />
          {!table ? (
            <SkeletonRows rows={5} />
          ) : (
            <div className="glass overflow-hidden rounded-2xl">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="border-b border-black/8 text-left text-[11px] uppercase tracking-widest text-zinc-500 dark:border-white/8 dark:text-zinc-500">
                    <th className="px-4 py-2.5">#</th>
                    <th className="px-2 py-2.5">Team</th>
                    <th className="px-2 py-2.5 text-center">P</th>
                    <th className="px-2 py-2.5 text-center">GD</th>
                    <th className="px-4 py-2.5 text-right">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {table.slice(0, 5).map((row, i) => (
                    <tr
                      key={row.teamId}
                      className="border-b border-black/5 transition-colors last:border-0 hover:bg-[#2E7CF6]/6 dark:border-white/5 dark:hover:bg-[#2E7CF6]/8"
                    >
                      <td className={`px-4 py-2.5 font-display font-bold ${RANK_MEDAL[i] ?? "text-zinc-400 dark:text-zinc-500"}`}>
                        {i + 1}
                      </td>
                      <td className="px-2 py-2.5">
                        <TeamBadge teamId={row.teamId} size={22} />
                      </td>
                      <td className="px-2 py-2.5 text-center tabular-nums text-zinc-500 dark:text-zinc-400">{row.played}</td>
                      <td className="px-2 py-2.5 text-center tabular-nums text-zinc-500 dark:text-zinc-400">
                        {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                      </td>
                      <td className="px-4 py-2.5 text-right font-display font-bold tabular-nums text-zinc-900 dark:text-white">
                        {row.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Leaderboard preview */}
        <section>
          <SectionTitle
            title="Top predictors"
            action={
              <Link
                href="/leaderboard"
                className="inline-flex items-center gap-1 text-sm font-semibold text-[#1D4ED8] transition-colors hover:text-[#2E7CF6] dark:text-[#7db3ff] dark:hover:text-[#4B93FF]"
              >
                <Trophy className="h-4 w-4" /> Full board
              </Link>
            }
          />
          {!leaders ? (
            <SkeletonRows rows={5} />
          ) : leaders.length === 0 ? (
            <p className="glass rounded-2xl p-6 text-center text-sm text-zinc-500 dark:text-zinc-500">
              No predictors yet — be the first to stake.
            </p>
          ) : (
            <div className="space-y-2">
              {leaders.slice(0, 5).map((p, i) => {
                const identity = resolveIdentity(p.address);
                const isYou =
                  playerAddress && p.address.toLowerCase() === playerAddress.toLowerCase();
                const label = isYou
                  ? `${identity.username ?? "You"} (you)`
                  : (identity.username ?? truncateAddress(p.address));
                return (
                  <div
                    key={p.address}
                    className={`glass card-interactive flex items-center gap-3 rounded-2xl px-4 py-3 ${
                      isYou ? "border-[#2E7CF6]/40!" : ""
                    }`}
                  >
                    <span className={`w-6 text-center font-display font-bold ${RANK_MEDAL[i] ?? "text-zinc-400 dark:text-zinc-500"}`}>
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate font-semibold text-zinc-800 dark:text-zinc-100">{label}</span>
                    <span className="font-display text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
                      {p.wins}W–{p.draws}D–{p.losses}L
                    </span>
                    {i === 0 && <Flame className="h-4 w-4 text-amber-500 dark:text-amber-400" />}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
