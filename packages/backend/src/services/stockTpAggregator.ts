/**
 * Unified TP (TickrPoints) aggregator — ONE leaderboard across crypto and stocks.
 *
 * Intended destination: packages/backend/src/services/stockTpAggregator.ts.
 *
 * THE CONSTRAINT (read this before touching this file):
 *   The crypto PlayerStats.setPredictionPool is ONE-TIME and already set
 *   to the crypto PredictionPool. The stock pool therefore CANNOT write
 *   to the crypto PlayerStats, and there is no separate stock PlayerStats
 *   to read. Any design that calls a PlayerStats setter, or that expects
 *   the stock contracts to record into the crypto PlayerStats, is wrong
 *   and will revert on-chain. This file does NO on-chain writes at all:
 *   it aggregates OFF-CHAIN, from events, into one unified TP leaderboard.
 *   Crypto and stock outcomes count identically; there is no separate
 *   stock leaderboard.
 *
 * TP RULE (aggregator-defined, flag for user confirmation: the brief does
 * not specify a TP formula, so this is the simplest faithful rule):
 *   +3 TP for a won prediction, +1 TP for a correctly predicted draw,
 *   +0 TP for a lost prediction. A forfeit counts as a normal win/loss
 *   for the players who staked on it (the pool settles it 3-0); a void
 *   fixture counts for NOBODY (stakes refunded 1:1, no outcome). Streaks
 *   are computed chronologically from the same outcome stream.
 *
 * SOURCES (both event scans, 900-block chunks, watermarks, dirty-only):
 *   Crypto leg: PlayerStats.OutcomeRecorded(player, seasonId, fixtureId,
 *   won, isDraw). This is the same event the crypto ChainReader scans
 *   for its leaderboard. NOTE: this file does NOT import the crypto
 *   readClient: that module imports the @tickr/shared BARREL, which is
 *   broken (it re-exports ./chains.js, ./teams.js, ./constants.js that
 *   do not resolve). The aggregator builds its own viem client over the
 *   shared fallback transport and scans the event directly.
 *   Stock leg: the stock PredictionPool emits Staked(seasonId, fixtureId,
 *   player, outcome, amount) and Settled(seasonId, fixtureId,
 *   winningOutcome, totalPool) — the same event names as the crypto
 *   PredictionPool (verified in packages/contracts/contracts/
 *   PredictionPool.sol). A player's stock outcome for a fixture is
 *   derived, not stored: won = staked on the winning outcome (any stake
 *   on the winning side counts once per fixture, even if the player also
 *   staked other sides); isDraw = winningOutcome is DRAW. Forfeits
 *   settle through the same Settled event, so they flow through
 *   unchanged. Void fixtures never emit Settled, so they contribute
 *   nothing. Claimed/Forfeited pool events are not needed for TP.
 *
 * CACHING: the leaderboard is rebuilt from the incremental outcome
 * store and cached for 60s. Only players with new events are touched on
 * refresh; everyone else keeps their cached row. A failed scan serves
 * the last good snapshot instead of wiping the board.
 */

import { parseAbiItem, type PublicClient } from "viem";
import { stockConfig } from "../stockConfig.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { createStockPublicClient } from "./stockSnapshotSubmitter.js";

const CRYPTO_OUTCOME_RECORDED_EVENT = parseAbiItem(
  "event OutcomeRecorded(address indexed player, uint256 indexed seasonId, uint256 fixtureId, bool won, bool isDraw)"
);

const STOCK_STAKED_EVENT = parseAbiItem(
  "event Staked(uint256 indexed seasonId, uint256 indexed fixtureId, address indexed player, uint8 outcome, uint256 amount)"
);

const STOCK_SETTLED_EVENT = parseAbiItem(
  "event Settled(uint256 indexed seasonId, uint256 indexed fixtureId, uint8 winningOutcome, uint256 totalPool)"
);

/** Outcome enum, shared by both pools (see packages/shared/src/constants.ts OUTCOME). */
export const STOCK_OUTCOME = { WIN_HOME: 0, DRAW: 1, WIN_AWAY: 2 } as const;

export const TP_WIN = 3;
export const TP_DRAW = 1;
export const TP_LOSS = 0;

export interface TpPlayerView {
  address: string;
  /** Unified TickrPoints: crypto TP + stock TP. */
  tp: number;
  cryptoTp: number;
  stockTp: number;
  wins: number;
  losses: number;
  draws: number;
  cryptoWins: number;
  cryptoLosses: number;
  cryptoDraws: number;
  stockWins: number;
  stockLosses: number;
  stockDraws: number;
  currentStreak: number;
  longestStreak: number;
  /** Fixtures predicted across both leagues. */
  predictions: number;
  winRateBps: number;
}

interface Outcome {
  /** "crypto" | "stock" — which leg produced this outcome. */
  leg: "crypto" | "stock";
  won: boolean;
  isDraw: boolean;
  blockNumber: bigint;
  logIndex: number;
}

const LEADERBOARD_CACHE_MS = 60_000;
/** eth_getLogs block-range cap on Base Sepolia public RPC is 1,000 — stay under it. */
const LOG_SCAN_CHUNK_BLOCKS = 900n;

export class StockTpAggregator {
  private readonly publicClient: PublicClient;
  /** Per-player chronological outcomes (both legs, merged by block order). */
  private readonly outcomesByPlayer = new Map<`0x${string}`, Outcome[]>();
  private leaderboardCache: { at: number; rows: TpPlayerView[] } | null = null;
  private cryptoScannedTo: bigint | null = null;
  private stockScannedTo: bigint | null = null;
  private scanPromise: Promise<void> | null = null;

  constructor(publicClient?: PublicClient) {
    // One client, fallback transport, used for BOTH legs: the crypto
    // PlayerStats and the stock pool live on the same chain env.
    this.publicClient = publicClient ?? createStockPublicClient();
  }

  /** Unified leaderboard, TP desc, then wins desc, then fewest losses. */
  async getUnifiedLeaderboard(limit = 100): Promise<TpPlayerView[]> {
    if (this.leaderboardCache && Date.now() - this.leaderboardCache.at < LEADERBOARD_CACHE_MS) {
      return this.leaderboardCache.rows.slice(0, limit);
    }
    try {
      await this.refreshInBackground();
    } catch (err) {
      logger.warn("[StockTpAggregator] event scan failed", { error: String(err) });
      if (this.leaderboardCache) return this.leaderboardCache.rows.slice(0, limit);
      return [];
    }
    const rows = [...this.outcomesByPlayer.entries()].map(([address, outcomes]) =>
      this.buildRow(address, outcomes)
    );
    rows.sort(
      (a, b) => b.tp - a.tp || b.wins - a.wins || a.losses - b.losses
    );
    this.leaderboardCache = { at: Date.now(), rows };
    return rows.slice(0, limit);
  }

  /** One player's unified TP row, or a zero row when they never played.
   *  A failed scan serves the cached outcomes (possibly empty) instead
   *  of 502ing a profile page. */
  async getUnifiedPlayer(address: `0x${string}`): Promise<TpPlayerView> {
    try {
      await this.refreshInBackground();
    } catch (err) {
      logger.warn("[StockTpAggregator] scan failed, serving cached TP row", {
        error: String(err),
      });
    }
    const outcomes = this.outcomesByPlayer.get(address.toLowerCase() as `0x${string}`) ?? [];
    return this.buildRow(address.toLowerCase(), outcomes);
  }

  /** Rank (1-based) of a player in the unified leaderboard, or null if unranked. */
  async getPlayerRank(address: `0x${string}`): Promise<number | null> {
    const rows = await this.getUnifiedLeaderboard(10_000);
    const idx = rows.findIndex((r) => r.address.toLowerCase() === address.toLowerCase());
    return idx === -1 ? null : idx + 1;
  }

  private async refreshInBackground(): Promise<void> {
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = (async () => {
      await this.scanCryptoOutcomes();
      await this.scanStockOutcomes();
    })()
      .catch((err) => {
        logger.warn("[StockTpAggregator] event scan failed", { error: String(err) });
        throw err;
      })
      .finally(() => {
        this.scanPromise = null;
      });
    return this.scanPromise;
  }

  // ------------------------------------------------------------- crypto leg

  private async scanCryptoOutcomes(): Promise<void> {
    const playerStats = config.contracts.playerStats;
    if (!playerStats) {
      logger.warn("[StockTpAggregator] no crypto PlayerStats address configured — crypto leg empty");
      return;
    }
    const latest = await this.publicClient.getBlockNumber();
    let from =
      this.cryptoScannedTo !== null ? this.cryptoScannedTo + 1n : config.leaderboard.scanStartBlock;
    if (from > latest) return;
    let touched = 0;
    while (from <= latest) {
      const chunkEnd = from + LOG_SCAN_CHUNK_BLOCKS - 1n;
      const to = chunkEnd > latest ? latest : chunkEnd;
      const logs = await this.publicClient.getLogs({
        address: playerStats,
        event: CRYPTO_OUTCOME_RECORDED_EVENT,
        fromBlock: from,
        toBlock: to,
      });
      for (const l of logs) {
        const player = (l.args.player as string).toLowerCase() as `0x${string}`;
        const list = this.outcomesByPlayer.get(player) ?? [];
        list.push({
          leg: "crypto",
          won: l.args.won as boolean,
          isDraw: l.args.isDraw as boolean,
          blockNumber: l.blockNumber,
          logIndex: l.logIndex,
        });
        this.outcomesByPlayer.set(player, list);
        touched++;
      }
      from = to + 1n;
    }
    this.cryptoScannedTo = latest;
    if (touched > 0) this.leaderboardCache = null;
    logger.debug("[StockTpAggregator] crypto scan complete", { touched, scannedTo: latest.toString() });
  }

  // ------------------------------------------------------------- stock leg

  private async scanStockOutcomes(): Promise<void> {
    const pool = stockConfig.contracts.predictionPool;
    if (!pool) {
      logger.warn("[StockTpAggregator] no stock PredictionPool address configured — stock leg empty");
      return;
    }
    const latest = await this.publicClient.getBlockNumber();
    let from =
      this.stockScannedTo !== null ? this.stockScannedTo + 1n : stockConfig.leaderboard.scanStartBlock;
    if (from > latest) return;

    // Stakes and settlements are collected per fixture, then resolved:
    // a player won a fixture iff they staked on the winning outcome.
    const seasonId = stockConfig.seasonId;
    let touched = 0;
    while (from <= latest) {
      const chunkEnd = from + LOG_SCAN_CHUNK_BLOCKS - 1n;
      const to = chunkEnd > latest ? latest : chunkEnd;
      const [stakes, settlements] = await Promise.all([
        this.publicClient.getLogs({
          address: pool,
          event: STOCK_STAKED_EVENT,
          args: { seasonId },
          fromBlock: from,
          toBlock: to,
        }),
        this.publicClient.getLogs({
          address: pool,
          event: STOCK_SETTLED_EVENT,
          args: { seasonId },
          fromBlock: from,
          toBlock: to,
        }),
      ]);
      // Index this chunk's settlements by fixture.
      const winningByFixture = new Map<string, { outcome: number; blockNumber: bigint; logIndex: number }>();
      for (const s of settlements) {
        winningByFixture.set((s.args.fixtureId as bigint).toString(), {
          outcome: s.args.winningOutcome as number,
          blockNumber: s.blockNumber,
          logIndex: s.logIndex,
        });
      }
      // Resolve stakes against settlements from THIS chunk and from
      // earlier chunks (a fixture can settle in a later chunk than its
      // stakes). Unresolved stakes are kept in a pending map.
      for (const st of stakes) {
        const fixtureKey = (st.args.fixtureId as bigint).toString();
        const player = (st.args.player as string).toLowerCase() as `0x${string}`;
        const pending = this.pendingStockStakes.get(fixtureKey) ?? new Map();
        const outcomes = pending.get(player) ?? new Set<number>();
        outcomes.add(st.args.outcome as number);
        pending.set(player, outcomes);
        this.pendingStockStakes.set(fixtureKey, pending);
      }
      for (const [fixtureKey, win] of winningByFixture) {
        const pending = this.pendingStockStakes.get(fixtureKey);
        if (!pending) continue;
        const isDraw = win.outcome === STOCK_OUTCOME.DRAW;
        for (const [player, stakedOutcomes] of pending) {
          const won = stakedOutcomes.has(win.outcome);
          const list = this.outcomesByPlayer.get(player) ?? [];
          list.push({
            leg: "stock",
            won,
            isDraw: won && isDraw,
            blockNumber: win.blockNumber,
            logIndex: win.logIndex,
          });
          this.outcomesByPlayer.set(player, list);
          touched++;
        }
        this.pendingStockStakes.delete(fixtureKey);
      }
      from = to + 1n;
    }
    this.stockScannedTo = latest;
    if (touched > 0) this.leaderboardCache = null;
    logger.debug("[StockTpAggregator] stock scan complete", {
      touched,
      pendingFixtures: this.pendingStockStakes.size,
      scannedTo: latest.toString(),
    });
  }

  /** fixtureId -> player -> outcomes staked, awaiting settlement. */
  private readonly pendingStockStakes = new Map<string, Map<`0x${string}`, Set<number>>>();

  // ------------------------------------------------------------- scoring

  private buildRow(address: string, outcomes: Outcome[]): TpPlayerView {
    // Chronological order: block number, then log index. Streaks depend on it.
    const sorted = [...outcomes].sort(
      (a, b) =>
        (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0) ||
        a.logIndex - b.logIndex
    );
    let tp = 0;
    let cryptoTp = 0;
    let stockTp = 0;
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let cryptoWins = 0;
    let cryptoLosses = 0;
    let cryptoDraws = 0;
    let stockWins = 0;
    let stockLosses = 0;
    let stockDraws = 0;
    let currentStreak = 0;
    let longestStreak = 0;
    for (const o of sorted) {
      const points = o.won ? (o.isDraw ? TP_DRAW : TP_WIN) : TP_LOSS;
      tp += points;
      if (o.leg === "crypto") cryptoTp += points;
      else stockTp += points;
      if (o.won) {
        wins++;
        if (o.isDraw) draws++;
        if (o.leg === "crypto") {
          cryptoWins++;
          if (o.isDraw) cryptoDraws++;
        } else {
          stockWins++;
          if (o.isDraw) stockDraws++;
        }
        currentStreak++;
        if (currentStreak > longestStreak) longestStreak = currentStreak;
      } else {
        losses++;
        if (o.leg === "crypto") cryptoLosses++;
        else stockLosses++;
        currentStreak = 0;
      }
    }
    const predictions = sorted.length;
    return {
      address: address.toLowerCase(),
      tp,
      cryptoTp,
      stockTp,
      wins,
      losses,
      draws,
      cryptoWins,
      cryptoLosses,
      cryptoDraws,
      stockWins,
      stockLosses,
      stockDraws,
      currentStreak,
      longestStreak,
      predictions,
      winRateBps: predictions > 0 ? Math.round((wins / predictions) * 10_000) : 0,
    };
  }
}
