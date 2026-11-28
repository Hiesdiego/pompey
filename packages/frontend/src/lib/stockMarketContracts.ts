/**
 * Stock Price Target Markets, factory config, ABI, API client and helpers.
 *
 * Target location in the repo:
 *   packages/frontend/src/lib/stockMarketContracts.ts
 *
 * This is a NEW lib file. It does not touch lib/stockContracts.ts (the stock
 * league stack) and it does not modify lib/marketFactory.ts (the crypto
 * factory). The stock price-target factory is a separate deployment whose
 * address comes from NEXT_PUBLIC_STOCK_MARKET_FACTORY_ADDRESS.
 *
 * Product shape (locked spec, step 2 of the STOCK BUILD):
 *   "Will [STOCK] be above or below $X by [date]?" Yes/No, anyone can
 *   create, TICKR seeds featured boards, parimutuel, fees 3% treasury /
 *   2% creator / 1% resolver, same treasury rule as crypto (if nobody
 *   staked on the winning side the whole pool goes to treasury), live
 *   multipliers on the card. The stock list is DYNAMIC: every B20
 *   tokenized stock on Base can be listed, not a fixed roster. Market
 *   creation requires a live NAV at creation so the market can resolve.
 *   Resolution is the Chainlink NAV at the deadline, with the last-NAV
 *   24h fallback, else void and refund.
 *
 * Routing: crypto markets use bare ids plus the "v-" and "n-" prefixes
 * (see marketFromRoute in lib/marketFactory.ts). Stock markets use the
 * "s-" prefix, for example /markets/s-3. A bare numeric id always means
 * a crypto market, so the two factories can never collide even when
 * both have a market #3. The /markets board links stock cards with
 * stockMarketRouteKey and the detail page branches on
 * isStockMarketRoute before it touches either data source.
 *
 * ABI assumptions (flagged for the parent agent and the backend builder):
 *   1. The StockMarketFactory ABI below is derived from MARKET_FACTORY_ABI
 *      in lib/marketFactory.ts. stake, resolve, initiateVoid,
 *      finalizeVoid, claim, outcomeTotals, stakes, claimed,
 *      marketSettlement, marketCount, the fee getters and the void
 *      lifecycle are copied unchanged, because the spec says the stock
 *      factory mirrors the crypto factory's create/stake/claim shapes.
 *   2. createMarket is the one deliberate difference from the crypto
 *      factory. Confirmed against the delivered StockMarketFactory at
 *      consolidation: it takes (tokenAddress, symbol, direction,
 *      targetPriceScaled1e8, deadline, creatorName). "direction" is
 *      the uint8 StockDirection enum (0 = Above, 1 = Below); the UI
 *      works with the `above` boolean everywhere else and converts
 *      with directionFromAbove / aboveFromDirection below.
 *   3. creatorName is the sixth create argument, mirroring the crypto
 *      factory. The create page sends the profile username, exactly
 *      like crypto creation, and marketInfo returns it.
 *   4. marketInfo returns the stock terms explicitly, in contract
 *      order: token, symbol, direction, targetPrice, creator,
 *      creatorName, createdAt, bettingCloseTime, endTime, voidAfter,
 *      outcomeCount, instead of an opaque params blob, because there
 *      is only one template. The API summaries in this file carry
 *      the same fields, so the UI never has to decode params for stock
 *      markets. bettingCloseTime is assumed to equal the deadline minus
 *      the factory's close buffer, exactly as the backend summary
 *      reports it; the UI trusts the summary and never recomputes it.
 *   5. The creation seed is the same 250 TICK as crypto
 *      (CREATION_SEED_TICK). Creation approves the seed to the stock
 *      factory and the factory pulls it in createMarket, the same
 *      approve-then-create sponsored flow as crypto creation.
 *   6. Resolution and voiding differ from crypto by design. The stock
 *      factory's resolve takes (marketId, finalPrice) and is callable
 *      only by the authorized resolver, because the NAV lives off
 *      chain; the resolve entry below carries both inputs. There is
 *      NO two-step void: voidMarket(marketId) is single-step, by the
 *      resolver or the owner. The initiateVoid, finalizeVoid and
 *      voidInitiatedAt entries below are inert for the stock factory
 *      (kept so the shared detail page compiles against one ABI
 *      shape); the detail page gates the resolve and void actions
 *      off for stock markets.
 *
 * Prices: NAV and target prices are scaled by 1e8 (PRICE_SCALE), the
 * same scale the StockPriceOracle and the crypto TARGET template use.
 * All timestamps are UTC. Deadline cap is MAX_TARGET_TIME
 * (Dec 31, 2026, 23:59:59 UTC), the same cap the crypto create page
 * enforces.
 *
 * Never import from the @tickr/shared barrel. Direct module paths only.
 */

import { priceTargetDeadline } from "./priceTargetQuestion";
import type { Address } from "viem";
import { BACKEND_API_URL } from "./contracts";
import { STOCK_TEAMS } from "./stockTeams";

// ── factory address ─────────────────────────────────────────────────

function envAddress(value: string | undefined): Address | "" {
  const v = (value ?? "").trim();
  return v === "" ? "" : (v as Address);
}

/** StockMarketFactory address. "" = not configured yet (fill after deploy). */
export const STOCK_MARKET_FACTORY_ADDRESS = envAddress(
  process.env.NEXT_PUBLIC_STOCK_MARKET_FACTORY_ADDRESS
) as Address;

// ── routing ─────────────────────────────────────────────────────────

/** Route prefix for stock markets: /markets/s-3. Crypto uses "", "v-", "n-". */
export const STOCK_MARKET_ROUTE_PREFIX = "s-";

export function stockMarketRouteKey(id: number | bigint): string {
  return `${STOCK_MARKET_ROUTE_PREFIX}${id.toString()}`;
}

/** True when a /markets/[id] route key belongs to the stock factory. */
export function isStockMarketRoute(key: string): boolean {
  return key.startsWith(STOCK_MARKET_ROUTE_PREFIX) && /^(0|[1-9]\d*)$/.test(key.slice(STOCK_MARKET_ROUTE_PREFIX.length));
}

/** Parse a stock route key. Returns null for crypto keys and junk. */
export function stockMarketFromRoute(key: string): { id: bigint; factory: Address } | null {
  if (!isStockMarketRoute(key)) return null;
  if (!STOCK_MARKET_FACTORY_ADDRESS) return null;
  return { id: BigInt(key.slice(STOCK_MARKET_ROUTE_PREFIX.length)), factory: STOCK_MARKET_FACTORY_ADDRESS };
}

// ── constants (mirror the crypto factory) ───────────────────────────

/** Creation seed in whole TICK. Same 250 TICK seed as crypto creation. */
export const STOCK_CREATION_SEED_TICK = 250;
/** Minimum stake on stock markets. Mirrors FACTORY_MIN_STAKE_TICK. */
export const STOCK_FACTORY_MIN_STAKE_TICK = 10;
/** Optimistic void challenge window. Mirrors VOID_CHALLENGE_WINDOW_SECONDS. */
export const STOCK_VOID_CHALLENGE_WINDOW_SECONDS = 2 * 24 * 3600;
/** NAV and target price scale: 1 USD = 1e8. Same as StockPriceOracle. */
export const STOCK_PRICE_SCALE = 100_000_000;
/** Latest allowed deadline: Dec 31, 2026, 23:59:59 UTC. */
export const MAX_TARGET_TIME = 1_798_761_599;

/**
 * Direction for a stock price target. `above: true` means Yes wins
 * when the NAV at the deadline is strictly above the target;
 * `above: false` (a below market) means Yes wins when the NAV is at
 * or below the target. At exactly the target, an above market
 * resolves No and a below market resolves Yes. The numeric enum is
 * the encoding the factory takes (StockDirection in the contract).
 */
export const STOCK_DIRECTION = {
  ABOVE: 0,
  BELOW: 1,
} as const;
export type StockDirection = (typeof STOCK_DIRECTION)[keyof typeof STOCK_DIRECTION];

export function directionFromAbove(above: boolean): StockDirection {
  return above ? STOCK_DIRECTION.ABOVE : STOCK_DIRECTION.BELOW;
}

export function aboveFromDirection(direction: StockDirection): boolean {
  return direction === STOCK_DIRECTION.ABOVE;
}

// ── price scale helpers ─────────────────────────────────────────────

/** Scale a USD price typed by the user into the 1e8 integer the factory takes. */
export function scaleTargetPrice(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error("Enter a target price above 0");
  return BigInt(Math.round(usd * STOCK_PRICE_SCALE));
}

/** Unscale a 1e8 integer (bigint, string or number) back to a USD number. */
export function unscaleTargetPrice(scaled: bigint | string | number): number {
  return Number(scaled) / STOCK_PRICE_SCALE;
}

/** "$150.00" style label for a scaled target, matching formatPriceTargetUsd. */
export function formatStockTargetUsd(scaled: bigint | string | number): string {
  return `$${unscaleTargetPrice(scaled).toLocaleString("en-US", { maximumFractionDigits: 8 })}`;
}

/** Parse a NAV price from the list API, which may send a string or a number. */
export function parseNavPrice(navPrice: string | number | null | undefined): number | null {
  if (navPrice === null || navPrice === undefined || navPrice === "") return null;
  const n = typeof navPrice === "number" ? navPrice : Number(navPrice);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── question formatter ──────────────────────────────────────────────

/**
 * The card and detail question, verbatim shape from the locked spec:
 * "Will NVDA finish at or below $150 at the end of 2026 (UTC)?" The date is the deadline
 * formatted in UTC via lib/utcTime. The symbol is the display symbol
 * (see stockDisplaySymbol), never the raw contract symbol with a "c"
 * suffix.
 */
export function stockPriceTargetQuestion(
  symbol: string,
  targetPriceScaled: bigint | string | number,
  above: boolean,
  deadline: Date | number
): string {
  const date = deadline instanceof Date ? deadline : new Date(deadline);
  return `Will ${symbol} finish ${above ? "above" : "at or below"} ${formatStockTargetUsd(targetPriceScaled)} ${priceTargetDeadline(date)}?`;
}

// ── symbols and logos ───────────────────────────────────────────────

/**
 * Display symbol for a stock. The league roster uses Coinbase tokenized
 * symbols with a trailing "c" (NVDAc); the dynamic list and the factory
 * use the plain ticker (NVDA). Display always uses the plain ticker.
 */
export function stockDisplaySymbol(symbol: string): string {
  const league = leagueStockForSymbol(symbol);
  if (league) return league.symbol.replace(/c$/i, "");
  return symbol.trim().toUpperCase();
}

/**
 * Find the league roster entry for any spelling of a symbol, if one
 * exists. Case-insensitive, and tolerant of the roster's trailing "c":
 * "NVDA", "NVDAc" and "nvdac" all find the NVIDIA entry.
 */
export function leagueStockForSymbol(symbol: string) {
  const s = symbol.trim().toUpperCase();
  return STOCK_TEAMS.find((t) => {
    const ts = t.symbol.toUpperCase();
    return ts === s || ts === `${s}C` || (ts.endsWith("C") && ts.slice(0, -1) === s);
  });
}

/**
 * Logo source order (locked spec):
 *   1. the verified remote logo in stockTeams.ts for the 12 league stocks
 *   2. the iconUrl from the dynamic list API (a metadata.coinbase.com PNG)
 *   3. null, so the caller renders the letter avatar, never a broken image
 * This helper only picks the first URL. The StockLogo component walks the
 * same order again on error, so a dead league logo still falls through
 * to the API icon and then to the letter avatar.
 */
export function resolveStockLogo(symbol: string, iconUrl?: string | null): string | null {
  const league = leagueStockForSymbol(symbol);
  if (league?.logoPath) return league.logoPath;
  return iconUrl?.trim() ? iconUrl.trim() : null;
}

/** Every logo URL to try, in order, before the letter avatar. */
export function stockLogoCandidates(symbol: string, iconUrl?: string | null): string[] {
  const out: string[] = [];
  const league = leagueStockForSymbol(symbol);
  if (league?.logoPath) out.push(league.logoPath);
  if (iconUrl?.trim() && !out.includes(iconUrl.trim())) out.push(iconUrl.trim());
  return out;
}

// ── backend API types (fixed contract, build against it) ────────────

/** One row from GET /api/stocks/list. */
export interface StockListItem {
  symbol: string;
  name: string;
  contractAddress: string;
  decimals: number;
  multiplier: number;
  iconUrl: string | null;
  navPrice: string | number | null;
  navUpdatedAt: string | null;
  hasNav: boolean;
}

/**
 * One stock market summary. Mirrors the crypto MarketSummary in
 * lib/chainDirect.ts field for field (bigints arrive as strings), plus
 * the stock terms the crypto summary carries inside params: token,
 * symbol, name, iconUrl, targetPrice and above. `deadline` is the same
 * instant as `endTime`, named the way the stock spec names it.
 */
export interface StockMarketSummary {
  id: number;
  marketKey?: string;
  factoryAddress?: Address;
  creator: string;
  creatorName: string;
  bettingCloseTime: number;
  endTime: number;
  state: number; // 0 Open | 1 Resolved | 2 Voided
  winnerBitmap: string;
  payoutPerShare: string;
  seedAmount: string;
  totalStaked: string;
  outcomeTotals: string[];
  outcomeCount: number;
  tokenAddress: string;
  symbol: string;
  name: string;
  iconUrl: string | null;
  /** Target price scaled by 1e8, as a decimal string. */
  targetPrice: string;
  /** true = above market, false = below market. */
  above: boolean;
  /** Deadline in unix seconds. Same instant as endTime. */
  deadline: number;
  voidAfter?: string;
  voidInitiatedAt?: string;
}

/** Detail shape: the summary plus nothing extra today, kept distinct so the detail page can grow without touching the board. */
export type StockMarketDetail = StockMarketSummary;

// ── backend API client ──────────────────────────────────────────────

export class StockMarketApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function stockMarketGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_API_URL}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new StockMarketApiError(
      0,
      process.env.NODE_ENV === "production"
        ? timedOut ? "This request took too long. Please try again." : "Stock markets are temporarily unavailable. Please try again."
        : timedOut ? "Stock markets request timed out." : "Stock markets are temporarily unavailable."
    );
  }
  if (!res.ok) {
    if (process.env.NODE_ENV === "production") {
      throw new StockMarketApiError(res.status, "Stock markets are temporarily unavailable. Please try again.");
    }
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) detail = String(body.error);
      else if (body?.message) detail = String(body.message);
    } catch {
      /* ignore */
    }
    throw new StockMarketApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

function unwrapStockMarketEnvelope(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "data" in value) {
    return (value as { data?: unknown }).data ?? value;
  }
  return value;
}

function normalizeStockMarket(raw: StockMarketSummary): StockMarketSummary {
  return {
    ...raw,
    marketKey: raw.marketKey ?? stockMarketRouteKey(raw.id),
    factoryAddress: (raw.factoryAddress ?? STOCK_MARKET_FACTORY_ADDRESS) as Address,
    outcomeCount: raw.outcomeCount ?? 2,
    deadline: raw.deadline ?? raw.endTime,
  };
}

/**
 * Stock markets API. Endpoints are fixed by the backend contract:
 *   GET /api/stocks/list          -> { stocks: StockListItem[] }
 *   GET /api/stocks/markets       -> mirrors GET /api/chain/markets
 *   GET /api/stocks/markets/:id   -> mirrors GET /api/chain/markets/:id
 * The API client accepts the standard { ok, data } response envelope,
 * the inner { markets } / { market } shape, and bare arrays/objects.
 */
export const stockMarketApi = {
  list: async (): Promise<StockListItem[]> => {
    const response = await stockMarketGet<unknown>("/api/stocks/list");
    const data = unwrapStockMarketEnvelope(response) as { stocks?: StockListItem[] } | StockListItem[];
    return Array.isArray(data) ? data : data.stocks ?? [];
  },
  markets: async (): Promise<StockMarketSummary[]> => {
    const response = await stockMarketGet<unknown>("/api/stocks/markets");
    const data = unwrapStockMarketEnvelope(response) as { markets?: StockMarketSummary[] } | StockMarketSummary[];
    const list = Array.isArray(data) ? data : data.markets ?? [];
    return list.map(normalizeStockMarket);
  },
  market: async (id: string | number | bigint): Promise<StockMarketDetail> => {
    const response = await stockMarketGet<unknown>(`/api/stocks/markets/${id.toString()}`);
    const data = unwrapStockMarketEnvelope(response) as { market: StockMarketSummary } | StockMarketSummary;
    const market = "market" in data ? data.market : data;
    return normalizeStockMarket(market);
  },
};

// ── StockMarketFactory ABI ──────────────────────────────────────────

/**
 * Minimal ABI, only what the frontend calls. Derived from
 * MARKET_FACTORY_ABI with the create signature from the locked spec.
 * See the header for the three flagged assumptions.
 */
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
    name: "createMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "symbol", type: "string" },
      { name: "direction", type: "uint8" },
      { name: "targetPrice", type: "uint256" },
      { name: "deadline", type: "uint64" },
      { name: "creatorName", type: "string" },
    ],
    outputs: [{ name: "marketId", type: "uint256" }],
  },
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcome", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
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
    name: "initiateVoid",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeVoid",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "voidInitiatedAt",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "VOID_CHALLENGE_WINDOW",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
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
    name: "CREATION_SEED",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "treasuryFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "creatorFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "resolverFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  { type: "error", name: "InvalidParams", inputs: [] },
  { type: "error", name: "BettingClosed", inputs: [{ name: "marketId", type: "uint256" }] },
  { type: "error", name: "NotResolvableYet", inputs: [{ name: "marketId", type: "uint256" }] },
  { type: "error", name: "NotVoidable", inputs: [{ name: "marketId", type: "uint256" }] },
  { type: "error", name: "VoidAlreadyInitiated", inputs: [{ name: "marketId", type: "uint256" }] },
  {
    type: "error",
    name: "ChallengePending",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "finalizeAfter", type: "uint64" },
    ],
  },
  { type: "error", name: "AlreadySettled", inputs: [{ name: "marketId", type: "uint256" }] },
  {
    type: "error",
    name: "NothingToClaim",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user", type: "address" },
    ],
  },
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
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
  {
    type: "event",
    name: "VoidInitiated",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "initiator", type: "address", indexed: false },
      { name: "finalizeAfter", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VoidCancelled",
    inputs: [{ name: "marketId", type: "uint256", indexed: true }],
  },
] as const;

/** Normalized on-chain marketInfo, tolerant of tuple or named returns. */
export interface StockMarketInfoResult {
  token: string;
  symbol: string;
  creator: string;
  creatorName: string;
  createdAt: bigint;
  bettingCloseTime: bigint;
  endTime: bigint;
  voidAfter: bigint;
  targetPrice: bigint;
  above: boolean;
  outcomeCount: number;
}

export function normalizeStockMarketInfo(raw: unknown): StockMarketInfoResult {
  const result = raw as Partial<StockMarketInfoResult> & readonly unknown[];
  return {
    token: (result.token ?? result[0] ?? "") as string,
    symbol: (result.symbol ?? result[1] ?? "") as string,
    creator: (result.creator ?? result[4] ?? "") as string,
    creatorName: (result.creatorName ?? result[5] ?? "") as string,
    createdAt: (result.createdAt ?? result[6]) as bigint,
    bettingCloseTime: (result.bettingCloseTime ?? result[7]) as bigint,
    endTime: (result.endTime ?? result[8]) as bigint,
    voidAfter: (result.voidAfter ?? result[9]) as bigint,
    targetPrice: (result.targetPrice ?? result[3]) as bigint,
    above: aboveFromDirection(
      ((result as { direction?: number }).direction ?? result[2] ?? 0) as StockDirection
    ),
    outcomeCount: (result.outcomeCount ?? result[10]) as number,
  };
}

export type StockMarketState = 0 | 1 | 2; // Open | Resolved | Voided
export const STOCK_MARKET_STATE_NAMES: Record<number, string> = {
  0: "Open",
  1: "Resolved",
  2: "Voided",
};
