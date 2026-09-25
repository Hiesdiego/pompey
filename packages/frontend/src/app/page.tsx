/**
 * Home page (spec P3.4): hero, live/closing-soon matches, league table
 * snapshot, leaderboard preview.
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
import { SectionTitle, LoadingState, ErrorState } from "../components/States";
import { TeamBadge } from "../components/TeamBadge";
import { truncateAddress } from "../lib/format";
import { resolveIdentity } from "../lib/profile";

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
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-br from-[#1b1a2e] via-[#141416] to-[#0e1f19] p-8 md:p-12">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-black tracking-tight text-white md:text-5xl">
            Predict the market.{" "}
            <span className="bg-gradient-to-r from-[#7F77DD] to-[#1D9E75] bg-clip-text text-transparent">
              Win TICK.
            </span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-zinc-400 md:text-base">
            Twenty crypto teams. Every match is decided by real price performance
            over a 20-minute window. Stake TICK on home win, draw, or away win —
            winners split the pool.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {authenticated ? (
              <Link
                href="/fixtures"
                className="inline-flex items-center gap-2 rounded-xl bg-[#7F77DD] px-6 py-3 text-sm font-bold text-white hover:bg-[#6f68d6]"
              >
                Browse fixtures <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <button
                onClick={login}
                className="rounded-xl bg-[#7F77DD] px-6 py-3 text-sm font-bold text-white hover:bg-[#6f68d6]"
              >
                Sign in & play — it's gasless
              </button>
            )}
            <Link
              href="/leaderboard"
              className="rounded-xl border border-zinc-700 px-6 py-3 text-sm font-bold text-zinc-200 hover:border-zinc-500"
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
            <Link href="/fixtures" className="text-sm font-medium text-[#7F77DD] hover:underline">
              All fixtures
            </Link>
          }
        />
        {!fixtures ? (
          <LoadingState label="Loading fixtures…" />
        ) : spotlight.live.length === 0 && spotlight.closing.length === 0 ? (
          <p className="rounded-2xl border border-zinc-800 bg-[#141416] p-6 text-center text-sm text-zinc-500">
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
              <Link href="/fixtures" className="inline-flex items-center gap-1 text-sm font-medium text-[#7F77DD] hover:underline">
                <Table2 className="h-4 w-4" /> Full season
              </Link>
            }
          />
          {!table ? (
            <LoadingState />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-[#141416]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="px-4 py-2.5">#</th>
                    <th className="px-2 py-2.5">Team</th>
                    <th className="px-2 py-2.5 text-center">P</th>
                    <th className="px-2 py-2.5 text-center">GD</th>
                    <th className="px-4 py-2.5 text-right">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {table.slice(0, 5).map((row, i) => (
                    <tr key={row.teamId} className="border-b border-zinc-800/50 last:border-0">
                      <td className="px-4 py-2.5 font-bold text-zinc-400">{i + 1}</td>
                      <td className="px-2 py-2.5">
                        <TeamBadge teamId={row.teamId} size={22} />
                      </td>
                      <td className="px-2 py-2.5 text-center text-zinc-400">{row.played}</td>
                      <td className="px-2 py-2.5 text-center text-zinc-400">
                        {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-white">{row.points}</td>
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
              <Link href="/leaderboard" className="inline-flex items-center gap-1 text-sm font-medium text-[#7F77DD] hover:underline">
                <Trophy className="h-4 w-4" /> Full board
              </Link>
            }
          />
          {!leaders ? (
            <LoadingState />
          ) : leaders.length === 0 ? (
            <p className="rounded-2xl border border-zinc-800 bg-[#141416] p-6 text-center text-sm text-zinc-500">
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
                    className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-[#141416] px-4 py-3"
                  >
                    <span className="w-6 text-center font-black text-zinc-500">{i + 1}</span>
                    <span className="flex-1 truncate font-semibold text-zinc-100">{label}</span>
                    <span className="text-sm text-zinc-400">
                      {p.wins}W–{p.draws}D–{p.losses}L
                    </span>
                    {i === 0 && <Flame className="h-4 w-4 text-amber-400" />}
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
