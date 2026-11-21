/**
 * Weekly Meme Cup engine.
 *
 * Intended destination: packages/backend/src/services/arenaCupService.ts.
 *
 * THE CUP (locked design, 2026-11-20): every week, the top memes by
 * trailing 7-day volume fight a single-elimination bracket of 24-hour
 * outperform clashes. The seeder runs at the Monday 00:00 UTC boundary.
 * Qualification is age (launched at least 48h before seeding) plus the
 * liquidity floor at seeding plus a trailing 7-day volume built from
 * the registry's daily snapshots. The bracket SHRINKS rather than
 * pads: fewer than 8 qualifiers means no cup that week. Rankings
 * (arenaRatings) never affect qualification or seeding.
 *
 * THE MATHS ARE PURE AND EXPORTED (unit-tested without chain or DB):
 *   - qualifyMemes(entries, snapshotsByAddress, nowMs, floorUsd)
 *   - selectField(qualifiers)
 *   - seedOrder(bracketSize)
 *   - roundIdsFor(bracketSize), K_BY_ROUND, roundK lives in
 *     arenaRatings.ts.
 *
 * THE SERVICE: a timer checked on keeper passes (tick() is called by
 * the Arena keeper each pass, and by its own fallback interval)
 * detects the Monday boundary against the last seeded week persisted
 * in arena_cups, seeds the cup, persists ties in arena_cup_ties, and
 * creates round 1 clashes through the injected clash creator (the
 * keeper's factory writer, cupTie true, 24h, creatorName
 * "TICKR Arena"). Bye ties are recorded as instantly won by the
 * seeded meme: no clash, no rating. The keeper reports every clash
 * resolution back through onClashResolved(); when a round completes,
 * the next round's ties are created; after the final, the cup is
 * marked completed with champion and runner-up.
 *
 * CUP REPLAYS (keeper duty (c), driven from here): a cup tie whose
 * clash ends Voided is recreated ONCE with the same pairing. A second
 * void advances the higher seed (lower seed number) with NO rating
 * change. onClashVoided() owns that state machine; the keeper calls
 * it and performs the recreation through the same creator hook.
 */

import { createWalletClient, type WalletClient, type Chain } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  arenaConfig,
  arenaConfigured,
  arenaChain,
  arenaSignerPrivateKey,
  createArenaPublicClient,
} from "../arenaConfig.js";
import { logger } from "../lib/logger.js";
import { createStockFallbackTransport } from "./stockSnapshotSubmitter.js";
import { MEME_CLASH_FACTORY_ABI } from "./arenaClashReader.js";
import type { ArenaRegistryEntry } from "./arenaRegistryService.js";
import type { ArenaRatings } from "./arenaRatings.js";

// ---------------------------------------------------------- pure maths

export type ArenaRoundId = "R32" | "R16" | "QF" | "SF" | "F";

/** Elo K factor per round (later rounds move ratings more). */
export const K_BY_ROUND: Record<ArenaRoundId, number> = {
  R32: 20,
  R16: 25,
  QF: 30,
  SF: 40,
  F: 60,
};

/** Rounds in play order for each bracket size. */
export function roundIdsFor(bracketSize: number): ArenaRoundId[] {
  switch (bracketSize) {
    case 32:
      return ["R32", "R16", "QF", "SF", "F"];
    case 16:
      return ["R16", "QF", "SF", "F"];
    case 8:
      return ["QF", "SF", "F"];
    default:
      throw new Error(`[arenaCup] unsupported bracket size: ${bracketSize}`);
  }
}

/** One meme's daily volume snapshots (arena_volume_snapshots rows). */
export interface ArenaVolumeSnapshotDay {
  day: string;
  volume24hUsd: number;
  liquidityUsd: number;
}

export interface QualifiedMeme {
  entry: ArenaRegistryEntry;
  /** Sum of the daily volume24hUsd snapshots in the 7 days before seeding. */
  trailingVolumeUsd: number;
  /** Snapshot days available inside the window (at least 1 required). */
  snapshotDays: number;
}

/** Minimum age at seeding: launched at least 48h before. */
export const CUP_MIN_AGE_MS = 48 * 60 * 60_000;
/** Trailing volume window: the 7 UTC days before the seeding day. */
export const CUP_TRAILING_DAYS = 7;

/**
 * Qualification, pure. Keeps memes that:
 *   - were created at least 48h before nowMs;
 *   - sit at or above the liquidity floor AT seeding (the live entry);
 *   - have at least 1 daily snapshot day inside the trailing 7-day
 *     window (the 7 UTC days before the seeding day), whose
 *     volume24hUsd values sum to the trailing volume.
 * Ranked by trailing volume desc, tie-broken by higher liquidity,
 * then earlier createdAt. The rank order IS the seed order.
 */
export function qualifyMemes(
  entries: ArenaRegistryEntry[],
  snapshotsByAddress: ReadonlyMap<string, ArenaVolumeSnapshotDay[]>,
  nowMs: number,
  floorUsd: number
): QualifiedMeme[] {
  const seedingDayStartMs = Date.UTC(
    new Date(nowMs).getUTCFullYear(),
    new Date(nowMs).getUTCMonth(),
    new Date(nowMs).getUTCDate()
  );
  const windowStartMs = seedingDayStartMs - CUP_TRAILING_DAYS * 24 * 60 * 60_000;
  const out: QualifiedMeme[] = [];
  for (const entry of entries) {
    if (nowMs - entry.createdAt < CUP_MIN_AGE_MS) continue;
    if (entry.liquidityUsd < floorUsd) continue;
    const days = (snapshotsByAddress.get(entry.address.toLowerCase()) ?? []).filter((d) => {
      const dayMs = Date.parse(`${d.day}T00:00:00.000Z`);
      return Number.isFinite(dayMs) && dayMs >= windowStartMs && dayMs < seedingDayStartMs;
    });
    if (days.length < 1) continue;
    out.push({
      entry,
      trailingVolumeUsd: days.reduce((sum, d) => sum + d.volume24hUsd, 0),
      snapshotDays: days.length,
    });
  }
  out.sort((a, b) => {
    if (b.trailingVolumeUsd !== a.trailingVolumeUsd) return b.trailingVolumeUsd - a.trailingVolumeUsd;
    if (b.entry.liquidityUsd !== a.entry.liquidityUsd) return b.entry.liquidityUsd - a.entry.liquidityUsd;
    return a.entry.createdAt - b.entry.createdAt;
  });
  return out;
}

export interface CupField {
  /** Memes in the cup, in seed order (index 0 is seed 1). */
  seeds: QualifiedMeme[];
  bracketSize: number;
  /** Byes awarded: always 0. The field is cut to a power of two,
   *  never rounded up, so no tie is ever a bye. */
  byes: number;
  rounds: ArenaRoundId[];
}

/**
 * Field selection, pure. The field is CUT to the largest power of
 * two at or below min(32, qualifier count): 32, 16 or 8. Qualifiers
 * ranked below the cut miss the cup that week; there are no byes
 * and the bracket never rounds up. Fewer than 8 qualifiers returns
 * null (no cup that week, the bracket shrinks rather than pads).
 */
export function selectField(qualifiers: QualifiedMeme[]): CupField | null {
  const capped = Math.min(32, qualifiers.length);
  if (capped < 8) return null;
  let field = 8;
  while (field * 2 <= capped) field *= 2;
  return {
    seeds: qualifiers.slice(0, field),
    bracketSize: field,
    byes: 0,
    rounds: roundIdsFor(field),
  };
}

/**
 * Standard recursive seeding arrangement, pure. Returns the seed
 * numbers in bracket slot order, so consecutive pairs are the round 1
 * pairings: seedOrder(8) = [1, 8, 4, 5, 2, 7, 3, 6], giving pairings
 * 1v8, 4v5, 2v7, 3v6. Built by the usual fold: each round of the
 * recursion pairs every seed s with (size + 1 - s).
 */
export function seedOrder(bracketSize: number): number[] {
  if (bracketSize < 2 || (bracketSize & (bracketSize - 1)) !== 0) {
    throw new Error(`[arenaCup] bracket size must be a power of two, got: ${bracketSize}`);
  }
  let order = [1, 2];
  while (order.length < bracketSize) {
    const size = order.length * 2;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed, size + 1 - seed);
    }
    order = next;
  }
  return order;
}

/** The Monday 00:00 UTC week key (YYYY-MM-DD of the week's Monday). */
export function weekKeyMonday(nowMs: number): string {
  const d = new Date(nowMs);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(dayStart).getUTCDay(); // 0 Sunday .. 6 Saturday
  const monday = dayStart - ((dow + 6) % 7) * 24 * 60 * 60_000;
  return new Date(monday).toISOString().slice(0, 10);
}

// ---------------------------------------------------------- the service

export interface ArenaCupTieRecord {
  id: string;
  cupId: string;
  round: ArenaRoundId;
  tieIndex: number;
  seedA: number | null;
  seedB: number | null;
  memeA: string | null;
  memeB: string | null;
  symbolA: string | null;
  symbolB: string | null;
  clashId: number | null;
  status: "pending" | "live" | "won" | "bye" | "void_replay" | "advanced_double_void";
  winner: string | null;
  replays: number;
}

export interface ArenaCupRecord {
  id: string;
  weekKey: string;
  status: "live" | "completed" | "skipped";
  bracketSize: number | null;
  fieldSize: number | null;
  champion: string | null;
  championSymbol: string | null;
  runnerUp: string | null;
  runnerUpSymbol: string | null;
  seededAt: string | null;
  completedAt: string | null;
}

/** Creates one cup clash on-chain. Injected so the service is
 *  testable and so the keeper's TxQueue discipline is shared: the
 *  production implementation is createCupClash below. */
export type CupClashCreator = (args: {
  memeToken: `0x${string}`;
  memeSymbol: string;
  opponentToken: `0x${string}`;
  opponentSymbol: string;
}) => Promise<number>;

export interface ArenaCupDeps {
  db: SupabaseClient | null;
  ratings: ArenaRatings | null;
  /** Reads the registry snapshot for seeding (wired to the registry
   *  service's getMemes in index.ts). */
  getMemes: () => ArenaRegistryEntry[];
  /** Overrides the on-chain creator (tests). */
  clashCreator?: CupClashCreator;
  /** Notified after any tie state change (reader cache busting). */
  onTieChanged?: (tie: ArenaCupTieRecord) => void;
}

export class ArenaCupService {
  private readonly db: SupabaseClient | null;
  private readonly ratings: ArenaRatings | null;
  private readonly getMemes: () => ArenaRegistryEntry[];
  private readonly clashCreator: CupClashCreator;
  private readonly onTieChanged: ((tie: ArenaCupTieRecord) => void) | undefined;
  /** clashId to tie, for resolution routing. Rebuilt from the DB on
   *  demand; the DB is the source of truth, this is only a shortcut. */
  private readonly tieByClash = new Map<number, string>();

  constructor(deps: ArenaCupDeps) {
    this.db = deps.db;
    this.ratings = deps.ratings;
    this.getMemes = deps.getMemes;
    this.onTieChanged = deps.onTieChanged;
    this.clashCreator = deps.clashCreator ?? ((args) => createCupClash(args));
  }

  /**
   * Boundary check, called on keeper passes (and safe to call any
   * time): if the current week's Monday has passed and no cup exists
   * for this week key, seed it. Idempotent: the arena_cups row for
   * the week key is the lock.
   */
  async tick(nowMs: number = Date.now()): Promise<void> {
    if (!this.db || !arenaConfigured()) return;
    const weekKey = weekKeyMonday(nowMs);
    const { data, error } = await this.db
      .from("arena_cups")
      .select("id")
      .eq("week_key", weekKey)
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) return;
    await this.seedCup(weekKey, nowMs);
  }

  /** Seed one week's cup. Returns the cup record, or a skipped record
   *  when the field is too small (the skip is persisted so the week
   *  is not retried every pass). */
  async seedCup(weekKey: string, nowMs: number = Date.now()): Promise<ArenaCupRecord | null> {
    if (!this.db) return null;
    const snapshots = await this.loadSnapshots();
    const qualifiers = qualifyMemes(this.getMemes(), snapshots, nowMs, arenaConfig.creation.minLiquidityUsd);
    const field = selectField(qualifiers);
    const { data: cupRow, error: cupError } = await this.db
      .from("arena_cups")
      .insert({
        week_key: weekKey,
        status: field ? "live" : "skipped",
        bracket_size: field?.bracketSize ?? null,
        field_size: field?.seeds.length ?? qualifiers.length,
        seeded_at: new Date(nowMs).toISOString(),
      })
      .select("id,week_key,status,bracket_size,field_size,champion,champion_symbol,runner_up,runner_up_symbol,seeded_at,completed_at")
      .single();
    if (cupError) throw cupError;
    const cup = cupFromDb(cupRow);
    if (!field) {
      logger.info("[ArenaCup] week skipped, field too small", {
        weekKey,
        qualifiers: qualifiers.length,
      });
      return cup;
    }
    logger.info("[ArenaCup] seeding cup", {
      weekKey,
      field: field.seeds.length,
      bracketSize: field.bracketSize,
      byes: field.byes,
    });
    // Appearances: once per meme per cup (ratings count cups played).
    if (this.ratings) {
      for (const seed of field.seeds) {
        await this.ratings.markAppearance(seed.entry.address, seed.entry.symbol, cup.id);
      }
    }
    await this.createRound(cup, field.rounds[0], firstRoundPairings(field), nowMs);
    return cup;
  }

  /**
   * A cup clash resolved (the keeper has the winner from the factory:
   * outcome 0 means the tie's meme A, the clash creator, won; outcome
   * 1 means meme B won). Records the winner, applies the rating, and
   * advances the bracket when the round completes.
   */
  async onClashResolved(clashId: number, winnerOutcome: 0 | 1): Promise<void> {
    if (!this.db) return;
    const tie = await this.findTieByClash(clashId);
    if (!tie || tie.status === "won" || tie.status === "bye") return;
    const winnerAddress = winnerOutcome === 0 ? tie.memeA : tie.memeB;
    const loserAddress = winnerOutcome === 0 ? tie.memeB : tie.memeA;
    if (!winnerAddress || !loserAddress) return;
    await this.updateTie(tie.id, { status: "won", winner: winnerAddress });
    if (this.ratings) {
      const winnerSymbol = winnerOutcome === 0 ? tie.symbolA : tie.symbolB;
      const loserSymbol = winnerOutcome === 0 ? tie.symbolB : tie.symbolA;
      await this.ratings.applyTieResult({
        winner: { address: winnerAddress, symbol: winnerSymbol ?? "" },
        loser: { address: loserAddress, symbol: loserSymbol ?? "" },
        round: tie.round,
        cupId: tie.cupId,
        clashId,
      });
    }
    logger.info("[ArenaCup] tie resolved", { cupId: tie.cupId, round: tie.round, tieIndex: tie.tieIndex, winner: winnerAddress });
    await this.maybeAdvanceRound(tie.cupId, tie.round);
  }

  /**
   * A cup clash ended Voided (breaker or missing price). First void:
   * recreate the same pairing once. Second void: the higher seed
   * (lower seed number) advances with NO rating change.
   */
  async onClashVoided(clashId: number): Promise<void> {
    if (!this.db) return;
    const tie = await this.findTieByClash(clashId);
    if (!tie || tie.status === "won" || tie.status === "bye") return;
    if (tie.replays < 1 && tie.memeA && tie.memeB) {
      const newClashId = await this.clashCreator({
        memeToken: tie.memeA as `0x${string}`,
        memeSymbol: tie.symbolA ?? "",
        opponentToken: tie.memeB as `0x${string}`,
        opponentSymbol: tie.symbolB ?? "",
      });
      await this.updateTie(tie.id, { status: "void_replay", clashId: newClashId, replays: tie.replays + 1 });
      this.tieByClash.set(newClashId, tie.id);
      logger.warn("[ArenaCup] cup tie voided, replay clash created", {
        cupId: tie.cupId,
        round: tie.round,
        tieIndex: tie.tieIndex,
        oldClashId: clashId,
        newClashId,
      });
      return;
    }
    // Second void: higher seed advances, no rating change.
    const winner =
      tie.seedA !== null && tie.seedB !== null
        ? tie.seedA < tie.seedB
          ? tie.memeA
          : tie.memeB
        : tie.memeA;
    await this.updateTie(tie.id, { status: "advanced_double_void", winner });
    logger.warn("[ArenaCup] cup tie voided twice, higher seed advances without rating change", {
      cupId: tie.cupId,
      round: tie.round,
      tieIndex: tie.tieIndex,
      winner,
    });
    await this.maybeAdvanceRound(tie.cupId, tie.round);
  }

  /** Cup lookup for the reader: the tie a clash belongs to, if any. */
  async getTieForClash(clashId: number): Promise<ArenaCupTieRecord | null> {
    if (!this.db) return null;
    return this.findTieByClash(clashId);
  }

  /** Featured flags live in arena_featured_clashes, managed out of
   *  band by TICKR; this read serves the reader and commentary. */
  async getFeaturedClashIds(): Promise<Set<number>> {
    if (!this.db) return new Set();
    const { data, error } = await this.db.from("arena_featured_clashes").select("clash_id");
    if (error) throw error;
    return new Set((data ?? []).map((r) => Number(r.clash_id)));
  }

  /** Cup history, newest first (routes: GET /api/arena/cups). */
  async getCups(): Promise<ArenaCupRecord[]> {
    if (!this.db) return [];
    const { data, error } = await this.db
      .from("arena_cups")
      .select("id,week_key,status,bracket_size,field_size,champion,champion_symbol,runner_up,runner_up_symbol,seeded_at,completed_at")
      .order("week_key", { ascending: false })
      .limit(52);
    if (error) throw error;
    return (data ?? []).map(cupFromDb);
  }

  /** The live cup with its full bracket (routes: /cups/current). */
  async getCurrentCup(): Promise<{ cup: ArenaCupRecord; ties: ArenaCupTieRecord[] } | null> {
    if (!this.db) return null;
    const { data, error } = await this.db
      .from("arena_cups")
      .select("id,week_key,status,bracket_size,field_size,champion,champion_symbol,runner_up,runner_up_symbol,seeded_at,completed_at")
      .eq("status", "live")
      .order("week_key", { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return null;
    const cup = cupFromDb(data[0]);
    const ties = await this.loadTies(cup.id);
    return { cup, ties };
  }

  // ---------------------------------------------------------- internals

  private async loadSnapshots(): Promise<Map<string, ArenaVolumeSnapshotDay[]>> {
    const out = new Map<string, ArenaVolumeSnapshotDay[]>();
    if (!this.db) return out;
    const since = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const { data, error } = await this.db
      .from("arena_volume_snapshots")
      .select("address,day,volume24h_usd,liquidity_usd")
      .gte("day", since)
      .limit(20_000);
    if (error) throw error;
    for (const row of data ?? []) {
      const key = String(row.address).toLowerCase();
      const list = out.get(key) ?? [];
      list.push({
        day: String(row.day),
        volume24hUsd: Number(row.volume24h_usd),
        liquidityUsd: Number(row.liquidity_usd),
      });
      out.set(key, list);
    }
    return out;
  }

  private async createRound(
    cup: ArenaCupRecord,
    round: ArenaRoundId,
    pairings: Array<{ seedA: number; seedB: number | null; memeA: QualifiedMeme; memeB: QualifiedMeme | null }>,
    nowMs: number
  ): Promise<void> {
    if (!this.db) return;
    for (let tieIndex = 0; tieIndex < pairings.length; tieIndex++) {
      const p = pairings[tieIndex];
      if (p.memeB === null) {
        // Bye: instantly won by the seeded meme. No clash, no rating.
        const { data, error } = await this.db
          .from("arena_cup_ties")
          .insert({
            cup_id: cup.id,
            round,
            tie_index: tieIndex,
            seed_a: p.seedA,
            seed_b: null,
            meme_a: p.memeA.entry.address.toLowerCase(),
            meme_b: null,
            symbol_a: p.memeA.entry.symbol,
            symbol_b: null,
            clash_id: null,
            status: "bye",
            winner: p.memeA.entry.address.toLowerCase(),
            replays: 0,
          })
          .select("id")
          .single();
        if (error) throw error;
        logger.info("[ArenaCup] bye awarded", { cupId: cup.id, round, seed: p.seedA, symbol: p.memeA.entry.symbol, tieId: data.id });
        continue;
      }
      const clashId = await this.clashCreator({
        memeToken: p.memeA.entry.address as `0x${string}`,
        memeSymbol: p.memeA.entry.symbol,
        opponentToken: p.memeB.entry.address as `0x${string}`,
        opponentSymbol: p.memeB.entry.symbol,
      });
      const { data, error } = await this.db
        .from("arena_cup_ties")
        .insert({
          cup_id: cup.id,
          round,
          tie_index: tieIndex,
          seed_a: p.seedA,
          seed_b: p.seedB,
          meme_a: p.memeA.entry.address.toLowerCase(),
          meme_b: p.memeB.entry.address.toLowerCase(),
          symbol_a: p.memeA.entry.symbol,
          symbol_b: p.memeB.entry.symbol,
          clash_id: clashId,
          status: "live",
          winner: null,
          replays: 0,
        })
        .select("id")
        .single();
      if (error) throw error;
      this.tieByClash.set(clashId, data.id as string);
      logger.info("[ArenaCup] tie clash created", {
        cupId: cup.id,
        round,
        tieIndex,
        clashId,
        pairing: `${p.memeA.entry.symbol} vs ${p.memeB.entry.symbol}`,
        at: new Date(nowMs).toISOString(),
      });
    }
  }

  private async maybeAdvanceRound(cupId: string, round: ArenaRoundId): Promise<void> {
    if (!this.db) return;
    const ties = await this.loadTies(cupId);
    const roundTies = ties.filter((t) => t.round === round);
    const finished = roundTies.every((t) => t.winner !== null);
    if (!finished || roundTies.length === 0) return;
    const { data: cupRow, error } = await this.db
      .from("arena_cups")
      .select("id,week_key,status,bracket_size,field_size,champion,champion_symbol,runner_up,runner_up_symbol,seeded_at,completed_at")
      .eq("id", cupId)
      .single();
    if (error) throw error;
    const cup = cupFromDb(cupRow);
    if (cup.status !== "live" || !cup.bracketSize) return;
    const rounds = roundIdsFor(cup.bracketSize);
    const roundIdx = rounds.indexOf(round);
    const winners = roundTies
      .sort((a, b) => a.tieIndex - b.tieIndex)
      .map((t) => ({
        address: t.winner as string,
        symbol: (t.winner === t.memeA ? t.symbolA : t.symbolB) ?? "",
        seed: (t.winner === t.memeA ? t.seedA : t.seedB) ?? 0,
      }));
    if (round === "F") {
      const champion = winners[0];
      const finalTie = roundTies[0];
      const runnerUpAddress = finalTie.winner === finalTie.memeA ? finalTie.memeB : finalTie.memeA;
      const runnerUpSymbol = finalTie.winner === finalTie.memeA ? finalTie.symbolB : finalTie.symbolA;
      const { error: doneError } = await this.db
        .from("arena_cups")
        .update({
          status: "completed",
          champion: champion.address,
          champion_symbol: champion.symbol,
          runner_up: runnerUpAddress,
          runner_up_symbol: runnerUpSymbol,
          completed_at: new Date().toISOString(),
        })
        .eq("id", cupId);
      if (doneError) throw doneError;
      logger.info("[ArenaCup] cup completed", { cupId, champion: champion.symbol, runnerUp: runnerUpSymbol });
      return;
    }
    const nextRound = rounds[roundIdx + 1];
    if (ties.some((t) => t.round === nextRound)) return; // already created
    const pairings: Array<{ seedA: number; seedB: number | null; memeA: QualifiedMeme; memeB: QualifiedMeme | null }> = [];
    for (let i = 0; i < winners.length; i += 2) {
      const a = winners[i];
      const b = winners[i + 1];
      pairings.push({
        seedA: a.seed,
        seedB: b ? b.seed : null,
        memeA: qualifiedStub(a.address, a.symbol, a.seed),
        memeB: b ? qualifiedStub(b.address, b.symbol, b.seed) : null,
      });
    }
    await this.createRound(cup, nextRound, pairings, Date.now());
  }

  private async loadTies(cupId: string): Promise<ArenaCupTieRecord[]> {
    if (!this.db) return [];
    const { data, error } = await this.db
      .from("arena_cup_ties")
      .select("id,cup_id,round,tie_index,seed_a,seed_b,meme_a,meme_b,symbol_a,symbol_b,clash_id,status,winner,replays")
      .eq("cup_id", cupId)
      .order("tie_index", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(tieFromDb);
  }

  private async findTieByClash(clashId: number): Promise<ArenaCupTieRecord | null> {
    if (!this.db) return null;
    const { data, error } = await this.db
      .from("arena_cup_ties")
      .select("id,cup_id,round,tie_index,seed_a,seed_b,meme_a,meme_b,symbol_a,symbol_b,clash_id,status,winner,replays")
      .eq("clash_id", clashId)
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return null;
    const tie = tieFromDb(data[0]);
    this.tieByClash.set(clashId, tie.id);
    return tie;
  }

  private async updateTie(
    tieId: string,
    patch: Partial<{ status: ArenaCupTieRecord["status"]; winner: string | null; clashId: number; replays: number }>
  ): Promise<void> {
    if (!this.db) return;
    const dbPatch: Record<string, unknown> = {};
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.winner !== undefined) dbPatch.winner = patch.winner;
    if (patch.clashId !== undefined) dbPatch.clash_id = patch.clashId;
    if (patch.replays !== undefined) dbPatch.replays = patch.replays;
    const { error } = await this.db.from("arena_cup_ties").update(dbPatch).eq("id", tieId);
    if (error) throw error;
    if (this.onTieChanged) {
      const { data } = await this.db
        .from("arena_cup_ties")
        .select("id,cup_id,round,tie_index,seed_a,seed_b,meme_a,meme_b,symbol_a,symbol_b,clash_id,status,winner,replays")
        .eq("id", tieId)
        .single();
      if (data) this.onTieChanged(tieFromDb(data));
    }
  }
}

/** Round 1 pairings from a selected field: consecutive pairs of the
 *  seedOrder arrangement. The field is always an exact power of two,
 *  so every slot is filled and every pairing has two memes. */
function firstRoundPairings(field: CupField): Array<{ seedA: number; seedB: number | null; memeA: QualifiedMeme; memeB: QualifiedMeme | null }> {
  const order = seedOrder(field.bracketSize);
  const bySeed = new Map(field.seeds.map((q, i) => [i + 1, q]));
  const pairings: Array<{ seedA: number; seedB: number | null; memeA: QualifiedMeme; memeB: QualifiedMeme | null }> = [];
  for (let i = 0; i < order.length; i += 2) {
    const seedA = order[i];
    const seedB = order[i + 1];
    const memeA = bySeed.get(seedA);
    if (!memeA) continue; // cannot happen: the lower slot of a pair always exists when the field is real
    const memeB = bySeed.get(seedB) ?? null;
    pairings.push({ seedA, seedB: memeB ? seedB : null, memeA, memeB });
  }
  return pairings;
}

/** Minimal QualifiedMeme for later rounds (only address and symbol
 *  are used by createRound). */
function qualifiedStub(address: string, symbol: string, seed: number): QualifiedMeme {
  return {
    entry: {
      address,
      symbol,
      name: symbol,
      logoUrl: "",
      imageUrl: null,
      pairToken: "",
      pairSymbol: null,
      pairType: "other",
      pairedStock: null,
      pool: null,
      liquidityUsd: 0,
      volume24hUsd: 0,
      holders: 0,
      priceUsd: null,
      createdAt: 0,
      creationEnabled: false,
      disableReason: null,
    },
    trailingVolumeUsd: 0,
    snapshotDays: 0,
  };
  void seed;
}

// ---------------------------------------------------------- chain writer

let sharedWallet: { walletClient: WalletClient; account: PrivateKeyAccount; chain: Chain } | null = null;

function cupWallet(): { walletClient: WalletClient; account: PrivateKeyAccount; chain: Chain } {
  if (sharedWallet) return sharedWallet;
  const signerKey = arenaSignerPrivateKey();
  if (!signerKey) {
    throw new Error("[ArenaCup] Missing BACKEND_SIGNER_PRIVATE_KEY (see .env.example)");
  }
  const chain = arenaChain();
  const account = privateKeyToAccount(signerKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: createStockFallbackTransport(),
  }) as WalletClient;
  sharedWallet = { walletClient, account, chain };
  return sharedWallet;
}

/**
 * The production cup clash creator: createClash on the factory with
 * opponentKind Meme (1), a 24h window, cupTie true, creatorName
 * "TICKR Arena". The clash id is read back from clashCount before and
 * after (ids are sequential from 0). Writes are serialized by the
 * keeper's pass discipline: the cup service is driven from keeper
 * passes, never concurrently with keeper resolutions.
 */
export async function createCupClash(args: {
  memeToken: `0x${string}`;
  memeSymbol: string;
  opponentToken: `0x${string}`;
  opponentSymbol: string;
}): Promise<number> {
  const { walletClient, account, chain } = cupWallet();
  const factory = arenaConfig.factoryAddress;
  const publicClient = createArenaPublicClient();
  const before = (await publicClient.readContract({
    address: factory,
    abi: MEME_CLASH_FACTORY_ABI,
    functionName: "clashCount",
  })) as bigint;
  await walletClient.writeContract({
    address: factory,
    abi: MEME_CLASH_FACTORY_ABI,
    functionName: "createClash",
    args: [
      args.memeToken,
      args.memeSymbol,
      1,
      args.opponentToken,
      args.opponentSymbol,
      BigInt(arenaConfig.windows.standardSeconds),
      true,
      "TICKR Arena",
    ],
    chain,
    account,
  });
  return Number(before);
}

// ---------------------------------------------------------- db mapping

function cupFromDb(row: {
  id: string;
  week_key: string;
  status: string;
  bracket_size: number | null;
  field_size: number | null;
  champion: string | null;
  champion_symbol: string | null;
  runner_up: string | null;
  runner_up_symbol: string | null;
  seeded_at: string | null;
  completed_at: string | null;
}): ArenaCupRecord {
  return {
    id: row.id,
    weekKey: row.week_key,
    status: row.status as ArenaCupRecord["status"],
    bracketSize: row.bracket_size,
    fieldSize: row.field_size,
    champion: row.champion,
    championSymbol: row.champion_symbol,
    runnerUp: row.runner_up,
    runnerUpSymbol: row.runner_up_symbol,
    seededAt: row.seeded_at,
    completedAt: row.completed_at,
  };
}

function tieFromDb(row: {
  id: string;
  cup_id: string;
  round: string;
  tie_index: number;
  seed_a: number | null;
  seed_b: number | null;
  meme_a: string | null;
  meme_b: string | null;
  symbol_a: string | null;
  symbol_b: string | null;
  clash_id: number | null;
  status: string;
  winner: string | null;
  replays: number;
}): ArenaCupTieRecord {
  return {
    id: row.id,
    cupId: row.cup_id,
    round: row.round as ArenaRoundId,
    tieIndex: row.tie_index,
    seedA: row.seed_a,
    seedB: row.seed_b,
    memeA: row.meme_a,
    memeB: row.meme_b,
    symbolA: row.symbol_a,
    symbolB: row.symbol_b,
    clashId: row.clash_id,
    status: row.status as ArenaCupTieRecord["status"],
    winner: row.winner,
    replays: row.replays,
  };
}
