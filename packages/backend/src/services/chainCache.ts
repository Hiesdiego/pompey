/**
 * ChainCache — backend-side read cache + request coalescing for chain data.
 *
 * This is the RPC shield: instead of every frontend client hammering the
 * RPC provider directly (N users × M calls each = rate-limit death), all
 * hot-path chain reads go through these three cached endpoints:
 *
 *   GET /api/chain/markets            — all markets + outcome totals (10s TTL)
 *   GET /api/chain/markets/:id        — one market (10s TTL)
 *   GET /api/chain/odds-history/:id   — stake-driven odds history (incremental)
 *
 * Design points:
 * - TTL caching: the markets list refreshes at most every 10s no matter how
 *   many clients ask. A thousand users polling every 15s costs the RPC
 *   ~6 multicall-sets per minute, not thousands.
 * - In-flight coalescing: concurrent identical requests share one promise —
 *   a thundering herd still issues a single upstream fetch.
 * - Multicall everywhere: marketInfo ×N + marketSettlement ×N + all
 *   outcomeTotals collapse into a handful of RPC calls (the old frontend
 *   path needed 3+2N+1 calls per market page — 44 for a 20-outcome market).
 * - Odds history is cursor-based: the server remembers the last indexed
 *   block per market and only fetches NEW MarketStaked logs. Cumulative
 *   outcome totals are replayed from the events themselves (exact — totals
 *   only grow via stakes), so no per-block state reads. A background warmer
 *   keeps cursors advancing; the endpoint does a bounded catch-up per
 *   request so it always answers fast.
 */
import { publicClient, withRpcRetry } from "../lib/rpc.js";
import { runLoop, type LoopHandle } from "../lib/loop.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { meter } from "../lib/net.js";

const FACTORY_READ_ABI = [
  {
    type: "function",
    name: "marketCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
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
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcome", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
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
] as const;

/** Wire format for the frontend hooks (bigints serialized as strings). */
export interface MarketSummary {
  id: number;
  templateId: number;
  creator: string;
  creatorName: string;
  params: string;
  bettingCloseTime: number;
  endTime: number;
  state: number;
  winnerBitmap: string;
  payoutPerShare: string;
  seedAmount: string;
  totalStaked: string;
  outcomeTotals: string[];
  outcomeCount: number;
}

export interface OddsPoint {
  /** Block number (safe integer). */
  block: number;
  /** Block timestamp, Unix seconds. */
  ts: number;
  /** Cumulative outcome totals at this block, as decimal strings. */
  totals: string[];
}

export class ChainApiError extends Error {
  readonly code: "NOT_FOUND" | "RPC_UNAVAILABLE" | "BAD_REQUEST";
  constructor(code: ChainApiError["code"], message: string) {
    super(message);
    this.name = "ChainApiError";
    this.code = code;
  }
}

/**
 * viem may expose a multi-value Solidity return as a positional tuple
 * rather than an object with the ABI output names. Normalize both shapes
 * at the contract boundary (same convention as the frontend's
 * normalizeMarketInfo / normalizeMarketSettlement in lib/marketFactory.ts).
 */
export interface MarketInfoFields {
  templateId: number;
  creator: string;
  creatorName: string;
  bettingCloseTime: bigint;
  endTime: bigint;
  params: string;
  outcomeCount: number;
}

export interface MarketSettlementFields {
  seedAmount: bigint;
  totalStaked: bigint;
  state: number;
  winnerBitmap: bigint;
  payoutPerShare: bigint;
}

function field<T>(r: Record<string | number, unknown>, name: string, index: number): T {
  return (r[name] ?? r[index]) as T;
}

export function normalizeMarketInfoResult(raw: unknown): MarketInfoFields {
  const r = raw as Record<string | number, unknown>;
  return {
    templateId: field<number>(r, "templateId", 0),
    creator: field<string>(r, "creator", 1),
    creatorName: field<string>(r, "creatorName", 2),
    bettingCloseTime: field<bigint>(r, "bettingCloseTime", 4),
    endTime: field<bigint>(r, "endTime", 5),
    params: field<string>(r, "params", 7),
    outcomeCount: field<number>(r, "outcomeCount", 8),
  };
}

export function normalizeMarketSettlementResult(raw: unknown): MarketSettlementFields {
  const r = raw as Record<string | number, unknown>;
  return {
    seedAmount: field<bigint>(r, "seedAmount", 0),
    totalStaked: field<bigint>(r, "totalStaked", 1),
    state: field<number>(r, "state", 2),
    winnerBitmap: field<bigint>(r, "winnerBitmap", 3),
    payoutPerShare: field<bigint>(r, "payoutPerShare", 4),
  };
}

const MARKETS_TTL_MS = 10_000;
const MARKET_TTL_MS = 10_000;
const MULTICALL_CHUNK = 100;
const LOG_CHUNK_BLOCKS = 900n;
/** First-seen markets seed history from ~11.5 days back (2s blocks). */
const ODDS_SEED_LOOKBACK_BLOCKS = 500_000n;
/** Max log chunks processed per request — keeps the endpoint fast; the */
/** background warmer does the heavy lifting. */
const ODDS_MAX_CHUNKS_PER_CALL = 30;
const ODDS_MAX_POINTS = 500;

interface OddsCursor {
  latestBlock: bigint;
  totals: bigint[];
  outcomeCount: number;
  points: OddsPoint[];
  warming: boolean;
}

type MulticallResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

type FactoryCall = {
  address: `0x${string}`;
  abi: typeof FACTORY_READ_ABI;
  functionName: "marketInfo" | "marketSettlement" | "outcomeTotals";
  args: readonly [bigint] | readonly [bigint, bigint];
};

export class ChainCache {
  private readonly factory: `0x${string}`;
  private marketsCache: { at: number; value: { markets: MarketSummary[]; asOfBlock: string } } | null = null;
  private readonly marketCache = new Map<string, { at: number; value: MarketSummary }>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly oddsCursors = new Map<bigint, OddsCursor>();
  private readonly oddsLocks = new Map<bigint, Promise<void>>();
  private warmer: LoopHandle | null = null;
  private warmerCursor = 0;

  constructor() {
    this.factory = config.contracts.marketFactory;
  }

  // --- public API ----------------------------------------------------------

  async getMarkets(): Promise<{ markets: MarketSummary[]; asOfBlock: string }> {
    return this.coalesce("markets", async () => {
      const now = Date.now();
      if (this.marketsCache && now - this.marketsCache.at < MARKETS_TTL_MS) {
        return this.marketsCache.value;
      }
      const value = await this.fetchMarkets().catch((err) => {
        throw new ChainApiError("RPC_UNAVAILABLE", rpcUnavailableMessage(err));
      });
      this.marketsCache = { at: now, value };
      return value;
    }) as Promise<{ markets: MarketSummary[]; asOfBlock: string }>;
  }

  async getMarket(id: number): Promise<MarketSummary> {
    if (!Number.isInteger(id) || id < 0) {
      throw new ChainApiError("BAD_REQUEST", "Market id must be a non-negative integer.");
    }
    const key = `market:${id}`;
    return this.coalesce(key, async () => {
      const now = Date.now();
      const cached = this.marketCache.get(key);
      if (cached && now - cached.at < MARKET_TTL_MS) return cached.value;
      const value = await this.fetchMarket(BigInt(id)).catch((err) => {
        if (err instanceof ChainApiError) throw err;
        throw new ChainApiError("RPC_UNAVAILABLE", rpcUnavailableMessage(err));
      });
      this.marketCache.set(key, { at: now, value });
      // Keep the single-market cache bounded.
      if (this.marketCache.size > 500) {
        const oldest = this.marketCache.keys().next().value;
        if (oldest !== undefined) this.marketCache.delete(oldest);
      }
      return value;
    }) as Promise<MarketSummary>;
  }

  async getOddsHistory(
    id: number
  ): Promise<{ points: OddsPoint[]; latestBlock: number; warming: boolean }> {
    if (!Number.isInteger(id) || id < 0) {
      throw new ChainApiError("BAD_REQUEST", "Market id must be a non-negative integer.");
    }
    const marketId = BigInt(id);
    const cursor = await this.withOddsLock(marketId, () =>
      this.advanceOddsCursor(marketId, ODDS_MAX_CHUNKS_PER_CALL).catch((err) => {
        if (err instanceof ChainApiError) throw err;
        throw new ChainApiError("RPC_UNAVAILABLE", rpcUnavailableMessage(err));
      })
    );
    return {
      points: cursor.points,
      latestBlock: Number(cursor.latestBlock),
      warming: cursor.warming,
    };
  }

  /** Background warmer: advances odds cursors so endpoints stay fast. */
  startWarmer(): void {
    if (this.warmer) return;
    this.warmer = runLoop(
      "chaincache-odds-warmer",
      30_000,
      async () => {
        const count = await withRpcRetry("odds-warmer:marketCount", () =>
          publicClient.readContract({
            address: this.factory,
            abi: FACTORY_READ_ABI,
            functionName: "marketCount",
          })
        );
        const n = Number(count);
        if (n === 0) return;
        // Round-robin: at most 20 markets per pass so one pass stays cheap.
        const perPass = Math.min(20, n);
        for (let k = 0; k < perPass; k++) {
          const id = BigInt((this.warmerCursor + k) % n);
          try {
            await this.withOddsLock(id, () => this.advanceOddsCursor(id, ODDS_MAX_CHUNKS_PER_CALL));
          } catch (err) {
            logger.warn("[chaincache] warmer advance failed", {
              marketId: id.toString(),
              error: String(err),
            });
          }
        }
        this.warmerCursor = (this.warmerCursor + perPass) % n;
      },
      { immediate: false }
    );
  }

  stop(): void {
    this.warmer?.stop();
    this.warmer = null;
  }

  // --- markets ---------------------------------------------------------------

  private async fetchMarkets(): Promise<{ markets: MarketSummary[]; asOfBlock: string }> {
    const [count, asOfBlock] = await Promise.all([
      withRpcRetry("chaincache:marketCount", () =>
        publicClient.readContract({
          address: this.factory,
          abi: FACTORY_READ_ABI,
          functionName: "marketCount",
        })
      ),
      withRpcRetry("chaincache:blockNumber", () => publicClient.getBlockNumber()),
    ]);
    const n = Number(count);
    if (n === 0) return { markets: [], asOfBlock: asOfBlock.toString() };
    if (n > 10_000) throw new Error(`marketCount absurdly large: ${n}`);

    const ids = Array.from({ length: n }, (_, i) => BigInt(i));

    // ONE multicall for all marketInfo + ONE for all marketSettlement.
    const infoResults = await this.multicallChunked(
      ids.map((id) => ({
        address: this.factory,
        abi: FACTORY_READ_ABI,
        functionName: "marketInfo",
        args: [id],
      }))
    );
    const settlementResults = await this.multicallChunked(
      ids.map((id) => ({
        address: this.factory,
        abi: FACTORY_READ_ABI,
        functionName: "marketSettlement",
        args: [id],
      }))
    );

    // ONE multicall for every (market, outcome) pair.
    const totalPairs: Array<{ marketIdx: number; outcome: bigint }> = [];
    const outcomeCounts: number[] = [];
    const pairOffset: number[] = [];
    let pairAcc = 0;
    infoResults.forEach((r, i) => {
      const info = normalizeMarketInfoResult(unwrap(r, `marketInfo(${ids[i]})`));
      const c = Number(info.outcomeCount);
      outcomeCounts.push(c);
      pairOffset.push(pairAcc);
      pairAcc += c;
      for (let o = 0; o < c; o++) totalPairs.push({ marketIdx: i, outcome: BigInt(o) });
    });
    const totalsResults = await this.multicallChunked(
      totalPairs.map((p) => ({
        address: this.factory,
        abi: FACTORY_READ_ABI,
        functionName: "outcomeTotals",
        args: [ids[p.marketIdx], p.outcome],
      })),
      200
    );

    const markets: MarketSummary[] = ids.map((id, i) => {
      const info = normalizeMarketInfoResult(unwrap(infoResults[i], `marketInfo(${id})`));
      const settlement = normalizeMarketSettlementResult(
        unwrap(settlementResults[i], `marketSettlement(${id})`)
      );
      // totalsResults entries for market i start at its prefix offset.
      const start = pairOffset[i];
      const outcomeTotals: string[] = [];
      for (let k = 0; k < outcomeCounts[i]; k++) {
        outcomeTotals.push(
          (unwrap(totalsResults[start + k], `outcomeTotals(${id},${k})`) as bigint).toString()
        );
      }
      return {
        id: Number(id),
        templateId: Number(info.templateId),
        creator: info.creator,
        creatorName: info.creatorName,
        params: info.params,
        bettingCloseTime: Number(info.bettingCloseTime),
        endTime: Number(info.endTime),
        state: Number(settlement.state),
        winnerBitmap: settlement.winnerBitmap.toString(),
        payoutPerShare: settlement.payoutPerShare.toString(),
        seedAmount: settlement.seedAmount.toString(),
        totalStaked: settlement.totalStaked.toString(),
        outcomeTotals,
        outcomeCount: Number(info.outcomeCount),
      };
    });

    meter.count("chaincache_markets_refresh", 1);
    return { markets, asOfBlock: asOfBlock.toString() };
  }

  private async fetchMarket(id: bigint): Promise<MarketSummary> {
    const [infoRaw, settlementRaw] = (await withRpcRetry(`chaincache:market(${id})`, () =>
      publicClient.multicall({
        contracts: [
          { address: this.factory, abi: FACTORY_READ_ABI, functionName: "marketInfo", args: [id] },
          { address: this.factory, abi: FACTORY_READ_ABI, functionName: "marketSettlement", args: [id] },
        ],
        allowFailure: false,
      })
    ).catch((err) => {
      throw looksLikeMissingMarket(err)
        ? new ChainApiError("NOT_FOUND", `Market #${id} does not exist.`)
        : err;
    })) as unknown as [unknown, unknown];
    const info = normalizeMarketInfoResult(infoRaw);
    const settlement = normalizeMarketSettlementResult(settlementRaw);
    const outcomeCount = Number(info.outcomeCount);
    const totals = await this.multicallChunked(
      Array.from({ length: outcomeCount }, (_, o) => ({
        address: this.factory,
        abi: FACTORY_READ_ABI,
        functionName: "outcomeTotals",
        args: [id, BigInt(o)],
      })),
      200
    );
    return {
      id: Number(id),
      templateId: Number(info.templateId),
      creator: info.creator,
      creatorName: info.creatorName,
      params: info.params,
      bettingCloseTime: Number(info.bettingCloseTime),
      endTime: Number(info.endTime),
      state: Number(settlement.state),
      winnerBitmap: settlement.winnerBitmap.toString(),
      payoutPerShare: settlement.payoutPerShare.toString(),
      seedAmount: settlement.seedAmount.toString(),
      totalStaked: settlement.totalStaked.toString(),
      outcomeTotals: totals.map((r) => (unwrap(r, `outcomeTotals(${id})`) as bigint).toString()),
      outcomeCount,
    };
  }

  // --- odds history ------------------------------------------------------------

  /**
   * Advance one market's cursor by up to maxChunks log chunks. Cumulative
   * totals are replayed from MarketStaked events (exact — outcome totals
   * only grow via stakes), so this costs ~1 getLogs per 900 blocks plus
   * one getBlock per block that actually had stakes.
   */
  private async advanceOddsCursor(marketId: bigint, maxChunks: number): Promise<OddsCursor> {
    let cursor = this.oddsCursors.get(marketId);
    const latest = await withRpcRetry(`odds(${marketId}):blockNumber`, () =>
      publicClient.getBlockNumber()
    );

    if (!cursor) {
      cursor = await this.seedOddsCursor(marketId, latest);
      this.oddsCursors.set(marketId, cursor);
    }

    let from = cursor.latestBlock + 1n;
    let chunks = 0;
    while (from <= latest && chunks < maxChunks) {
      const to = from + LOG_CHUNK_BLOCKS - 1n > latest ? latest : from + LOG_CHUNK_BLOCKS - 1n;
      const logs = await withRpcRetry(`odds(${marketId}):getLogs`, () =>
        publicClient.getLogs({
          address: this.factory,
          abi: FACTORY_READ_ABI,
          eventName: "MarketStaked",
          args: { marketId },
          fromBlock: from,
          toBlock: to,
        })
      );
      if (logs.length > 0) await this.applyStakeLogs(cursor, logs);
      cursor.latestBlock = to;
      from = to + 1n;
      chunks++;
    }
    if (cursor.latestBlock >= latest - 1n) cursor.warming = false;
    return cursor;
  }

  /**
   * First sight of a market: read the CURRENT outcome totals at the seed
   * block (one multicall — exact, no replay needed), then replay only logs
   * after the seed block. Without this, seeding mid-history would silently
   * under-count every earlier stake.
   */
  private async seedOddsCursor(marketId: bigint, latest: bigint): Promise<OddsCursor> {
    const market = await this.getMarket(Number(marketId)).catch(() => null);
    if (!market) throw new ChainApiError("NOT_FOUND", `Market #${marketId} does not exist.`);
    const outcomeCount = market.outcomeCount;
    const seedFrom = latest > ODDS_SEED_LOOKBACK_BLOCKS ? latest - ODDS_SEED_LOOKBACK_BLOCKS : 0n;
    // Never seed from before the factory existed: at earlier blocks the
    // address has no code, so outcomeTotals returns empty ("0x") and viem
    // throws "returned no data". No stakes can predate deployment, so
    // clamping is exact, not approximate. Requires MARKET_FACTORY_DEPLOY_BLOCK
    // in the backend .env (set it on every factory redeploy).
    const deployBlock = config.marketFactoryDeployBlock ? BigInt(config.marketFactoryDeployBlock) : 0n;
    const anchoredSeedFrom = seedFrom < deployBlock ? deployBlock : seedFrom;
    let totals = Array<bigint>(outcomeCount).fill(0n);
    try {
      const results = await this.multicallChunked(
        Array.from({ length: outcomeCount }, (_, o) => ({
          address: this.factory,
          abi: FACTORY_READ_ABI,
          functionName: "outcomeTotals",
          args: [marketId, BigInt(o)],
        })),
        200,
        anchoredSeedFrom
      );
      totals = results.map((r) => unwrap(r, `seedTotals(${marketId})`) as bigint);
    } catch (err) {
      // Historical state read failed (pruned node) — fall back to replaying
      // from the seed block with zeroed totals. Totals may under-count if
      // stakes predate the seed window; points still show correct SHAPE.
      logger.warn("[chaincache] seed totals read failed — replaying from zero", {
        marketId: marketId.toString(),
        error: String(err),
      });
    }
    logger.info("[chaincache] odds cursor seeded", {
      marketId: marketId.toString(),
      fromBlock: anchoredSeedFrom.toString(),
    });
    return { latestBlock: anchoredSeedFrom, totals, outcomeCount, points: [], warming: true };
  }

  private async applyStakeLogs(
    cursor: OddsCursor,
    logs: Array<{ blockNumber: bigint; logIndex: number; args?: { outcome?: bigint; amount?: bigint } }>
  ): Promise<void> {
    const ordered = [...logs].sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber ? -1 : 1
    );
    // One RPC per block that actually had stakes, in chunks of 25.
    const blocks = [...new Set(ordered.map((l) => l.blockNumber))];
    const tsByBlock = new Map<bigint, number>();
    for (let i = 0; i < blocks.length; i += 25) {
      const chunk = blocks.slice(i, i + 25);
      const fetched = await Promise.all(
        chunk.map((b) =>
          withRpcRetry(`odds:getBlock(${b})`, () => publicClient.getBlock({ blockNumber: b }))
        )
      );
      fetched.forEach((blk, k) => tsByBlock.set(chunk[k], Number(blk.timestamp)));
    }
    let currentBlock: bigint | null = null;
    for (const log of ordered) {
      // Defensive: public RPCs occasionally return log entries viem could not
      // decode (args undefined). Counting one would corrupt totals, so skip
      // it — the warmer retries the range on its next pass.
      const args = log.args;
      if (!args) continue;
      const outcome = Number(args.outcome ?? 0);
      const amount = args.amount ?? 0n;
      if (outcome < cursor.totals.length) cursor.totals[outcome] += amount;
      if (log.blockNumber !== currentBlock) {
        currentBlock = log.blockNumber;
        cursor.points.push({
          block: Number(log.blockNumber),
          ts: tsByBlock.get(log.blockNumber) ?? Math.floor(Date.now() / 1000),
          totals: cursor.totals.map((t) => t.toString()),
        });
      } else {
        // Same block as the previous point — update it in place so there is
        // exactly one point per block (cumulative within the block).
        const last = cursor.points[cursor.points.length - 1];
        last.totals = cursor.totals.map((t) => t.toString());
      }
    }
    // Bound memory: decimate oldest points when over the cap.
    while (cursor.points.length > ODDS_MAX_POINTS) {
      cursor.points = cursor.points.filter((_, i) => i % 2 === 0);
    }
  }

  // --- helpers -----------------------------------------------------------------

  /** In-flight coalescing: concurrent callers share one upstream promise. */
  private coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = fn().finally(() => {
      if (this.inflight.get(key) === p) this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  /** Per-market mutex so the warmer and request path never interleave a cursor. */
  private async withOddsLock<T>(id: bigint, fn: () => Promise<T>): Promise<T> {
    const prev = this.oddsLocks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const cur = new Promise<void>((res) => {
      release = res;
    });
    this.oddsLocks.set(id, prev.then(() => cur));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async multicallChunked(
    contracts: FactoryCall[],
    chunkSize = MULTICALL_CHUNK,
    blockNumber?: bigint
  ): Promise<MulticallResult[]> {
    const out: MulticallResult[] = [];
    for (let i = 0; i < contracts.length; i += chunkSize) {
      const chunk = contracts.slice(i, i + chunkSize);
      // The contracts array is well-formed (each functionName has matching
      // args); the cast sidesteps viem's correlated-union generics, which
      // cannot express "union of functionName × matching args" as an array.
      const results = (await withRpcRetry(`chaincache:multicall(chunk ${i / chunkSize})`, () =>
        publicClient.multicall({
          contracts: chunk as unknown as Array<{
            address: `0x${string}`;
            abi: typeof FACTORY_READ_ABI;
            functionName: "marketInfo" | "marketSettlement" | "outcomeTotals";
            args: readonly unknown[];
          }>,
          allowFailure: true,
          ...(blockNumber !== undefined ? { blockNumber } : {}),
        })
      )) as MulticallResult[];
      meter.count("rpc_calls", 1);
      out.push(...results);
    }
    return out;
  }
}

function unwrap(r: MulticallResult, label: string): unknown {
  if (r.status !== "success") throw new Error(`multicall item failed (${label}): ${String(r.error)}`);
  return r.result;
}

/** A read for a market id past marketCount reverts — treat as 404, not 502. */
function looksLikeMissingMarket(err: unknown): boolean {
  const msg = String(err);
  return (
    err instanceof ChainApiError ||
    msg.includes("reverted") ||
    msg.includes("out-of-bounds") ||
    msg.includes("panic")
  );
}

function rpcUnavailableMessage(err: unknown): string {
  if (err instanceof ChainApiError) return err.message;
  return "Live market data is refreshing — please try again in a moment.";
}
