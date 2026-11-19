/**
 * Stock price target market reader: reads the StockMarketFactory into
 * the SAME response shape the crypto ChainCache serves for the crypto
 * MarketFactory.
 *
 * Intended destination: packages/backend/src/services/stockMarketReader.ts.
 * Mirrors services/chainCache.ts (ChainCache) pattern for pattern,
 * because the frontend market pages consume that shape:
 *   - getMarkets() returns { markets, asOfBlock, refreshedAt }; the list
 *     cache TTL is MARKETS_TTL_MS (10 min) with targeted refresh of
 *     dirty markets only, and getMarket(id) caches per market for
 *     MARKET_TTL_MS (10s). Both TTLs come from stockMarketConfig.cache,
 *     which copies the ChainCache constants verbatim.
 *   - Concurrent identical reads are coalesced through one in-flight
 *     promise map, exactly like ChainCache.coalesce.
 *   - Chain reads are chunked multicalls (100 per chunk, 200 for
 *     outcome totals), BigInts cross the API as strings, and a missing
 *     market surfaces as ChainApiError NOT_FOUND (404), a bad id as
 *     BAD_REQUEST (400), and an RPC failure as RPC_UNAVAILABLE (502),
 *     reusing the ChainApiError class from services/chainCache.ts so
 *     the routes map errors identically.
 *   - RPC reads go through the stock stack's fallback transport
 *     (createStockMarketPublicClient in stockMarketConfig.ts, primary
 *     RPC plus STOCK_RPC_FALLBACK_URLS), never a single-endpoint
 *     client, and every multicall counts on the shared meter.
 *
 * Differences from ChainCache, all deliberate:
 *   - NO odds-history cursor and NO warmer: the crypto odds history is
 *     a MarketStaked log replay for the crypto factory. The stock
 *     factory emits the same event (kept in the ABI below), but no
 *     stock odds-history endpoint is in the locked API contract, so
 *     the cursor machinery is not copied. Add it here, mirroring
 *     ChainCache.advanceOddsCursor, if a stock odds endpoint is ever
 *     specced.
 *   - NO Supabase dirty feed: ChainCache.markMarketDirty is driven by
 *     the crypto SocialIndexer. No stock market indexer exists yet, so
 *     dirty marks come from the stock market keeper (after a resolve
 *     or void it lands) and from TTL expiry. markMarketDirty() is kept
 *     with the same signature so a future indexer can drive it.
 *   - The summary carries the DECODED stock terms (token, symbol,
 *     target, direction, question) alongside the crypto fields. The
 *     crypto summary carries abi-encoded `params` and a templateId
 *     because the crypto factory is multi-template and the frontend
 *     decodes params itself; the stock factory is single-purpose, its
 *     terms are plain struct fields on-chain, and the locked API
 *     contract names the decoded fields (id, question, yes/no totals,
 *     state, deadline, creator, target, direction, stock symbol).
 *     Multipliers are NOT in the shape: the crypto shape does not
 *     carry them either (the frontend computes live multipliers from
 *     outcomeTotals, totalStaked, seedAmount and the fee constants,
 *     see marketOdds in the frontend), so none are added here.
 *
 * FACTORY SURFACE (confirmed against the delivered StockMarketFactory
 * by the coordinator at consolidation; the parallel-build assumptions
 * were aligned to the contract, not the other way round):
 *   - marketInfo(marketId) returns, in order: token (address), symbol
 *     (string), direction (uint8 enum: 0 = Above, 1 = Below),
 *     targetPrice (uint256, scaled 1e8), creator (address),
 *     creatorName (string), createdAt (uint64), bettingCloseTime
 *     (uint64), endTime (uint64), voidAfter (uint64), outcomeCount
 *     (uint8, always 2). The summary's `above` boolean is derived:
 *     above = (direction === 0).
 *   - marketSettlement returns seedAmount, totalStaked, state,
 *     winnerBitmap, payoutPerShare, finalPrice (the submitted NAV,
 *     scaled 1e8, 0 until resolved). outcomeTotals, stakes, claimed
 *     keep the crypto signatures verbatim. Market state enum matches
 *     crypto: 0 Open, 1 Resolved, 2 Voided. Outcomes: 0 = Yes, 1 = No.
 *   - createMarket(token, symbol, direction, targetPrice, deadline,
 *     creatorName) is the confirmed create signature. The backend
 *     never calls it (the frontend creates markets directly), it is
 *     documented here only because marketInfo mirrors its terms.
 *   - resolve(marketId, finalPrice) takes the resolution NAV scaled
 *     1e8, submitted by the keeper (see stockMarketKeeper.ts).
 *   - voidMarket(marketId) is a single-step void for a market whose
 *     resolution NAV never qualified (full refunds via claim). The
 *     crypto factory's two-step optimistic void (initiateVoid /
 *     finalizeVoid) is NOT assumed: the locked keeper spec is a
 *     direct void when no NAV qualifies at all.
 */

import type { PublicClient } from "viem";
import {
  stockMarketConfig,
  createStockMarketPublicClient,
} from "../stockMarketConfig.js";
import { meter } from "../lib/net.js";
import { scaledToPrice } from "../lib/priceMath.js";
import { ChainApiError } from "./chainCache.js";

export const STOCK_MARKET_FACTORY_ABI = [
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
      { name: "token", type: "address" },
      { name: "symbol", type: "string" },
      { name: "direction", type: "uint8" },
      { name: "targetPrice", type: "uint256" },
      { name: "creator", type: "address" },
      { name: "creatorName", type: "string" },
      { name: "createdAt", type: "uint64" },
      { name: "bettingCloseTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "voidAfter", type: "uint64" },
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
      { name: "finalPrice", type: "uint256" },
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
    type: "function",
    name: "stakes",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user", type: "address" },
      { name: "outcome", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "finalPrice", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "voidMarket",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "symbol", type: "string", indexed: false },
      { name: "targetPrice", type: "uint256", indexed: false },
      { name: "above", type: "bool", indexed: false },
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
      { name: "marketId", type: "uint256", indexed: false },
      { name: "winnerBitmap", type: "uint256", indexed: false },
      { name: "payoutPerShare", type: "uint256", indexed: false },
      { name: "resolver", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MarketVoided",
    inputs: [
      { name: "marketId", type: "uint256", indexed: false },
      { name: "voider", type: "address", indexed: false },
    ],
  },
  { type: "error", name: "AlreadySettled", inputs: [{ name: "marketId", type: "uint256" }] },
  { type: "error", name: "NotResolvableYet", inputs: [{ name: "marketId", type: "uint256" }] },
  { type: "error", name: "MarketNotOpen", inputs: [{ name: "marketId", type: "uint256" }] },
  { type: "error", name: "AlreadyClaimed", inputs: [{ name: "marketId", type: "uint256" }, { name: "user", type: "address" }] },
  { type: "error", name: "NothingToClaim", inputs: [{ name: "marketId", type: "uint256" }, { name: "user", type: "address" }] },
] as const;

/**
 * One stock price target market, in the crypto MarketSummary shape
 * plus the decoded stock terms. All amounts are integer strings
 * (TICK wei for stakes, 1e8-scaled for prices), all times are unix
 * seconds, exactly like the crypto shape.
 */
export interface StockMarketSummary {
  id: number;
  /** B20 token contract address (the market's asset identity). */
  token: string;
  /** Alias of token, the field name the frontend summary type uses. */
  tokenAddress: string;
  /** B20 token symbol, e.g. "NVDAc". */
  symbol: string;
  /** Company name from the dynamic stock list, or null when the list
   *  has not loaded or the token is not in it. Display-only. */
  name: string | null;
  /** Logo URL from the dynamic stock list, or null when the list has
   *  no icon for this token (the frontend falls back to the verified
   *  league logos, then a letter avatar). Display-only. */
  iconUrl: string | null;
  creator: string;
  creatorName: string;
  bettingCloseTime: number;
  /** Resolution deadline (unix seconds). The market resolves on the
   *  NAV at this instant. */
  endTime: number;
  /** Alias of endTime, named for the stock API contract. */
  deadline: number;
  /** endTime as an ISO timestamp. */
  deadlineIso: string;
  /** Target price scaled by 1e8 (integer string). */
  targetPrice: string;
  /** Target price as a decimal USD string. */
  targetPriceUsd: string;
  /** Direction: true = the market asks whether the NAV finishes
   *  strictly above the target, false = at or below the target. At
   *  exactly the target, an above market resolves No and a below
   *  market resolves Yes. */
  above: boolean;
  direction: "above" | "below";
  /** Server-rendered question, same wording as the frontend's
   *  price target question helper. */
  question: string;
  /** Alias of question (the crypto board calls this field both). */
  title: string;
  /** 0 Open, 1 Resolved, 2 Voided (crypto MarketState order). */
  state: number;
  winnerBitmap: string;
  payoutPerShare: string;
  seedAmount: string;
  totalStaked: string;
  /** Per-outcome totals: index 0 = Yes, index 1 = No. */
  outcomeTotals: string[];
  /** Alias of outcomeTotals[0]. */
  yesTotal: string;
  /** Alias of outcomeTotals[1]. */
  noTotal: string;
  outcomeCount: number;
}

/** A caller's position in one market. The crypto single-market
 *  endpoint carries no caller info (its routes have no caller
 *  identity), so this is only attached when the caller supplies an
 *  address; see api/stockMarketRoutes.ts. */
export interface StockMarketUserPosition {
  marketId: number;
  user: string;
  /** Per-outcome stakes (TICK wei strings): index 0 = Yes, 1 = No. */
  stakes: string[];
  totalStaked: string;
  claimed: boolean;
}

export interface StockMarketInfoFields {
  token: string;
  symbol: string;
  creator: string;
  creatorName: string;
  bettingCloseTime: bigint;
  endTime: bigint;
  targetPrice: bigint;
  above: boolean;
  outcomeCount: number;
}

export interface StockMarketSettlementFields {
  seedAmount: bigint;
  totalStaked: bigint;
  state: number;
  winnerBitmap: bigint;
  payoutPerShare: bigint;
  /** Resolution NAV scaled 1e8, 0 until the market resolves. */
  finalPrice: bigint;
}

function field<T>(r: Record<string | number, unknown>, name: string, index: number): T {
  return (r[name] ?? r[index]) as T;
}

/** Normalize a viem marketInfo result (named or positional), mirroring
 *  normalizeMarketInfoResult in services/chainCache.ts. createdAt and
 *  voidAfter are dropped, exactly like the crypto normalizer. */
export function normalizeStockMarketInfoResult(raw: unknown): StockMarketInfoFields {
  const r = raw as Record<string | number, unknown>;
  return {
    token: field<string>(r, "token", 0),
    symbol: field<string>(r, "symbol", 1),
    creator: field<string>(r, "creator", 4),
    creatorName: field<string>(r, "creatorName", 5),
    bettingCloseTime: field<bigint>(r, "bettingCloseTime", 7),
    endTime: field<bigint>(r, "endTime", 8),
    targetPrice: field<bigint>(r, "targetPrice", 3),
    above: field<number>(r, "direction", 2) === 0,
    outcomeCount: field<number>(r, "outcomeCount", 10),
  };
}

/** Normalize a viem marketSettlement result, mirroring
 *  normalizeMarketSettlementResult in services/chainCache.ts. */
export function normalizeStockMarketSettlementResult(raw: unknown): StockMarketSettlementFields {
  const r = raw as Record<string | number, unknown>;
  return {
    seedAmount: field<bigint>(r, "seedAmount", 0),
    totalStaked: field<bigint>(r, "totalStaked", 1),
    state: field<number>(r, "state", 2),
    winnerBitmap: field<bigint>(r, "winnerBitmap", 3),
    payoutPerShare: field<bigint>(r, "payoutPerShare", 4),
    finalPrice: field<bigint>(r, "finalPrice", 5),
  };
}

/**
 * The question for one market, worded like the frontend's
 * stockPriceTargetQuestion helper ("Will NVDA be above $150 by
 * ...?"), with the deadline as an ISO timestamp so the string is
 * timezone-free and stable to test. The wording is "above" and
 * "below", matching the stock tie rule: above is strict, and at
 * exactly the target a below market wins.
 */
export function buildStockTargetQuestion(
  symbol: string,
  targetPriceUsd: string,
  above: boolean,
  endTimeSec: number
): string {
  const deadlineIso = new Date(endTimeSec * 1000).toISOString();
  return `Will ${symbol} be ${above ? "above" : "below"} $${targetPriceUsd} by ${deadlineIso}?`;
}

const MULTICALL_CHUNK = 100;

type MulticallResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

type FactoryCall = {
  address: `0x${string}`;
  abi: typeof STOCK_MARKET_FACTORY_ABI;
  functionName: "marketInfo" | "marketSettlement" | "outcomeTotals";
  args: readonly [bigint] | readonly [bigint, bigint];
};

export interface StockMarketReaderOpts {
  factory?: `0x${string}`;
  publicClient?: PublicClient;
  /** Display-name lookup by token address (wired to the stock list
   *  service in index.ts). Optional: names are display-only. */
  nameLookup?: (tokenAddress: string) => string | null;
  /** Logo lookup by token address (wired to the stock list service
   *  in index.ts). Optional: logos are display-only. */
  iconLookup?: (tokenAddress: string) => string | null;
}

export class StockMarketReader {
  private readonly factory: `0x${string}`;
  private readonly publicClient: PublicClient;
  private readonly nameLookup: ((tokenAddress: string) => string | null) | undefined;
  private readonly iconLookup: ((tokenAddress: string) => string | null) | undefined;
  private marketsCache: { at: number; value: { markets: StockMarketSummary[]; asOfBlock: string; refreshedAt: string } } | null = null;
  private readonly marketCache = new Map<string, { at: number; value: StockMarketSummary }>();
  private readonly dirtyMarketIds = new Map<number, number>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(opts: StockMarketReaderOpts = {}) {
    this.factory = opts.factory ?? stockMarketConfig.factoryAddress;
    this.publicClient = opts.publicClient ?? createStockMarketPublicClient();
    this.nameLookup = opts.nameLookup;
    this.iconLookup = opts.iconLookup;
  }

  get factoryAddress(): `0x${string}` {
    return this.factory;
  }

  get client(): PublicClient {
    return this.publicClient;
  }

  /** Same signature and semantics as ChainCache.markMarketDirty: the
   *  next list read refreshes only this market, and its single-market
   *  cache entry is dropped immediately. */
  markMarketDirty(id: bigint): void {
    const marketId = Number(id);
    if (!Number.isSafeInteger(marketId) || marketId < 0) return;
    this.dirtyMarketIds.set(marketId, (this.dirtyMarketIds.get(marketId) ?? 0) + 1);
    meter.count("stockmarkets_market_events");
    this.marketCache.delete(`market:${marketId}`);
  }

  async getMarkets(): Promise<{ markets: StockMarketSummary[]; asOfBlock: string; refreshedAt: string }> {
    return this.coalesce("markets", async () => {
      const now = Date.now();
      if (this.marketsCache && now - this.marketsCache.at < stockMarketConfig.cache.marketsTtlMs) {
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
        meter.count("stockmarkets_targeted_refresh", pending.length);
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
    }) as Promise<{ markets: StockMarketSummary[]; asOfBlock: string; refreshedAt: string }>;
  }

  async getMarket(id: number): Promise<StockMarketSummary> {
    if (!Number.isInteger(id) || id < 0) {
      throw new ChainApiError("BAD_REQUEST", "Market id must be a non-negative integer.");
    }
    const key = `market:${id}`;
    return this.coalesce(key, async () => {
      const now = Date.now();
      const cached = this.marketCache.get(key);
      if (cached && now - cached.at < stockMarketConfig.cache.marketTtlMs) return cached.value;
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
    }) as Promise<StockMarketSummary>;
  }

  /** One user's stakes and claim flag for one market (3 reads in one
   *  multicall). Not cached: positions are per-caller and change with
   *  every stake. */
  async getUserPosition(id: number, user: `0x${string}`): Promise<StockMarketUserPosition> {
    if (!Number.isInteger(id) || id < 0) {
      throw new ChainApiError("BAD_REQUEST", "Market id must be a non-negative integer.");
    }
    const marketId = BigInt(id);
    let results: MulticallResult[];
    try {
      results = (await this.publicClient.multicall({
        contracts: [
          { address: this.factory, abi: STOCK_MARKET_FACTORY_ABI, functionName: "stakes", args: [marketId, user, 0n] },
          { address: this.factory, abi: STOCK_MARKET_FACTORY_ABI, functionName: "stakes", args: [marketId, user, 1n] },
          { address: this.factory, abi: STOCK_MARKET_FACTORY_ABI, functionName: "claimed", args: [marketId, user] },
        ],
        allowFailure: true,
      })) as unknown as MulticallResult[];
    } catch (err) {
      throw new ChainApiError("RPC_UNAVAILABLE", rpcUnavailableMessage(err));
    }
    meter.count("rpc_calls", 1);
    const yes = unwrap(results[0], `stakes(${id},0)`) as bigint;
    const no = unwrap(results[1], `stakes(${id},1)`) as bigint;
    const claimed = unwrap(results[2], `claimed(${id})`) as boolean;
    return {
      marketId: id,
      user,
      stakes: [yes.toString(), no.toString()],
      totalStaked: (yes + no).toString(),
      claimed,
    };
  }

  private async fetchMarkets(): Promise<{ markets: StockMarketSummary[]; asOfBlock: string; refreshedAt: string }> {
    const [count, asOfBlock] = await Promise.all([
      this.publicClient.readContract({
        address: this.factory,
        abi: STOCK_MARKET_FACTORY_ABI,
        functionName: "marketCount",
      }),
      this.publicClient.getBlockNumber(),
    ]);
    const n = Number(count);
    if (n === 0) return { markets: [], asOfBlock: asOfBlock.toString(), refreshedAt: new Date().toISOString() };
    if (n > 10_000) throw new Error(`stock marketCount absurdly large: ${n}`);

    const ids = Array.from({ length: n }, (_, i) => BigInt(i));

    const infoResults = await this.multicallChunked(
      ids.map((id) => ({
        address: this.factory,
        abi: STOCK_MARKET_FACTORY_ABI,
        functionName: "marketInfo",
        args: [id] as readonly [bigint],
      }))
    );
    const settlementResults = await this.multicallChunked(
      ids.map((id) => ({
        address: this.factory,
        abi: STOCK_MARKET_FACTORY_ABI,
        functionName: "marketSettlement",
        args: [id] as readonly [bigint],
      }))
    );

    const totalPairs: Array<{ marketIdx: number; outcome: bigint }> = [];
    const outcomeCounts: number[] = [];
    const pairOffset: number[] = [];
    let pairAcc = 0;
    infoResults.forEach((r, i) => {
      const info = normalizeStockMarketInfoResult(unwrap(r, `marketInfo(${ids[i]})`));
      const c = Number(info.outcomeCount);
      outcomeCounts.push(c);
      pairOffset.push(pairAcc);
      pairAcc += c;
      for (let o = 0; o < c; o++) totalPairs.push({ marketIdx: i, outcome: BigInt(o) });
    });
    const totalsResults = await this.multicallChunked(
      totalPairs.map((p) => ({
        address: this.factory,
        abi: STOCK_MARKET_FACTORY_ABI,
        functionName: "outcomeTotals",
        args: [ids[p.marketIdx], p.outcome] as readonly [bigint, bigint],
      })),
      200
    );

    const markets: StockMarketSummary[] = ids.map((id, i) => {
      const info = normalizeStockMarketInfoResult(unwrap(infoResults[i], `marketInfo(${id})`));
      const settlement = normalizeStockMarketSettlementResult(
        unwrap(settlementResults[i], `marketSettlement(${id})`)
      );
      const start = pairOffset[i];
      const outcomeTotals: string[] = [];
      for (let k = 0; k < outcomeCounts[i]; k++) {
        outcomeTotals.push(
          (unwrap(totalsResults[start + k], `outcomeTotals(${id},${k})`) as bigint).toString()
        );
      }
      return this.toSummary(Number(id), info, settlement, outcomeTotals);
    });

    meter.count("stockmarkets_refresh", 1);
    return { markets, asOfBlock: asOfBlock.toString(), refreshedAt: new Date().toISOString() };
  }

  private async fetchMarket(id: bigint): Promise<StockMarketSummary> {
    const [infoRaw, settlementRaw] = (await this.publicClient.multicall({
      contracts: [
        { address: this.factory, abi: STOCK_MARKET_FACTORY_ABI, functionName: "marketInfo", args: [id] },
        { address: this.factory, abi: STOCK_MARKET_FACTORY_ABI, functionName: "marketSettlement", args: [id] },
      ],
      allowFailure: false,
    }).catch((err) => {
      throw looksLikeMissingMarket(err)
        ? new ChainApiError("NOT_FOUND", `Stock market #${id} does not exist.`)
        : err;
    })) as unknown as [unknown, unknown];
    const info = normalizeStockMarketInfoResult(infoRaw);
    const settlement = normalizeStockMarketSettlementResult(settlementRaw);
    const outcomeCount = Number(info.outcomeCount);
    const totals = await this.multicallChunked(
      Array.from({ length: outcomeCount }, (_, o) => ({
        address: this.factory,
        abi: STOCK_MARKET_FACTORY_ABI,
        functionName: "outcomeTotals",
        args: [id, BigInt(o)] as readonly [bigint, bigint],
      })),
      200
    );
    return this.toSummary(
      Number(id),
      info,
      settlement,
      totals.map((r) => (unwrap(r, `outcomeTotals(${id})`) as bigint).toString())
    );
  }

  private toSummary(
    id: number,
    info: StockMarketInfoFields,
    settlement: StockMarketSettlementFields,
    outcomeTotals: string[]
  ): StockMarketSummary {
    const endTime = Number(info.endTime);
    const targetPriceUsd = scaledToPrice(info.targetPrice);
    const question = buildStockTargetQuestion(info.symbol, targetPriceUsd, info.above, endTime);
    return {
      id,
      token: info.token,
      tokenAddress: info.token,
      symbol: info.symbol,
      name: this.nameLookup ? this.nameLookup(info.token) : null,
      iconUrl: this.iconLookup ? this.iconLookup(info.token) : null,
      creator: info.creator,
      creatorName: info.creatorName,
      bettingCloseTime: Number(info.bettingCloseTime),
      endTime,
      deadline: endTime,
      deadlineIso: new Date(endTime * 1000).toISOString(),
      targetPrice: info.targetPrice.toString(),
      targetPriceUsd,
      above: info.above,
      direction: info.above ? "above" : "below",
      question,
      title: question,
      state: Number(settlement.state),
      winnerBitmap: settlement.winnerBitmap.toString(),
      payoutPerShare: settlement.payoutPerShare.toString(),
      seedAmount: settlement.seedAmount.toString(),
      totalStaked: settlement.totalStaked.toString(),
      outcomeTotals,
      yesTotal: outcomeTotals[0] ?? "0",
      noTotal: outcomeTotals[1] ?? "0",
      outcomeCount: Number(info.outcomeCount),
    };
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

  private async multicallChunked(
    contracts: FactoryCall[],
    chunkSize = MULTICALL_CHUNK
  ): Promise<MulticallResult[]> {
    const out: MulticallResult[] = [];
    for (let i = 0; i < contracts.length; i += chunkSize) {
      const chunk = contracts.slice(i, i + chunkSize);
      const results = (await this.publicClient.multicall({
        contracts: chunk as unknown as Array<{
          address: `0x${string}`;
          abi: typeof STOCK_MARKET_FACTORY_ABI;
          functionName: "marketInfo" | "marketSettlement" | "outcomeTotals";
          args: readonly unknown[];
        }>,
        allowFailure: true,
      })) as unknown as MulticallResult[];
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
  return "Live market data is refreshing, please try again in a moment.";
}
