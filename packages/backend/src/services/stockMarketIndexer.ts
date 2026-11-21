/**
 * Stock market dirty indexer: the stake-driven dirty feed for the
 * stock price target markets.
 *
 * Intended destination: packages/backend/src/services/stockMarketIndexer.ts.
 * Mirrors services/socialIndexer.ts (the crypto SocialIndexer) pattern
 * for pattern, narrowed to the one job this service exists for:
 * calling StockMarketReader.markMarketDirty when StockMarketFactory
 * activity lands on-chain, so GET /api/stocks/markets refreshes the
 * touched market on the next list read instead of serving the
 * 10-minute list cache until the TTL expires.
 *
 * What is copied from SocialIndexer, deliberately:
 *   - Poll cadence: POLL_MS = 120_000 through lib/loop.ts runLoop
 *     (non-overlapping, backoff on failure), with an initial scan at
 *     start() before the loop begins.
 *   - Chunked getLogs: CHUNK_BLOCKS = 900 blocks per chunk (Base
 *     Sepolia public RPCs cap eth_getLogs near 1,000 blocks),
 *     MAX_CHUNKS_PER_SCAN = 10 chunks per pass, resuming from the
 *     persisted watermark on the next pass when a catch-up is longer
 *     than one pass.
 *   - Persisted watermark: the SAME Supabase indexer_state table the
 *     crypto indexer uses (key text primary key, last_block,
 *     updated_at), under a distinct key, stock_market_factory. The
 *     crypto indexer uses market_factory and the cup leaderboard
 *     indexer already stores its own key in the same table, so a
 *     second indexer needs no schema change and no migration.
 *   - Backfill anchor: when no watermark exists, scanning starts at
 *     the factory deploy block (stockMarketConfig.factoryDeployBlock,
 *     STOCK_MARKET_FACTORY_DEPLOY_BLOCK), falling back to the latest
 *     block minus BACKFILL_FALLBACK_BLOCKS (200,000), mirroring
 *     SocialIndexer's MARKET_FACTORY_DEPLOY_BLOCK handling.
 *   - Disabled without Supabase: like SocialIndexer, start() logs a
 *     warning and returns when the db handle is null, because the
 *     watermark has nowhere durable to live. The reader then falls
 *     back to keeper dirty marks and TTL expiry, exactly as it did
 *     before this indexer existed.
 *
 * Deliberate differences from SocialIndexer, all forced by scope:
 *   - NO social writes. This indexer never touches the markets,
 *     stakes or user_season_stats tables: the stock factory has no
 *     social layer in the locked API contract, and the reader reads
 *     the chain directly. The only row it writes is its own
 *     indexer_state watermark. Because no event rows are stored, it
 *     also skips SocialIndexer's per-block timestamp fetch, which
 *     keeps each scan to getLogs calls only (bandwidth discipline:
 *     event scans are cheap, no per-request upstream calls).
 *   - Stock RPC transport: reads go through the stock stack's
 *     fallback client (createStockMarketPublicClient in
 *     stockMarketConfig.ts), never the crypto lib/rpc.ts client, and
 *     the factory address and deploy block come from
 *     stockMarketConfig, mirroring how StockMarketReader and
 *     StockMarketKeeper are built. index.ts constructs and starts
 *     this indexer only when stockMarketConfigured() is true,
 *     alongside the rest of the stock market stack.
 *   - Event set: MarketCreated, MarketStaked, MarketResolved and
 *     MarketVoided, each of which changes what the market list
 *     serves (a new market, new totals, or a settled state), so each
 *     one marks its market dirty. The keeper ALSO marks markets
 *     dirty directly after its own resolves and voids; a duplicate
 *     mark is a harmless version bump in the reader. Claimed is not
 *     tracked: a claim changes no field in the market summary.
 *
 * The event ABI below uses the StockMarketFactory contract's own
 * signatures (packages/contracts/contracts/StockMarketFactory.sol),
 * including which parameters are indexed. MarketStaked matches the
 * fragment already carried in stockMarketReader.ts verbatim:
 * MarketStaked(uint256 indexed marketId, address indexed user,
 * uint256 outcome, uint256 amount).
 */

import { parseEventLogs, type PublicClient } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  stockMarketConfig,
  createStockMarketPublicClient,
} from "../stockMarketConfig.js";
import { logger } from "../lib/logger.js";
import { runLoop, type LoopHandle } from "../lib/loop.js";

const WATERMARK_KEY = "stock_market_factory";
const CHUNK_BLOCKS = 900n;
const POLL_MS = 120_000;
const MAX_CHUNKS_PER_SCAN = 10;
const BACKFILL_FALLBACK_BLOCKS = 200_000n;

export const STOCK_MARKET_FACTORY_EVENTS_ABI = [
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "stockToken", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "stockSymbol", type: "string", indexed: false },
      { name: "creatorName", type: "string", indexed: false },
      { name: "direction", type: "uint8", indexed: false },
      { name: "targetPrice", type: "uint256", indexed: false },
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
] as const;

type Db = SupabaseClient;

export interface StockMarketIndexerOpts {
  /** StockMarketFactory address override (tests). Defaults to
   *  stockMarketConfig.factoryAddress. */
  factory?: `0x${string}`;
  /** RPC client override (tests). Defaults to the stock stack's
   *  fallback-transport client. */
  publicClient?: PublicClient;
  /** First block the factory exists at (tests). Defaults to
   *  stockMarketConfig.factoryDeployBlock. */
  deployBlock?: bigint;
}

export class StockMarketIndexer {
  private db: Db | null;
  private readonly onMarketChanged?: (marketId: bigint) => void;
  private client: PublicClient;
  private readonly factory: `0x${string}`;
  private readonly deployBlock: bigint;
  private loop: LoopHandle | null = null;
  private scanning = false;
  private started = false;
  private nextBlock: bigint | null = null;

  constructor(
    db: Db | null,
    onMarketChanged?: (marketId: bigint) => void,
    opts: StockMarketIndexerOpts = {}
  ) {
    this.db = db;
    this.onMarketChanged = onMarketChanged;
    this.factory = opts.factory ?? stockMarketConfig.factoryAddress;
    this.client = opts.publicClient ?? createStockMarketPublicClient();
    this.deployBlock = opts.deployBlock ?? stockMarketConfig.factoryDeployBlock;
  }

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
      logger.warn("[stock-market-indexer] indexer disabled, Supabase not configured");
      return;
    }
    if (!this.factory) {
      logger.info("[stock-market-indexer] STOCK_MARKET_FACTORY_ADDRESS not set, indexer idle");
      return;
    }
    logger.info("[stock-market-indexer] indexer starting", { factory: this.factory });

    const watermark = await this.loadWatermark();
    let from = watermark;
    if (from === null) {
      const latest = await this.client.getBlockNumber();
      from =
        this.deployBlock > 0n
          ? this.deployBlock
          : latest > BACKFILL_FALLBACK_BLOCKS
            ? latest - BACKFILL_FALLBACK_BLOCKS
            : 0n;
      logger.info("[stock-market-indexer] indexer backfilling", { fromBlock: from.toString() });
    }
    this.nextBlock = watermark === null ? from : from + 1n;

    await this.scanRange(this.nextBlock, null).catch((err) => {
      logger.warn("[stock-market-indexer] initial backfill failed, poll loop will retry", {
        error: String(err),
      });
    });
    this.loop = runLoop("stock-market-indexer", POLL_MS, () => this.poll());
    logger.info("[stock-market-indexer] indexer live");
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }

  private async loadWatermark(): Promise<bigint | null> {
    const { data, error } = await this.db!
      .from("indexer_state")
      .select("last_block")
      .eq("key", WATERMARK_KEY)
      .maybeSingle();
    if (error) {
      logger.warn("[stock-market-indexer] watermark read failed", { error: error.message });
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
    if (error) throw new Error(`watermark write failed: ${error.message}`);
  }

  private async poll(): Promise<void> {
    if (this.scanning) return;
    if (this.nextBlock === null) return;
    await this.scanRange(this.nextBlock, null);
  }

  private async scanRange(from: bigint, to: bigint | null): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const latest = to ?? (await this.client.getBlockNumber());
      let cursor = from;
      let chunks = 0;
      while (cursor <= latest && chunks < MAX_CHUNKS_PER_SCAN) {
        const chunkEnd = cursor + CHUNK_BLOCKS - 1n > latest ? latest : cursor + CHUNK_BLOCKS - 1n;
        await this.scanChunk(cursor, chunkEnd);
        await this.saveWatermark(chunkEnd);
        cursor = chunkEnd + 1n;
        this.nextBlock = cursor;
        chunks++;
      }
      if (cursor <= latest) logger.info("[stock-market-indexer] backfill deferred", {
        nextBlock: cursor.toString(),
        remainingBlocks: (latest - cursor + 1n).toString(),
      });
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

    const parsed = parseEventLogs({ abi: STOCK_MARKET_FACTORY_EVENTS_ABI, logs, strict: false });
    let marked = 0;
    for (const p of parsed) {
      const marketId = (p.args as { marketId?: bigint } | undefined)?.marketId;
      if (marketId === undefined) continue;
      try {
        this.onMarketChanged?.(marketId);
        marked++;
      } catch (err) {
        logger.warn("[stock-market-indexer] dirty callback failed", {
          event: p.eventName,
          marketId: marketId.toString(),
          error: String(err),
        });
      }
    }
    logger.info("[stock-market-indexer] chunk indexed", {
      from: from.toString(),
      to: to.toString(),
      events: parsed.length,
      marked,
    });
  }
}
