"use client";

/**
 * Arena data page: Weekly Meme Cup bracket, past cups and rankings.
 *
 * Target location in the repo:
 *   packages/frontend/src/app/arena/page.tsx
 *
 * Same surface-card styling as the rest of the app. Three sections:
 *   1. The current cup bracket. Rounds render as stacked sections,
 *      ties show seeds, logos, the linked clash and the winner. Every
 *      tie has two memes: the field is cut to the largest power of
 *      two at or below the qualifier count, so there are no byes.
 *   2. Past cups: week, champion and runner-up with logos.
 *   3. Rankings: rank, logo, name, points, wins, losses and titles,
 *      up to 140 rows. Rankings come from cup matches only. They
 *      never affect qualification or seeding, and the table says so.
 */

import Link from "next/link";
import { Trophy } from "lucide-react";
import { useArenaCups, useArenaRankings, useCurrentCup } from "../../lib/query/useArena";
import type { CupTie, RankingSide } from "../../lib/arenaContracts";
import { arenaDisplaySymbol } from "../../lib/arenaContracts";
import { formatUtcDate } from "../../lib/utcTime";
import { MemeLogo } from "../../components/MemeLogo";
import { SectionTitle, EmptyState, ErrorState, SkeletonCards } from "../../components/States";
import { cn } from "../../lib/cn";

function roundLabel(round: number, totalRounds: number): string {
  if (round === totalRounds - 1) return "Final";
  if (round === totalRounds - 2) return "Semi-finals";
  if (round === totalRounds - 3) return "Quarter-finals";
  return `Round ${round + 1}`;
}

function SideRow({ side, seed, isWinner }: { side: RankingSide | null; seed: number | null; isWinner: boolean }) {
  if (!side) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-black/[.03] px-3 py-2 text-sm text-zinc-500 dark:bg-white/[.04]">
        <span className="text-xs font-bold tabular-nums">{seed !== null ? `#${seed}` : ""}</span>
        <span>To be decided</span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-2 text-sm",
        isWinner ? "bg-emerald-500/[.08] font-bold" : "bg-black/[.03] dark:bg-white/[.04]"
      )}
    >
      <span className="w-8 shrink-0 text-xs font-bold tabular-nums text-zinc-500">{seed !== null ? `#${seed}` : ""}</span>
      <MemeLogo symbol={side.symbol} logoUrl={side.logoUrl} imageUrl={side.imageUrl} size={28} />
      <span className="min-w-0 flex-1 truncate">
        {side.name} <span className="text-zinc-500">({arenaDisplaySymbol(side.symbol)})</span>
      </span>
      {isWinner && <span className="shrink-0 text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Winner</span>}
    </div>
  );
}

function TieCard({ tie, round, totalRounds }: { tie: CupTie; round: number; totalRounds: number }) {
  void round;
  void totalRounds;
  const winnerIsA = tie.winner !== null && tie.memeA !== null && tie.winner.toLowerCase() === tie.memeA.address.toLowerCase();
  const winnerIsB = tie.winner !== null && tie.memeB !== null && tie.winner.toLowerCase() === tie.memeB.address.toLowerCase();
  const body = (
    <div className="space-y-2">
      <SideRow side={tie.memeA} seed={tie.seedA} isWinner={winnerIsA} />
      <SideRow side={tie.memeB} seed={tie.seedB} isWinner={winnerIsB} />
      <p className="text-xs text-zinc-500">
        {tie.memeB === null && tie.memeA !== null
          ? "Waiting for the opponent to be decided."
          : tie.status === "settled"
            ? "Settled"
            : tie.status === "inplay"
              ? "In play"
              : tie.status === "voided"
                ? "Voided"
                : "Upcoming"}
        {tie.clashId !== null ? ` · Clash #${tie.clashId}` : ""}
      </p>
    </div>
  );
  if (tie.clashId !== null) {
    return (
      <Link href={`/arena/clash/${tie.clashId}`} className="surface-card block rounded-2xl p-4 transition hover:border-[#2E7CF6]/40">
        {body}
      </Link>
    );
  }
  return <div className="surface-card rounded-2xl p-4">{body}</div>;
}

function CupSide({ label, side }: { label: string; side: RankingSide | null }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">{label}</span>
      {side ? (
        <>
          <MemeLogo symbol={side.symbol} logoUrl={side.logoUrl} imageUrl={side.imageUrl} size={24} />
          <span className="truncate font-semibold">{side.name}</span>
          <span className="text-xs text-zinc-500">({arenaDisplaySymbol(side.symbol)})</span>
        </>
      ) : (
        <span className="text-zinc-500">To be decided</span>
      )}
    </span>
  );
}

export default function ArenaPage() {
  const currentCupQuery = useCurrentCup();
  const cupsQuery = useArenaCups();
  const rankingsQuery = useArenaRankings();

  const cup = currentCupQuery.data?.cup ?? null;
  const cups = (cupsQuery.data?.cups ?? []).filter((cup) => cup.status === "completed");
  const rankings = (rankingsQuery.data?.rankings ?? []).slice(0, 140);
  const loading = currentCupQuery.isLoading || cupsQuery.isLoading || rankingsQuery.isLoading;
  const error = currentCupQuery.error ?? cupsQuery.error ?? rankingsQuery.error;

  if (loading) {
    return (
      <div className="py-10">
        <SectionTitle title="Meme Arena" />
        <SkeletonCards cards={6} />
      </div>
    );
  }
  if (error && !cup && cups.length === 0 && rankings.length === 0) {
    return (
      <div className="py-10">
        <SectionTitle title="Meme Arena" />
        <ErrorState message={error instanceof Error ? error.message : "Could not load arena data."} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="pb-14">
      <div className="mb-6 rounded-3xl border border-pink-500/20 bg-gradient-to-br from-pink-500/15 via-fuchsia-500/5 to-transparent p-6"><p className="mb-2 text-sm font-bold uppercase tracking-widest text-pink-600 dark:text-pink-400">The Weekly Meme Cup</p><h1 className="font-display text-3xl font-black">Meme Arena</h1><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Follow the bracket, celebrate the champions, and track the memes climbing the rankings.</p></div>
      <p className="mb-8 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        The Weekly Meme Cup and the cup rankings. Memes qualify on age, liquidity and trailing 7 day volume. Rankings come from cup matches only and never affect qualification or seeding.
      </p>

      <section className="mb-10">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-zinc-950 dark:text-white">
          <Trophy className="h-5 w-5 text-amber-500" /> Current cup
        </h2>
        {currentCupQuery.isError ? <ErrorState message="Could not load the current cup." onRetry={() => void currentCupQuery.refetch()} /> : !cup ? (
          <EmptyState title="No cup running right now" message="The next cup is seeded on Monday at 00:00 UTC. Past cups and rankings are below." />
        ) : (
          <div className="space-y-8">
            <p className="text-sm text-zinc-500">
              Week of {formatUtcDate(cup.weekStart)} · Status: {cup.status}
            </p>
            {cup.rounds.map((round) => (
              <div key={round.round}>
                <h3 className="mb-3 font-display text-base font-bold">{roundLabel(round.round, cup.rounds.length)}</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {round.ties.map((tie) => (
                    <TieCard key={tie.tieIndex} tie={tie} round={round.round} totalRounds={cup.rounds.length} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="past-cups" className="mb-10 scroll-mt-36">
        <h2 className="mb-4 font-display text-lg font-bold text-zinc-950 dark:text-white">Past cups</h2>
        {cupsQuery.isError ? <ErrorState message="Could not load past cups." onRetry={() => void cupsQuery.refetch()} /> : cups.length === 0 ? (
          <EmptyState title="No past cups yet" message="Finished cups will appear here with their champion and runner-up." />
        ) : (
          <div className="space-y-3">
            {cups.map((past) => (
              <div key={String(past.id)} className="surface-card flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl p-4">
                <span className="font-display text-sm font-bold tabular-nums">{formatUtcDate(past.weekStart)}</span>
                <span className="text-sm text-zinc-500">{past.bracketSize} bracket · {past.fieldSize} qualified · {past.status}</span>
                <CupSide label="Champion" side={past.champion} />
                <CupSide label="Runner-up" side={past.runnerUp} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-display text-lg font-bold text-zinc-950 dark:text-white">Rankings</h2>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          Elo style points from cup matches only, starting at 1000. Rankings never affect qualification or seeding.
          {rankingsQuery.data?.updatedAt ? ` Updated ${formatUtcDate(rankingsQuery.data.updatedAt)}.` : ""}
        </p>
        {rankingsQuery.isError ? <ErrorState message="Could not load rankings." onRetry={() => void rankingsQuery.refetch()} /> : rankings.length === 0 ? (
          <EmptyState title="No rankings yet" message="Rankings appear after the first cup matches settle." />
        ) : (
          <div className="surface-card overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/[.06] text-xs uppercase tracking-wider text-zinc-400 dark:border-white/[.07]">
                  <th className="px-4 py-3 font-bold">Rank</th>
                  <th className="px-4 py-3 font-bold">Meme</th>
                  <th className="px-4 py-3 text-right font-bold">Points</th>
                  <th className="px-4 py-3 text-right font-bold">Wins</th>
                  <th className="px-4 py-3 text-right font-bold">Losses</th>
                  <th className="px-4 py-3 text-right font-bold">Cups</th>
                  <th className="px-4 py-3 text-right font-bold">Titles</th>
                </tr>
              </thead>
              <tbody>
                {rankings.map((row) => (
                  <tr key={row.address} className="border-b border-black/[.04] last:border-0 dark:border-white/[.05]">
                    <td className="px-4 py-3 font-display font-bold tabular-nums">{row.rank}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <MemeLogo symbol={row.symbol} logoUrl={row.logoUrl} imageUrl={row.imageUrl} size={28} />
                        <span className="font-semibold">{row.name}</span>
                        <span className="text-xs text-zinc-500">({arenaDisplaySymbol(row.symbol)})</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-display font-bold tabular-nums">{row.points.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.wins}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.losses}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.appearances}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.titles}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
