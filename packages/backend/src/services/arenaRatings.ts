/**
 * Arena ratings: Elo-style meme rankings from Weekly Meme Cup matches
 * only.
 *
 * Intended destination: packages/backend/src/services/arenaRatings.ts.
 *
 * THE MATHS (pure, exported, unit-tested without chain or DB):
 *   - Every meme starts at START_RATING (1000) on its first cup
 *     appearance.
 *   - expectedScore(ra, rb) = 1 / (1 + 10^(-(ra - rb) / 400)), the
 *     standard Elo expectation.
 *   - eloUpdate is ZERO-SUM by construction: the winner gains
 *     k * (1 - expectedWinner) and the loser loses exactly the same
 *     amount (k * (0 - expectedLoser), and expectedLoser is
 *     1 - expectedWinner, so the two magnitudes are identical). No
 *     points are created or destroyed by a played tie.
 *   - K depends on the round (K_BY_ROUND, defined in
 *     arenaCupService.ts and re-exported here): later rounds move
 *     ratings more, because they are rarer and harder to reach.
 *     R32: 20, R16: 25, QF: 30, SF: 40, F: 60.
 *
 * WHAT COUNTS: ratings move ONLY on played cup ties. Byes do not move
 * ratings (no match was played). A double-void advancement does not
 * move ratings (no result was earned). Rankings NEVER affect cup
 * qualification or seeding: qualification is trailing volume, seeding
 * is qualification order, full stop (locked design).
 *
 * NO DECAY (user decision, 2026-11-20, explicit): there is NO decay,
 * NO regression to the mean, and NO periodic points reduction of any
 * kind in this file or anywhere in the arena stack. A meme's points
 * change only through eloUpdate on a played cup tie and otherwise
 * persist across weeks untouched. Monthly decay was proposed and
 * decided against the same night; do not add it.
 *
 * APPEARANCES are counted per CUP, not per tie: a meme that plays
 * four ties in one cup has one appearance. The cup service calls
 * markAppearance once per meme per cup; this file just records it.
 *
 * PERSISTENCE (Supabase, service role): arena_ratings holds one row
 * per meme (points, wins, losses, appearances, first_appearance_at);
 * arena_rating_history appends every applied result for audit.
 * Rankings read: top 140 by points desc, tie-broken by more wins,
 * then earlier first appearance. Only memes with at least one cup
 * appearance are ranked.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger.js";
import { K_BY_ROUND, type ArenaRoundId } from "./arenaCupService.js";

export { K_BY_ROUND };
export type { ArenaRoundId };

/** Rating of a meme on its first cup appearance. */
export const START_RATING = 1000;

/** Max memes served on the rankings board. */
export const RANKINGS_LIMIT = 140;

/** Elo expectation that a player rated `ra` beats a player rated `rb`. */
export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** (-(ra - rb) / 400));
}

/**
 * Zero-sum Elo update for one played tie. Returns the signed deltas:
 * winnerDelta is positive, loserDelta is its exact negation.
 */
export function eloUpdate(
  winnerPoints: number,
  loserPoints: number,
  k: number
): { winnerDelta: number; loserDelta: number } {
  const expectedWinner = expectedScore(winnerPoints, loserPoints);
  const winnerDelta = k * (1 - expectedWinner);
  return { winnerDelta, loserDelta: -winnerDelta };
}

/** K factor for a cup round. */
export function roundK(roundId: ArenaRoundId): number {
  return K_BY_ROUND[roundId];
}

export interface ArenaRatingRow {
  address: string;
  symbol: string;
  points: number;
  wins: number;
  losses: number;
  appearances: number;
  firstAppearanceAt: string | null;
}

export interface ArenaRankingEntry extends ArenaRatingRow {
  rank: number;
}

/**
 * Order rating rows into the rankings board: points desc, then more
 * wins, then earlier first appearance. Pure: exported for tests.
 * Rows with zero appearances are excluded (a meme is ranked only
 * once it has played in a cup).
 */
export function rankRatings(rows: ArenaRatingRow[], limit: number = RANKINGS_LIMIT): ArenaRankingEntry[] {
  return rows
    .filter((r) => r.appearances >= 1)
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      const at = a.firstAppearanceAt ? Date.parse(a.firstAppearanceAt) : Number.POSITIVE_INFINITY;
      const bt = b.firstAppearanceAt ? Date.parse(b.firstAppearanceAt) : Number.POSITIVE_INFINITY;
      return at - bt;
    })
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// ---------------------------------------------------------- persistence

export class ArenaRatings {
  private readonly db: SupabaseClient | null;

  constructor(db: SupabaseClient | null) {
    this.db = db;
  }

  /** Load a meme's rating row, creating it at START_RATING on its
   *  first cup appearance. Returns null without a DB. */
  async loadOrCreate(address: string, symbol: string): Promise<ArenaRatingRow | null> {
    if (!this.db) return null;
    const key = address.toLowerCase();
    const { data, error } = await this.db
      .from("arena_ratings")
      .select("address,symbol,points,wins,losses,appearances,first_appearance_at")
      .eq("address", key)
      .maybeSingle();
    if (error) throw error;
    if (data) return rowFromDb(data);
    const row: ArenaRatingRow = {
      address: key,
      symbol,
      points: START_RATING,
      wins: 0,
      losses: 0,
      appearances: 0,
      firstAppearanceAt: null,
    };
    const { error: insertError } = await this.db.from("arena_ratings").insert({
      address: row.address,
      symbol: row.symbol,
      points: row.points,
      wins: 0,
      losses: 0,
      appearances: 0,
      first_appearance_at: null,
    });
    if (insertError) throw insertError;
    return row;
  }

  /** Record one cup appearance for a meme (called once per meme per
   *  cup by the cup service at seeding). Sets first_appearance_at on
   *  the first ever appearance. */
  async markAppearance(address: string, symbol: string, cupId: string): Promise<void> {
    if (!this.db) return;
    const row = await this.loadOrCreate(address, symbol);
    if (!row) return;
    const { data: existing, error: seenError } = await this.db
      .from("arena_rating_history")
      .select("id")
      .eq("cup_id", cupId)
      .eq("kind", "appearance")
      .eq("meme_address", row.address)
      .limit(1);
    if (seenError) throw seenError;
    if (existing && existing.length > 0) return; // already counted for this cup
    const nowIso = new Date().toISOString();
    const { error: updateError } = await this.db
      .from("arena_ratings")
      .update({
        appearances: row.appearances + 1,
        first_appearance_at: row.firstAppearanceAt ?? nowIso,
        symbol,
      })
      .eq("address", row.address);
    if (updateError) throw updateError;
    const { error: historyError } = await this.db.from("arena_rating_history").insert({
      cup_id: cupId,
      clash_id: null,
      round: null,
      kind: "appearance",
      meme_address: row.address,
      opponent_address: null,
      delta: 0,
      points_after: row.points,
    });
    if (historyError) throw historyError;
  }

  /**
   * Apply one PLAYED tie result: load both rows, compute the zero-sum
   * update at the round's K, persist both rows, and append both
   * history entries. Byes and double-void advancements never reach
   * this method (the cup service simply does not call it for them).
   */
  async applyTieResult(args: {
    winner: { address: string; symbol: string };
    loser: { address: string; symbol: string };
    round: ArenaRoundId;
    cupId: string;
    clashId: number;
  }): Promise<{ winnerDelta: number; loserDelta: number } | null> {
    if (!this.db) return null;
    const winner = await this.loadOrCreate(args.winner.address, args.winner.symbol);
    const loser = await this.loadOrCreate(args.loser.address, args.loser.symbol);
    if (!winner || !loser) return null;
    const { winnerDelta, loserDelta } = eloUpdate(winner.points, loser.points, roundK(args.round));
    const winnerPoints = Math.round((winner.points + winnerDelta) * 100) / 100;
    const loserPoints = Math.round((loser.points + loserDelta) * 100) / 100;
    const { error: winnerError } = await this.db
      .from("arena_ratings")
      .update({ points: winnerPoints, wins: winner.wins + 1, symbol: args.winner.symbol })
      .eq("address", winner.address);
    if (winnerError) throw winnerError;
    const { error: loserError } = await this.db
      .from("arena_ratings")
      .update({ points: loserPoints, losses: loser.losses + 1, symbol: args.loser.symbol })
      .eq("address", loser.address);
    if (loserError) throw loserError;
    const { error: historyError } = await this.db.from("arena_rating_history").insert([
      {
        cup_id: args.cupId,
        clash_id: args.clashId,
        round: args.round,
        kind: "result",
        meme_address: winner.address,
        opponent_address: loser.address,
        delta: winnerDelta,
        points_after: winnerPoints,
      },
      {
        cup_id: args.cupId,
        clash_id: args.clashId,
        round: args.round,
        kind: "result",
        meme_address: loser.address,
        opponent_address: winner.address,
        delta: loserDelta,
        points_after: loserPoints,
      },
    ]);
    if (historyError) throw historyError;
    logger.info("[ArenaRatings] tie result applied", {
      cupId: args.cupId,
      clashId: args.clashId,
      round: args.round,
      winner: args.winner.symbol,
      loser: args.loser.symbol,
      winnerDelta: Math.round(winnerDelta * 100) / 100,
    });
    return { winnerDelta, loserDelta };
  }

  /** The rankings board: top 140, ranked by rankRatings. */
  async getRankings(): Promise<{ rankings: ArenaRankingEntry[]; updatedAt: string }> {
    if (!this.db) return { rankings: [], updatedAt: new Date().toISOString() };
    const { data, error } = await this.db
      .from("arena_ratings")
      .select("address,symbol,points,wins,losses,appearances,first_appearance_at")
      .gte("appearances", 1)
      .order("points", { ascending: false })
      .limit(500);
    if (error) throw error;
    return {
      rankings: rankRatings((data ?? []).map(rowFromDb)),
      updatedAt: new Date().toISOString(),
    };
  }
}

function rowFromDb(data: {
  address: string;
  symbol: string;
  points: number;
  wins: number;
  losses: number;
  appearances: number;
  first_appearance_at: string | null;
}): ArenaRatingRow {
  return {
    address: data.address,
    symbol: data.symbol,
    points: Number(data.points),
    wins: data.wins,
    losses: data.losses,
    appearances: data.appearances,
    firstAppearanceAt: data.first_appearance_at,
  };
}
