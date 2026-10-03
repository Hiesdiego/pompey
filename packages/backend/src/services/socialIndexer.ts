/**
 * SocialIndexer — watches MarketFactory events and mirrors them into Supabase.
 *
 * Events: MarketCreated, MarketStaked, MarketResolved, MarketVoided
 * (VoidInitiated/VoidCancelled are ignored for stats).
 *
 * Strategy mirrors the existing backend event scans: getLogs in 900-block
 * chunks (Base Sepolia caps eth_getLogs at 1,000 blocks), a high-water mark
 * in `indexer_state`, backfill on boot, then a 15s poll loop. Handlers are
 * idempotent so a replayed range never double-counts.
 *
 * If Supabase is not configured the indexer is a no-op (warns once).
 *
 * Optimization pass changes:
 * - Uses the shared resilient RPC client (lib/rpc.ts) instead of its own
 *   bare http() client — inherits retry, batching and fallback transport.
 * - parseEventLogs runs with strict:false (was strict:true, contradicting
 *   the comment) — a foreign log at the deploy block (e.g. Ownable's
 *   OwnershipTransferred) previously threw out of scanChunk, the watermark
 *   never advanced, and the poll retried the same chunk every 15s forever.
 * - The poll loop runs through lib/loop.ts (non-overlapping, backoff).
 * - onMarketResolved batches Supabase writes: one bulk stakes upsert + one
 *   bulk user_season_stats upsert instead of ~2 round trips per staker
 *   (a 200-staker market was ~400+ round trips in one handler).
 */
import {
  decodeAbiParameters,
  parseEventLogs,
  type PublicClient,
} from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { publicClient } from "../lib/rpc.js";
import { runLoop, type LoopHandle } from "../lib/loop.js";
import {
  createSeasonIdCache,
  getSocialChainId,
} from "../lib/socialChain.js";

const WATERMARK_KEY = "market_factory";
const CHUNK_BLOCKS = 900n;
const POLL_MS = 15_000;
const BACKFILL_FALLBACK_BLOCKS = 200_000n;

const FACTORY_EVENTS_ABI = [
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "templateId", type: "uint8", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "creatorName", type: "string", indexed: false },
      { name: "params", type: "bytes", indexed: false },
      { name: "bettingCloseTime", type: "uint64", indexed: false },
      { name: "endTime", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MarketStaked",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "outcome", type: "uint256", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MarketResolved",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "winnerBitmap", type: "uint256", indexed: false },
      { name: "payoutPerShare", type: "uint256", indexed: false },
      { name: "resolver", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MarketVoided",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "voider", type: "address", indexed: false },
    ],
  },
  // Parsed but intentionally ignored (no stats impact).
  {
    type: "event",
    name: "VoidInitiated",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "initiator", type: "address", indexed: true },
      { name: "finalizeAfter", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VoidCancelled",
    inputs: [{ name: "marketId", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "payout", type: "uint256", indexed: false },
    ],
  },
] as const;

const FACTORY_VIEWS_ABI = [
  {
    type: "function",
    name: "marketInfo",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "templateId", type: "uint8" },
      { name: "creator", type: "address" },
      { name: "creatorName", type: "string" },
      { name: "createdAt", type: "uint64" },
      { name: "bettingCloseTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "voidAfter", type: "uint64" },
      { name: "params", type: "bytes" },
      { name: "outcomeCount", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "marketSettlement",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "seedAmount", type: "uint256" },
      { name: "totalStaked", type: "uint256" },
      { name: "state", type: "uint8" },
      { name: "winnerBitmap", type: "uint256" },
      { name: "payoutPerShare", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "outcomeTotals",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }, { name: "outcome", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type Db = SupabaseClient;

interface SeasonStatsRow {
  wallet_address: string;
  season_id: number;
  volume_tick: string;
  predictions: number;
  settled: number;
  wins: number;
  losses: number;
  pnl_tick: string;
  current_streak: number;
  best_streak: number;
}

const emptyStats = (wallet: string, season: number): SeasonStatsRow => ({
  wallet_address: wallet,
  season_id: season,
  volume_tick: "0",
  predictions: 0,
  settled: 0,
  wins: 0,
  losses: 0,
  pnl_tick: "0",
  current_streak: 0,
  best_streak: 0,
});

function toStatsRow(data: Record<string, unknown>, wallet: string, season: number): SeasonStatsRow {
  return {
    wallet_address: String(data.wallet_address ?? wallet),
    season_id: Number(data.season_id ?? season),
    volume_tick: String(data.volume_tick ?? "0"),
    predictions: Number(data.predictions ?? 0),
    settled: Number(data.settled ?? 0),
    wins: Number(data.wins ?? 0),
    losses: Number(data.losses ?? 0),
    pnl_tick: String(data.pnl_tick ?? "0"),
    current_streak: Number(data.current_streak ?? 0),
    best_streak: Number(data.best_streak ?? 0),
  };
}

export class SocialIndexer {
  private db: Db | null;
  private client: PublicClient;
  private chainId: number;
  private factory: `0x${string}`;
  private seasonId: { get(): Promise<number> };
  private loop: LoopHandle | null = null;
  private scanning = false;
  private started = false;

  constructor(db: Db | null) {
    this.db = db;
    this.client = publicClient;
    this.chainId = getSocialChainId();
    this.factory = config.contracts.marketFactory;
    this.seasonId = createSeasonIdCache(this.client);
  }

  /** Works even when the indexer is disabled (used by the API for season gating). */
  getSeasonId(): Promise<number> {
    return this.seasonId.get();
  }

  /** Current watermark block (null = never indexed) — for /health. */
  async getWatermarkBlock(): Promise<bigint | null> {
    if (!this.db) return null;
    try {
      return await this.loadWatermark();
    } catch {
      return null;
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.db) {
      logger.warn("[social] indexer disabled — Supabase not configured");
      return;
    }
    logger.info("[social] indexer starting", { factory: this.factory, chainId: this.chainId });

    let from = await this.loadWatermark();
    if (from === null) {
      const latest = await this.client.getBlockNumber();
      const configured = config.social.marketFactoryDeployBlock;
      const deployBlock = /^\d+$/.test(configured) ? BigInt(configured) : 0n;
      from =
        deployBlock > 0n
          ? deployBlock
          : latest > BACKFILL_FALLBACK_BLOCKS
            ? latest - BACKFILL_FALLBACK_BLOCKS
            : 0n;
      logger.info("[social] indexer backfilling", { fromBlock: from.toString() });
    }

    await this.scanRange(from, null).catch((err) => {
      // A failed backfill (e.g. RPC down at boot) must not kill the indexer:
      // the poll loop below retries from the watermark and catches up.
      logger.warn("[social] initial backfill failed, poll loop will retry", {
        error: String(err),
      });
    });
    this.loop = runLoop("social-indexer", POLL_MS, () => this.poll());
    logger.info("[social] indexer live");
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }

  // --- scanning ------------------------------------------------------------

  private async loadWatermark(): Promise<bigint | null> {
    const { data, error } = await this.db!
      .from("indexer_state")
      .select("last_block")
      .eq("key", WATERMARK_KEY)
      .maybeSingle();
    if (error) {
      logger.warn("[social] watermark read failed", { error: error.message });
      return null;
    }
    return data ? BigInt(data.last_block) : null;
  }

  private async saveWatermark(block: bigint): Promise<void> {
    const { error } = await this.db!.from("indexer_state").upsert(
      {
        key: WATERMARK_KEY,
        last_block: block.toString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) logger.warn("[social] watermark write failed", { error: error.message });
  }

  private async poll(): Promise<void> {
    if (this.scanning) return;
    const from = await this.loadWatermark();
    if (from === null) return;
    await this.scanRange(from + 1n, null);
  }

  /** Scan [from, to ?? latest]; advances the watermark chunk by chunk. */
  private async scanRange(from: bigint, to: bigint | null): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const latest = to ?? (await this.client.getBlockNumber());
      let cursor = from;
      while (cursor <= latest) {
        const chunkEnd = cursor + CHUNK_BLOCKS - 1n > latest ? latest : cursor + CHUNK_BLOCKS - 1n;
        await this.scanChunk(cursor, chunkEnd);
        await this.saveWatermark(chunkEnd);
        cursor = chunkEnd + 1n;
      }
    } finally {
      this.scanning = false;
    }
  }

  private async scanChunk(from: bigint, to: bigint): Promise<void> {
    const logs = await this.client.getLogs({
      address: this.factory,
      fromBlock: from,
      toBlock: to,
    });
    if (logs.length === 0) return;

    // Block timestamps (getLogs carries none) — one RPC per unique block,
    // fetched in chunks of 25 to stay kind to the RPC.
    const tsCache = new Map<bigint, string>();
    const blocks = [...new Set(logs.map((l) => l.blockNumber))];
    for (let i = 0; i < blocks.length; i += 25) {
      const chunk = blocks.slice(i, i + 25);
      const fetched = await Promise.all(
        chunk.map((b) => this.client.getBlock({ blockNumber: b }))
      );
      fetched.forEach((block, k) =>
        tsCache.set(chunk[k], new Date(Number(block.timestamp) * 1000).toISOString())
      );
    }

    // strict:false — skip logs outside the ABI (e.g. Ownable's
    // OwnershipTransferred at the deploy block) instead of throwing. A
    // strict parse here used to livelock the indexer: the throw escaped
    // scanChunk, the watermark never advanced, and the poll retried the
    // same chunk every 15s forever.
    const parsed = parseEventLogs({ abi: FACTORY_EVENTS_ABI, logs, strict: false });
    const ordered = parsed
      .map((p, i) => ({ p, log: logs[i] }))
      .sort((a, b) =>
        a.log.blockNumber === b.log.blockNumber
          ? Number(a.log.logIndex - b.log.logIndex)
          : Number(a.log.blockNumber - b.log.blockNumber)
      );

    for (const { p, log } of ordered) {
      const ts = tsCache.get(log.blockNumber) ?? new Date().toISOString();
      try {
        if (p.eventName === "MarketCreated") await this.onMarketCreated(p.args as Parameters<SocialIndexer["onMarketCreated"]>[0], log, ts);
        else if (p.eventName === "MarketStaked") await this.onMarketStaked(p.args as Parameters<SocialIndexer["onMarketStaked"]>[0], log, ts);
        else if (p.eventName === "MarketResolved")
          await this.onMarketResolved(p.args as Parameters<SocialIndexer["onMarketResolved"]>[0], log.blockNumber, ts);
        else if (p.eventName === "MarketVoided")
          await this.onMarketVoided(p.args as Parameters<SocialIndexer["onMarketVoided"]>[0], log.blockNumber);
      } catch (err) {
        // A single bad log must not kill the chunk; the watermark only
        // advances after the chunk completes, so a crash still replays.
        logger.warn("[social] event handler failed", {
          event: p.eventName,
          tx: log.transactionHash,
          error: String(err),
        });
      }
    }
    logger.info("[social] chunk indexed", {
      from: from.toString(),
      to: to.toString(),
      events: ordered.length,
    });
  }

  /**
   * Reconstruct a markets row from chain state. Used when a stake/resolve
   * event arrives without a prior MarketCreated (e.g. the backfill started
   * mid-history) — the stakes→markets FK requires the row to exist.
   */
  private async backfillMarketRow(marketId: bigint, blockNumber: bigint): Promise<void> {
    const [info, settlement] = await Promise.all([
      this.client.readContract({
        address: this.factory,
        abi: FACTORY_VIEWS_ABI,
        functionName: "marketInfo",
        args: [marketId],
        blockNumber,
      }),
      this.client.readContract({
        address: this.factory,
        abi: FACTORY_VIEWS_ABI,
        functionName: "marketSettlement",
        args: [marketId],
        blockNumber,
      }),
    ]);
    const [templateId, creator, creatorName, , bettingCloseTime, endTime, , params] =
      info as unknown as [
        number,
        `0x${string}`,
        string,
        bigint,
        bigint,
        bigint,
        bigint,
        `0x${string}`,
      ];
    const stateNum = Number((settlement as readonly unknown[])[2]);
    const state = stateNum === 1 ? "resolved" : stateNum === 2 ? "voided" : "open";
    const seasonId = this.decodeSeason(templateId, params, await this.seasonId.get());
    const row: Record<string, unknown> = {
      chain_id: this.chainId,
      market_id: marketId.toString(),
      template_id: templateId,
      creator: creator.toLowerCase(),
      creator_name: creatorName,
      params,
      betting_close_time: new Date(Number(bettingCloseTime) * 1000).toISOString(),
      end_time: new Date(Number(endTime) * 1000).toISOString(),
      seed_amount_tick: (settlement[0] as bigint).toString(),
      state,
      season_id: seasonId,
    };
    if (state !== "open") {
      row.winner_bitmap = (settlement[3] as bigint).toString();
      row.payout_per_share = (settlement[4] as bigint).toString();
      const block = await this.client.getBlock({ blockNumber });
      row.resolved_at = new Date(Number(block.timestamp) * 1000).toISOString();
    }
    const { error } = await this.db!.from("markets").upsert(row, {
      onConflict: "chain_id,market_id",
    });
    if (error) throw new Error(`markets backfill upsert failed: ${error.message}`);
  }

  // --- handlers ------------------------------------------------------------

  /** Decode the season id from MarketCreated params by template. */
  private decodeSeason(templateId: number, params: `0x${string}`, fallback: number): number {
    try {
      if (templateId === 0) {
        // TOP_GAINER: (uint256 seasonId, uint8 matchdayIndex)
        const [seasonId] = decodeAbiParameters(
          [{ type: "uint256" }, { type: "uint8" }],
          params
        );
        return Number(seasonId);
      }
      if (templateId === 1) {
        // CHAMPION: (uint256 seasonId)
        const [seasonId] = decodeAbiParameters([{ type: "uint256" }], params);
        return Number(seasonId);
      }
      if (templateId === 4) {
        // SPREAD: (uint256 seasonId, uint256 fixtureId, int16 spreadPoints)
        const [seasonId] = decodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }, { type: "int16" }],
          params
        );
        return Number(seasonId);
      }
    } catch {
      // fall through to fallback
    }
    // H2H (2) / TARGET (3) carry no season — attribute to the current one.
    return fallback;
  }

  private async onMarketCreated(
    args: {
      marketId: bigint;
      templateId: number;
      creator: `0x${string}`;
      creatorName: string;
      params: `0x${string}`;
      bettingCloseTime: bigint;
      endTime: bigint;
    },
    log: { blockNumber: bigint },
    _ts: string
  ): Promise<void> {
    const season = await this.seasonId.get();
    const seasonId = this.decodeSeason(args.templateId, args.params, season);

    // seedAmount is immutable post-creation; read once at the event block.
    let seedAmount = "0";
    try {
      const settlement = await this.client.readContract({
        address: this.factory,
        abi: FACTORY_VIEWS_ABI,
        functionName: "marketSettlement",
        args: [args.marketId],
        blockNumber: log.blockNumber,
      });
      seedAmount = (settlement[0] as bigint).toString();
    } catch {
      // leave as "0"
    }

    const { error } = await this.db!.from("markets").upsert(
      {
        chain_id: this.chainId,
        market_id: args.marketId.toString(),
        template_id: args.templateId,
        creator: args.creator.toLowerCase(),
        creator_name: args.creatorName,
        params: args.params,
        betting_close_time: new Date(Number(args.bettingCloseTime) * 1000).toISOString(),
        end_time: new Date(Number(args.endTime) * 1000).toISOString(),
        seed_amount_tick: seedAmount,
        state: "open",
        season_id: seasonId,
      },
      { onConflict: "chain_id,market_id" }
    );
    if (error) throw new Error(`markets upsert failed: ${error.message}`);
  }

  private async onMarketStaked(
    args: { marketId: bigint; user: `0x${string}`; outcome: bigint; amount: bigint },
    log: { blockNumber: bigint; transactionHash: `0x${string}`; logIndex: number },
    ts: string
  ): Promise<void> {
    const db = this.db!;
    const staker = args.user.toLowerCase();
    const marketIdStr = args.marketId.toString();

    // Idempotency: skip already-processed logs.
    const { data: seen } = await db
      .from("stakes")
      .select("id")
      .eq("chain_id", this.chainId)
      .eq("tx_hash", log.transactionHash)
      .eq("log_index", log.logIndex)
      .limit(1);
    if (seen && seen.length > 0) return;

    // Market context (denormalized onto the stake row for cheap analytics).
    // Self-heal: the markets row may be missing when the backfill started
    // after the market was created — the stakes→markets FK requires it.
    let marketRow = (
      await db
        .from("markets")
        .select("season_id,template_id")
        .eq("chain_id", this.chainId)
        .eq("market_id", marketIdStr)
        .maybeSingle()
    ).data;
    if (!marketRow) {
      await this.backfillMarketRow(args.marketId, log.blockNumber);
      marketRow = (
        await db
          .from("markets")
          .select("season_id,template_id")
          .eq("chain_id", this.chainId)
          .eq("market_id", marketIdStr)
          .maybeSingle()
      ).data;
    }
    const seasonId: number = marketRow?.season_id ?? (await this.seasonId.get());
    const templateId: number | null = marketRow?.template_id ?? null;

    // Best-effort implied win probability right after the stake.
    let oddsBps: number | null = null;
    try {
      const [outcomeTotal, settlement] = await Promise.all([
        this.client.readContract({
          address: this.factory,
          abi: FACTORY_VIEWS_ABI,
          functionName: "outcomeTotals",
          args: [args.marketId, args.outcome],
          blockNumber: log.blockNumber,
        }),
        this.client.readContract({
          address: this.factory,
          abi: FACTORY_VIEWS_ABI,
          functionName: "marketSettlement",
          args: [args.marketId],
          blockNumber: log.blockNumber,
        }),
      ]);
      const total = settlement[1] as bigint;
      if (total > 0n) oddsBps = Number((outcomeTotal * 10_000n) / total);
    } catch {
      // leave null (e.g. historical backfill against a pruned node)
    }

    const { error: insertError } = await db.from("stakes").insert({
      chain_id: this.chainId,
      market_id: marketIdStr,
      staker,
      outcome: Number(args.outcome),
      amount_tick: args.amount.toString(),
      odds_bps: oddsBps,
      pnl_tick: null,
      won: null,
      tx_hash: log.transactionHash,
      log_index: log.logIndex,
      block_number: log.blockNumber.toString(),
      block_timestamp: ts,
      season_id: seasonId,
      template_id: templateId,
    });
    if (insertError) throw new Error(`stakes insert failed: ${insertError.message}`);

    // predictions counts DISTINCT markets staked (multiple stakes, one prediction).
    const { data: prior } = await db
      .from("stakes")
      .select("id")
      .eq("chain_id", this.chainId)
      .eq("staker", staker)
      .eq("market_id", marketIdStr)
      .limit(2);
    const isNewPrediction = (prior?.length ?? 0) <= 1; // 1 = the row just inserted
    await this.bumpStats(staker, seasonId, (s) => {
      s.volume_tick = (BigInt(s.volume_tick) + args.amount).toString();
      if (isNewPrediction) s.predictions += 1;
    });
  }

  private async onMarketResolved(
    args: { marketId: bigint; winnerBitmap: bigint; payoutPerShare: bigint },
    blockNumber: bigint,
    ts: string
  ): Promise<void> {
    const db = this.db!;
    const marketIdStr = args.marketId.toString();

    // Idempotency: a market resolves exactly once.
    let market = (
      await db
        .from("markets")
        .select("state,season_id")
        .eq("chain_id", this.chainId)
        .eq("market_id", marketIdStr)
        .maybeSingle()
    ).data;
    if (!market) {
      // Backfill started after creation: reconstruct the row from chain state.
      await this.backfillMarketRow(args.marketId, blockNumber);
      market = (
        await db
          .from("markets")
          .select("state,season_id")
          .eq("chain_id", this.chainId)
          .eq("market_id", marketIdStr)
          .maybeSingle()
      ).data;
    }
    if (market?.state === "resolved") return;
    const seasonId: number = market?.season_id ?? (await this.seasonId.get());

    const { error: marketError } = await db
      .from("markets")
      .update({
        state: "resolved",
        winner_bitmap: args.winnerBitmap.toString(),
        payout_per_share: args.payoutPerShare.toString(),
        resolved_at: ts,
      })
      .eq("chain_id", this.chainId)
      .eq("market_id", marketIdStr);
    if (marketError) throw new Error(`markets resolve update failed: ${marketError.message}`);

    const { data: stakes, error: stakesError } = await db
      .from("stakes")
      .select("id,staker,outcome,amount_tick")
      .eq("chain_id", this.chainId)
      .eq("market_id", marketIdStr);
    if (stakesError) throw new Error(`stakes read failed: ${stakesError.message}`);

    // Per-stake realized PnL, aggregated per staker — then written back in
    // BULK (one stakes upsert + one stats upsert) instead of ~2 round trips
    // per staker.
    const byStaker = new Map<string, bigint>();
    const wonByStaker = new Set<string>();
    const stakeUpdates: Array<{ id: number; won: boolean; pnl_tick: string }> = [];
    for (const row of (stakes ?? []) as Array<{
      id: number;
      staker: string;
      outcome: number;
      amount_tick: string;
    }>) {
      const amount = BigInt(row.amount_tick);
      const won = ((args.winnerBitmap >> BigInt(row.outcome)) & 1n) === 1n;
      if (won) wonByStaker.add(row.staker);
      const payout = won ? (amount * args.payoutPerShare) / 10n ** 18n : 0n;
      const pnl = payout - amount;
      byStaker.set(row.staker, (byStaker.get(row.staker) ?? 0n) + pnl);
      stakeUpdates.push({ id: row.id, won, pnl_tick: pnl.toString() });
    }
    if (stakeUpdates.length > 0) {
      const { error } = await db.from("stakes").upsert(stakeUpdates, { onConflict: "id" });
      if (error) logger.warn("[social] bulk stake pnl update failed", { error: error.message });
    }

    // Per-(staker, market) net outcome → season stats, in ONE bulk upsert.
    const stakers = [...byStaker.keys()];
    if (stakers.length > 0) {
      const { data: existing } = await db
        .from("user_season_stats")
        .select("*")
        .in("wallet_address", stakers)
        .eq("season_id", seasonId);
      const byWallet = new Map<string, Record<string, unknown>>(
        ((existing ?? []) as Array<Record<string, unknown>>).map((r) => [
          String(r.wallet_address),
          r,
        ])
      );
      const now = new Date().toISOString();
      const rows = stakers.map((staker) => {
        const data = byWallet.get(staker);
        const s = data ? toStatsRow(data, staker, seasonId) : emptyStats(staker, seasonId);
        const net = byStaker.get(staker) ?? 0n;
        s.settled += 1;
        s.pnl_tick = (BigInt(s.pnl_tick) + net).toString();
        if (wonByStaker.has(staker)) {
          s.wins += 1;
          s.current_streak += 1;
          if (s.current_streak > s.best_streak) s.best_streak = s.current_streak;
        } else if (net < 0n) {
          s.losses += 1;
          s.current_streak = 0;
        }
        // net == 0 is a push: counts as settled, streak untouched.
        return { ...s, updated_at: now };
      });
      const { error } = await db
        .from("user_season_stats")
        .upsert(rows, { onConflict: "wallet_address,season_id" });
      if (error) throw new Error(`stats bulk upsert failed: ${error.message}`);
    }
  }

  private async onMarketVoided(args: { marketId: bigint }, blockNumber: bigint): Promise<void> {
    const db = this.db!;
    const marketIdStr = args.marketId.toString();

    let market = (
      await db
        .from("markets")
        .select("state")
        .eq("chain_id", this.chainId)
        .eq("market_id", marketIdStr)
        .maybeSingle()
    ).data;
    if (!market) {
      // Backfill started after creation: reconstruct the row from chain state
      // (already voided on-chain, so the backfill marks it correctly).
      await this.backfillMarketRow(args.marketId, blockNumber);
      return;
    }
    if (market.state === "voided") return;

    const { error: marketError } = await db
      .from("markets")
      .update({ state: "voided", resolved_at: new Date().toISOString() })
      .eq("chain_id", this.chainId)
      .eq("market_id", marketIdStr);
    if (marketError) throw new Error(`markets void update failed: ${marketError.message}`);

    // Voided stakes refund in full: zero PnL, excluded from settled stats.
    const { error: stakesError } = await db
      .from("stakes")
      .update({ won: null, pnl_tick: "0" })
      .eq("chain_id", this.chainId)
      .eq("market_id", marketIdStr);
    if (stakesError) throw new Error(`stakes void update failed: ${stakesError.message}`);
  }

  // --- stats helper ----------------------------------------------------------

  private async bumpStats(
    wallet: string,
    seasonId: number,
    mutate: (s: SeasonStatsRow) => void
  ): Promise<void> {
    const db = this.db!;
    const { data } = await db
      .from("user_season_stats")
      .select("*")
      .eq("wallet_address", wallet)
      .eq("season_id", seasonId)
      .maybeSingle();
    const row: SeasonStatsRow = data
      ? toStatsRow(data as Record<string, unknown>, wallet, seasonId)
      : emptyStats(wallet, seasonId);
    mutate(row);
    const { error } = await db.from("user_season_stats").upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: "wallet_address,season_id" }
    );
    if (error) throw new Error(`stats upsert failed: ${error.message}`);
  }
}
