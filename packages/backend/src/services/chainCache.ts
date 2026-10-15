


























import { publicClient, withRpcRetry } from "../lib/rpc.js";
import { runLoop, type LoopHandle } from "../lib/loop.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { meter } from "../lib/net.js";
import { parseAbiItem } from "viem";

const MARKET_STAKED_EVENT = parseAbiItem(
  "event MarketStaked(uint256 indexed marketId, address indexed user, uint256 outcome, uint256 amount)"
);

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

  block: number;

  ts: number;

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

const MARKETS_TTL_MS = 10 * 60_000;
const MARKET_TTL_MS = 10_000;
const MULTICALL_CHUNK = 100;
const LOG_CHUNK_BLOCKS = 900n;

const ODDS_SEED_LOOKBACK_BLOCKS = 500_000n;


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
  private marketsCache: { at: number; value: { markets: MarketSummary[]; asOfBlock: string; refreshedAt: string } } | null = null;
  private readonly marketCache = new Map<string, { at: number; value: MarketSummary }>();
  private readonly dirtyMarketIds = new Map<number, number>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly oddsCursors = new Map<bigint, OddsCursor>();
  private readonly oddsLocks = new Map<bigint, Promise<void>>();
  private readonly oddsLastViewed = new Map<bigint, number>();
  private warmer: LoopHandle | null = null;
  private warmerCursor = 0;

  constructor() {
    this.factory = config.contracts.marketFactory;
  }



  markMarketDirty(id: bigint): void {
    const marketId = Number(id);
    if (!Number.isSafeInteger(marketId) || marketId < 0) return;
    this.dirtyMarketIds.set(marketId, (this.dirtyMarketIds.get(marketId) ?? 0) + 1);
    meter.count("chaincache_market_events");
    this.marketCache.delete(`market:${marketId}`);
  }

  async getMarkets(): Promise<{ markets: MarketSummary[]; asOfBlock: string; refreshedAt: string }> {
    return this.coalesce("markets", async () => {
      const now = Date.now();
      if (this.marketsCache && now - this.marketsCache.at < MARKETS_TTL_MS) {
        if (this.dirtyMarketIds.size === 0) return this.marketsCache.value;
        const pending = [...this.dirtyMarketIds];
        const updates = await Promise.all(pending.map(async ([id]) =>
          this.fetchMarket(BigInt(id))
        ));
        const markets = [...this.marketsCache.value.markets];
        for (let i = 0; i < pending.length; i++) {
          const [id, version] = pending[i];
          markets[id] = updates[i];
          this.marketCache.set(`market:${id}`, { at: now, value: updates[i] });
          if (this.dirtyMarketIds.get(id) === version) this.dirtyMarketIds.delete(id);
        }
        meter.count("chaincache_markets_targeted_refresh", pending.length);
        const value = { ...this.marketsCache.value, markets };
        this.marketsCache = { at: this.marketsCache.at, value };
        return value;
      }
      const pending = [...this.dirtyMarketIds];
      const value = await this.fetchMarkets().catch((err) => {
        throw new ChainApiError("RPC_UNAVAILABLE", rpcUnavailableMessage(err));
      });
      this.marketsCache = { at: now, value };
      for (const [id, version] of pending) {
        if (this.dirtyMarketIds.get(id) === version) this.dirtyMarketIds.delete(id);
      }
      return value;
    }) as Promise<{ markets: MarketSummary[]; asOfBlock: string; refreshedAt: string }>;
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
    this.oddsLastViewed.set(marketId, Date.now());
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


  startWarmer(): void {
    if (this.warmer) return;
    this.warmer = runLoop(
      "chaincache-odds-warmer",
      5 * 60_000,
      async () => {
        const now = Date.now();
        for (const [id, viewedAt] of this.oddsLastViewed) {
          if (now - viewedAt > 24 * 60 * 60_000) this.oddsLastViewed.delete(id);
        }
        const ids = [...this.oddsLastViewed.keys()];
        const n = ids.length;
        if (n === 0) return;
        const perPass = Math.min(2, n);
        for (let k = 0; k < perPass; k++) {
          const id = ids[(this.warmerCursor + k) % n];
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



  private async fetchMarkets(): Promise<{ markets: MarketSummary[]; asOfBlock: string; refreshedAt: string }> {
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
    if (n === 0) return { markets: [], asOfBlock: asOfBlock.toString(), refreshedAt: new Date().toISOString() };
    if (n > 10_000) throw new Error(`marketCount absurdly large: ${n}`);

    const ids = Array.from({ length: n }, (_, i) => BigInt(i));


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
    return { markets, asOfBlock: asOfBlock.toString(), refreshedAt: new Date().toISOString() };
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
          event: MARKET_STAKED_EVENT,
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







  private async seedOddsCursor(marketId: bigint, latest: bigint): Promise<OddsCursor> {
    const market = await this.getMarket(Number(marketId)).catch(() => null);
    if (!market) throw new ChainApiError("NOT_FOUND", `Market #${marketId} does not exist.`);
    const outcomeCount = market.outcomeCount;
    const seedFrom = latest > ODDS_SEED_LOOKBACK_BLOCKS ? latest - ODDS_SEED_LOOKBACK_BLOCKS : 0n;





    const deployBlock = config.social.marketFactoryDeployBlock ? BigInt(config.social.marketFactoryDeployBlock) : 0n;
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


        const last = cursor.points[cursor.points.length - 1];
        last.totals = cursor.totals.map((t) => t.toString());
      }
    }

    while (cursor.points.length > ODDS_MAX_POINTS) {
      cursor.points = cursor.points.filter((_, i) => i % 2 === 0);
    }
  }




  private coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = fn().finally(() => {
      if (this.inflight.get(key) === p) this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }


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
