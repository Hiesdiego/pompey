/**
 * Arena clash reader: reads the MemeClashFactory into the arena API
 * shape.
 *
 * Intended destination: packages/backend/src/services/arenaClashReader.ts.
 * Mirrors services/stockMarketReader.ts pattern for pattern:
 *   - getClashes() returns { clashes, asOfBlock, refreshedAt }; the
 *     list cache TTL is 10 min with targeted refresh of dirty clashes
 *     only, and getClash(id) caches per clash for 10s. Both TTLs come
 *     from arenaConfig.cache, which copies the stock market constants
 *     verbatim (which copy services/chainCache.ts).
 *   - Concurrent identical reads are coalesced through one in-flight
 *     promise map, exactly like the stock reader.
 *   - Chain reads are chunked multicalls (100 per chunk, 200 for
 *     outcome totals), BigInts cross the API as strings, and a missing
 *     clash surfaces as ChainApiError NOT_FOUND (404), a bad id as
 *     BAD_REQUEST (400), and an RPC failure as RPC_UNAVAILABLE (502),
 *     reusing the ChainApiError class from services/chainCache.ts so
 *     the routes map errors identically.
 *   - RPC reads go through the stock stack's fallback transport
 *     (createArenaPublicClient in arenaConfig.ts), never a
 *     single-endpoint client, and every multicall counts on the
 *     shared meter.
 *
 * FACTORY SURFACE (VERIFIED against the delivered
 * MemeClashFactory.sol and MemeClashConstants.sol in
 * ../contracts/, 2026-11-20: every function, event and error in the
 * ABI below matches the contract, and the constants agree: fees
 * 300/200/100 bps, CREATION_SEED 250 TICK pulled from the creator via
 * transferFrom on createClash, MIN_STAKE 10 TICK, WINDOW_LEAD 1h,
 * STANDARD_WINDOW 24h, BLITZ_WINDOW 1h, SPIKE_BREAKER_MOVE
 * 30,000,000 micro-percent (30 percent), ClashState 0 Open /
 * 1 Resolved / 2 Voided, OpponentKind 0 Stock / 1 Meme. Two names
 * differ from the parallel-build spec and the ABI follows the
 * CONTRACT: the cup-tie revert is CupTieRequiresExplicitWinner, and
 * the staking-close revert is BettingClosed. ClashVoided carries a
 * reason string. The factory also enforces DuplicateOpenClash for
 * non-cup clashes, which the keeper's debut loop mirrors off-chain
 * and can also read through the activeClash view in the ABI):
 *   - createClash(memeToken, memeSymbol, opponentKind, opponentToken,
 *     opponentSymbol, windowDuration, cupTie, creatorName) returns
 *     clashId. opponentKind: 0 = Stock, 1 = Meme. windowStart is
 *     creation + 1h; windowEnd is start + duration (3600 blitz or
 *     86400 standard). stake(clashId, outcome, amount): outcome 0 =
 *     YES (the meme outperforms), 1 = NO; staking closes at
 *     windowStart.
 *   - clashInfo(clashId) returns, in order: memeToken, memeSymbol,
 *     opponentKind, opponentToken, opponentSymbol, creator,
 *     creatorName, createdAt, windowStart, windowEnd, cupTie,
 *     outcomeCount.
 *   - clashSettlement(clashId) returns, in order: seedAmount,
 *     totalStaked, state, winnerBitmap, payoutPerShare, memeStartPrice,
 *     memeEndPrice, oppStartPrice, oppEndPrice. Prices are 1e8-scaled,
 *     0 until recorded. State enum matches the market factories:
 *     0 Open, 1 Resolved, 2 Voided.
 *   - resolve(clashId, memeStartPrice, memeEndPrice, oppStartPrice,
 *     oppEndPrice) is resolver-only; the factory computes micro-percent
 *     moves, voids at |move| >= 30 percent (the breaker), strict
 *     greater wins, an exact tie is NO for open clashes and REVERTS
 *     for cup ties (resolveCupTie takes the same prices plus a
 *     memeWins flag). voidClash and claim complete the surface.
 *
 * WHAT THE CHAIN DOES NOT KNOW comes from injected lookups, exactly
 * like the stock reader's nameLookup/iconLookup:
 *   - Meme and opponent names and logos: the registry service (memes)
 *     and the stock list service (stock opponents), injected.
 *   - Cup linkage ({ cupId, round, tieIndex }) and featured flags: the
 *     injected ArenaClashStore (the cup service over Supabase), never
 *     the chain.
 *   - Live in-play moves: current prices (registry priceUsd for memes,
 *     stock NAV for a stock opponent) against the keeper's recorded
 *     start snapshots, injected as a snapshot provider.
 *
 * SCORELINE DERIVATION (pure, exported): goals come from percent
 * moves at 1 goal per 0.5 percent, each side's raw goal count rounded
 * half-up, then the no-negative normalization
 * G_a = max(0, g_a) + max(0, -g_b), G_b = max(0, g_b) + max(0, -g_a),
 * mirroring the league's _roundedPercentChange/_normalizeScoreline
 * semantics (and services/cupCommentaryMath.ts). The scoreline is a
 * DISPLAY derivation only: the winner is NEVER derived from it. The
 * factory decides the winner from the raw moves (strict greater,
 * tie rules above), and this reader reports the winner from
 * winnerBitmap alone.
 */

import type { PublicClient } from "viem";
import {
  arenaConfig,
  createArenaPublicClient,
} from "../arenaConfig.js";
import { meter } from "../lib/net.js";
import { scaledToPrice } from "../lib/priceMath.js";
import { ChainApiError } from "./chainCache.js";
import type { ArenaRoundId } from "./arenaCupService.js";

export const MEME_CLASH_FACTORY_ABI = [
  {
    type: "function",
    name: "createClash",
    stateMutability: "nonpayable",
    inputs: [
      { name: "memeToken", type: "address" },
      { name: "memeSymbol", type: "string" },
      { name: "opponentKind", type: "uint8" },
      { name: "opponentToken", type: "address" },
      { name: "opponentSymbol", type: "string" },
      { name: "windowDuration", type: "uint64" },
      { name: "cupTie", type: "bool" },
      { name: "creatorName", type: "string" },
    ],
    outputs: [{ name: "clashId", type: "uint256" }],
  },
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "clashId", type: "uint256" },
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
      { name: "clashId", type: "uint256" },
      { name: "memeStartPrice", type: "uint256" },
      { name: "memeEndPrice", type: "uint256" },
      { name: "oppStartPrice", type: "uint256" },
      { name: "oppEndPrice", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveCupTie",
    stateMutability: "nonpayable",
    inputs: [
      { name: "clashId", type: "uint256" },
      { name: "memeStartPrice", type: "uint256" },
      { name: "memeEndPrice", type: "uint256" },
      { name: "oppStartPrice", type: "uint256" },
      { name: "oppEndPrice", type: "uint256" },
      { name: "memeWins", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "voidClash",
    stateMutability: "nonpayable",
    inputs: [{ name: "clashId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "clashId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "clashCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "clashInfo",
    stateMutability: "view",
    inputs: [{ name: "clashId", type: "uint256" }],
    outputs: [
      { name: "memeToken", type: "address" },
      { name: "memeSymbol", type: "string" },
      { name: "opponentKind", type: "uint8" },
      { name: "opponentToken", type: "address" },
      { name: "opponentSymbol", type: "string" },
      { name: "creator", type: "address" },
      { name: "creatorName", type: "string" },
      { name: "createdAt", type: "uint64" },
      { name: "windowStart", type: "uint64" },
      { name: "windowEnd", type: "uint64" },
      { name: "cupTie", type: "bool" },
      { name: "outcomeCount", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "clashSettlement",
    stateMutability: "view",
    inputs: [{ name: "clashId", type: "uint256" }],
    outputs: [
      { name: "seedAmount", type: "uint256" },
      { name: "totalStaked", type: "uint256" },
      { name: "state", type: "uint8" },
      { name: "winnerBitmap", type: "uint256" },
      { name: "payoutPerShare", type: "uint256" },
      { name: "memeStartPrice", type: "uint256" },
      { name: "memeEndPrice", type: "uint256" },
      { name: "oppStartPrice", type: "uint256" },
      { name: "oppEndPrice", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "outcomeTotals",
    stateMutability: "view",
    inputs: [
      { name: "clashId", type: "uint256" },
      { name: "outcome", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "stakes",
    stateMutability: "view",
    inputs: [
      { name: "clashId", type: "uint256" },
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
      { name: "clashId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "activeClash",
    stateMutability: "view",
    inputs: [
      { name: "memeToken", type: "address" },
      { name: "opponentToken", type: "address" },
      { name: "windowDuration", type: "uint64" },
    ],
    outputs: [
      { name: "exists", type: "bool" },
      { name: "clashId", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "createdClash",
    stateMutability: "view",
    inputs: [
      { name: "memeToken", type: "address" },
      { name: "opponentToken", type: "address" },
      { name: "windowDuration", type: "uint64" },
    ],
    outputs: [
      { name: "created", type: "bool" },
      { name: "clashId", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "ClashCreated",
    inputs: [
      { name: "clashId", type: "uint256", indexed: true },
      { name: "memeToken", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "opponentToken", type: "address", indexed: false },
      { name: "memeSymbol", type: "string", indexed: false },
      { name: "opponentKind", type: "uint8", indexed: false },
      { name: "opponentSymbol", type: "string", indexed: false },
      { name: "creatorName", type: "string", indexed: false },
      { name: "windowStart", type: "uint64", indexed: false },
      { name: "windowEnd", type: "uint64", indexed: false },
      { name: "windowDuration", type: "uint64", indexed: false },
      { name: "cupTie", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ClashStaked",
    inputs: [
      { name: "clashId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "outcome", type: "uint256", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ClashResolved",
    inputs: [
      { name: "clashId", type: "uint256", indexed: true },
      { name: "winnerBitmap", type: "uint256", indexed: false },
      { name: "payoutPerShare", type: "uint256", indexed: false },
      { name: "resolver", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ClashVoided",
    inputs: [
      { name: "clashId", type: "uint256", indexed: true },
      { name: "voider", type: "address", indexed: false },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "clashId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "payout", type: "uint256", indexed: false },
    ],
  },
  { type: "error", name: "InvalidParams", inputs: [] },
  { type: "error", name: "CreatorNameTooLong", inputs: [{ name: "length", type: "uint256" }, { name: "max", type: "uint256" }] },
  { type: "error", name: "SymbolTooLong", inputs: [{ name: "length", type: "uint256" }, { name: "max", type: "uint256" }] },
  { type: "error", name: "ClashNotOpen", inputs: [{ name: "clashId", type: "uint256" }] },
  { type: "error", name: "BettingClosed", inputs: [{ name: "clashId", type: "uint256" }] },
  { type: "error", name: "StakeTooLow", inputs: [{ name: "amount", type: "uint256" }, { name: "min", type: "uint256" }] },
  { type: "error", name: "InvalidOutcome", inputs: [{ name: "clashId", type: "uint256" }, { name: "outcome", type: "uint256" }] },
  { type: "error", name: "NotResolvableYet", inputs: [{ name: "clashId", type: "uint256" }] },
  { type: "error", name: "AlreadySettled", inputs: [{ name: "clashId", type: "uint256" }] },
  { type: "error", name: "AlreadyClaimed", inputs: [{ name: "clashId", type: "uint256" }, { name: "user", type: "address" }] },
  { type: "error", name: "NothingToClaim", inputs: [{ name: "clashId", type: "uint256" }, { name: "user", type: "address" }] },
  { type: "error", name: "FeeTooHigh", inputs: [{ name: "treasuryFeeBps", type: "uint16" }, { name: "creatorFeeBps", type: "uint16" }, { name: "resolverFeeBps", type: "uint16" }] },
  { type: "error", name: "DuplicateOpenClash", inputs: [{ name: "clashKey", type: "bytes32" }, { name: "existingClashId", type: "uint256" }] },
  { type: "error", name: "OnlyResolver", inputs: [] },
  { type: "error", name: "OnlyResolverOrOwner", inputs: [] },
  { type: "error", name: "InvalidPrice", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "InvalidWindowDuration", inputs: [{ name: "windowDuration", type: "uint64" }] },
  { type: "error", name: "SameToken", inputs: [{ name: "token", type: "address" }] },
  { type: "error", name: "CupTieRequiresExplicitWinner", inputs: [{ name: "clashId", type: "uint256" }] },
  { type: "error", name: "NotCupTie", inputs: [{ name: "clashId", type: "uint256" }] },
  { type: "error", name: "MovesNotEqual", inputs: [{ name: "clashId", type: "uint256" }, { name: "memeMove", type: "int256" }, { name: "oppMove", type: "int256" }] },
] as const;

// ---------------------------------------------------------- pure maths

/** Percent move from a start price to an end price (both 1e8-scaled),
 *  as a number in percent. Mirrors the factory's micro-percent
 *  computation at display precision. Throws on a non-positive start. */
export function percentMove(startScaled: bigint, endScaled: bigint): number {
  if (startScaled <= 0n) throw new Error("[arenaClashReader] start price must be positive");
  const diffMicro = ((endScaled - startScaled) * 1_000_000n) / startScaled;
  return Number(diffMicro) / 10_000;
}

/** Percent move between two decimal USD numbers (live display path). */
export function percentMoveNumbers(start: number, end: number): number {
  if (!(start > 0)) throw new Error("[arenaClashReader] start price must be positive");
  return ((end - start) / start) * 100;
}

/** One side's raw goal count from a percent move: 1 goal per 0.5
 *  percent, rounded half-up on the magnitude, sign preserved. This is
 *  the league's _roundedPercentChange at the arena's goal size. */
export function goalsFromMove(movePct: number): number {
  const units = movePct * 2; // goals before rounding (0.5 percent each)
  return Math.sign(units) * Math.floor(Math.abs(units) + 0.5);
}

/**
 * The display scoreline for a pair of percent moves, pure: raw goals
 * per side, then the no-negative normalization
 * G_a = max(0, g_a) + max(0, -g_b), G_b = max(0, g_b) + max(0, -g_a).
 * Example: meme +3 percent vs stock +1 percent gives raw 6 and 2,
 * normalized 6-2. Meme -1 percent vs stock +2 percent gives raw -2
 * and 4, normalized 0-6 (the meme's negative move becomes opponent
 * goals). NEVER use this to decide a winner: the factory decides
 * from the raw moves.
 */
export function scorelineFromMoves(memeMovePct: number, oppMovePct: number): { memeGoals: number; oppGoals: number } {
  const gMeme = goalsFromMove(memeMovePct);
  const gOpp = goalsFromMove(oppMovePct);
  return {
    memeGoals: Math.max(0, gMeme) + Math.max(0, -gOpp),
    oppGoals: Math.max(0, gOpp) + Math.max(0, -gMeme),
  };
}

/**
 * Live multipliers, computed the way the stock reader's consumers
 * compute them from outcomeTotals, totalStaked, seedAmount and the
 * fee constants: the distributable pool is the seed (whole) plus the
 * staked total minus fees on stakes only (treasury + creator +
 * resolver bps); each outcome's multiplier is distributable divided
 * by that outcome's total, or null when nobody staked that side.
 */
export function clashMultipliers(
  seedAmount: bigint,
  totalStaked: bigint,
  outcomeTotals: readonly [bigint, bigint]
): [number | null, number | null] {
  const feeBps = BigInt(arenaConfig.fees.treasuryBps + arenaConfig.fees.creatorBps + arenaConfig.fees.resolverBps);
  const distributable = seedAmount + totalStaked - (totalStaked * feeBps) / 10_000n;
  const one = (total: bigint): number | null => {
    if (total <= 0n) return null;
    return Math.round((Number(distributable) / Number(total)) * 10_000) / 10_000;
  };
  return [one(outcomeTotals[0]), one(outcomeTotals[1])];
}

// ---------------------------------------------------------- shapes

export interface ArenaCupLink {
  cupId: string;
  round: ArenaRoundId;
  tieIndex: number;
}

export interface ArenaClashSummary {
  id: number;
  memeToken: string;
  memeSymbol: string;
  /** Display name from the registry, or null when not yet indexed. */
  memeName: string | null;
  memeLogoUrl: string | null;
  opponentKind: "stock" | "meme";
  opponentToken: string;
  opponentSymbol: string;
  opponentName: string | null;
  opponentLogoUrl: string | null;
  creator: string;
  creatorName: string;
  /** Unix seconds. */
  createdAt: number;
  windowStart: number;
  windowEnd: number;
  /** windowEnd minus windowStart, seconds (3600 blitz, 86400 standard). */
  windowDuration: number;
  cupTie: boolean;
  /** Cup linkage from the arena store, or null for open clashes. */
  cup: ArenaCupLink | null;
  featured: boolean;
  /** 0 Open, 1 Resolved, 2 Voided (market factory state order). */
  state: number;
  status: "upcoming" | "inplay" | "settled" | "voided";
  seedAmount: string;
  totalStaked: string;
  /** Per-outcome totals (TICK wei strings): index 0 = YES, 1 = NO. */
  outcomeTotals: [string, string];
  /** ["Yes", "No"]: Yes means the meme outperforms. */
  outcomeLabels: ["Yes", "No"];
  /** Live multipliers per outcome, null when that side has no stakes. */
  multipliers: [number | null, number | null];
  /** Winning outcome from winnerBitmap once resolved, else null. */
  winner: 0 | 1 | null;
  /** Settlement prices as decimal USD strings, null until recorded. */
  memeStartPrice: string | null;
  memeEndPrice: string | null;
  oppStartPrice: string | null;
  oppEndPrice: string | null;
  /** Settled percent moves (percent), null until resolved. */
  memeMovePct: number | null;
  oppMovePct: number | null;
  /** Live percent moves while in play, null otherwise. */
  liveMemeMovePct: number | null;
  liveOppMovePct: number | null;
  /** Live display scoreline while in play, null otherwise. */
  liveMemeGoals: number | null;
  liveOppGoals: number | null;
}

export interface ArenaClashUserPosition {
  clashId: number;
  user: string;
  /** Per-outcome stakes (TICK wei strings): index 0 = Yes, 1 = No. */
  stakes: string[];
  totalStaked: string;
  claimed: boolean;
}

export interface ArenaClashInfoFields {
  memeToken: string;
  memeSymbol: string;
  opponentKind: number;
  opponentToken: string;
  opponentSymbol: string;
  creator: string;
  creatorName: string;
  createdAt: bigint;
  windowStart: bigint;
  windowEnd: bigint;
  cupTie: boolean;
  outcomeCount: number;
}

export interface ArenaClashSettlementFields {
  seedAmount: bigint;
  totalStaked: bigint;
  state: number;
  winnerBitmap: bigint;
  payoutPerShare: bigint;
  memeStartPrice: bigint;
  memeEndPrice: bigint;
  oppStartPrice: bigint;
  oppEndPrice: bigint;
}

function field<T>(r: Record<string | number, unknown>, name: string, index: number): T {
  return (r[name] ?? r[index]) as T;
}

/** Normalize a viem clashInfo result (named or positional), mirroring
 *  normalizeStockMarketInfoResult in services/stockMarketReader.ts. */
export function normalizeClashInfoResult(raw: unknown): ArenaClashInfoFields {
  const r = raw as Record<string | number, unknown>;
  return {
    memeToken: field<string>(r, "memeToken", 0),
    memeSymbol: field<string>(r, "memeSymbol", 1),
    opponentKind: field<number>(r, "opponentKind", 2),
    opponentToken: field<string>(r, "opponentToken", 3),
    opponentSymbol: field<string>(r, "opponentSymbol", 4),
    creator: field<string>(r, "creator", 5),
    creatorName: field<string>(r, "creatorName", 6),
    createdAt: field<bigint>(r, "createdAt", 7),
    windowStart: field<bigint>(r, "windowStart", 8),
    windowEnd: field<bigint>(r, "windowEnd", 9),
    cupTie: field<boolean>(r, "cupTie", 10),
    outcomeCount: field<number>(r, "outcomeCount", 11),
  };
}

/** Normalize a viem clashSettlement result, mirroring
 *  normalizeStockMarketSettlementResult. */
export function normalizeClashSettlementResult(raw: unknown): ArenaClashSettlementFields {
  const r = raw as Record<string | number, unknown>;
  return {
    seedAmount: field<bigint>(r, "seedAmount", 0),
    totalStaked: field<bigint>(r, "totalStaked", 1),
    state: field<number>(r, "state", 2),
    winnerBitmap: field<bigint>(r, "winnerBitmap", 3),
    payoutPerShare: field<bigint>(r, "payoutPerShare", 4),
    memeStartPrice: field<bigint>(r, "memeStartPrice", 5),
    memeEndPrice: field<bigint>(r, "memeEndPrice", 6),
    oppStartPrice: field<bigint>(r, "oppStartPrice", 7),
    oppEndPrice: field<bigint>(r, "oppEndPrice", 8),
  };
}

// ---------------------------------------------------------- the reader

/** Cup linkage and featured flags, from the arena store (Supabase via
 *  the cup service). Injected so the reader never imports the DB. */
export interface ArenaClashStore {
  getTieForClash(clashId: number): Promise<ArenaCupLink | null>;
  getFeaturedClashIds(): Promise<Set<number>>;
}

/** The keeper's recorded start snapshots and the live price sources,
 *  injected so the reader can derive in-play moves without owning
 *  the snapshot store. Prices are decimal USD numbers. */
export interface ArenaLivePriceProvider {
  /** Keeper-recorded window-start prices for a clash, or null. */
  getStartSnapshots(clashId: number): Promise<{ memePrice: number; oppPrice: number } | null>;
  /** Current price for a meme token (registry), or null. */
  getMemePriceUsd(tokenAddress: string): number | null;
  /** Current NAV for a stock token (stock list), or null. */
  getStockNavUsd(tokenAddress: string): number | null;
}

export interface ArenaClashReaderOpts {
  factory?: `0x${string}`;
  publicClient?: PublicClient;
  /** Meme display-name lookup by token address (registry). */
  memeNameLookup?: (tokenAddress: string) => string | null;
  /** Meme logo lookup by token address (registry). */
  memeLogoLookup?: (tokenAddress: string) => string | null;
  /** Stock display-name lookup by token address (stock list). */
  stockNameLookup?: (tokenAddress: string) => string | null;
  /** Stock logo lookup by token address (stock list). */
  stockLogoLookup?: (tokenAddress: string) => string | null;
  store?: ArenaClashStore | null;
  livePrices?: ArenaLivePriceProvider | null;
}

const MULTICALL_CHUNK = 100;

type MulticallResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

type FactoryCall = {
  address: `0x${string}`;
  abi: typeof MEME_CLASH_FACTORY_ABI;
  functionName: "clashInfo" | "clashSettlement" | "outcomeTotals";
  args: readonly [bigint] | readonly [bigint, bigint];
};

export class ArenaClashReader {
  private readonly factory: `0x${string}`;
  private readonly publicClient: PublicClient;
  private readonly opts: ArenaClashReaderOpts;
  private readonly store: ArenaClashStore | null;
  private readonly livePrices: ArenaLivePriceProvider | null;
  private clashesCache: { at: number; value: { clashes: ArenaClashSummary[]; asOfBlock: string; refreshedAt: string } } | null = null;
  private readonly clashCache = new Map<string, { at: number; value: ArenaClashSummary }>();
  private readonly dirtyClashIds = new Map<number, number>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(opts: ArenaClashReaderOpts = {}) {
    this.factory = opts.factory ?? arenaConfig.factoryAddress;
    this.publicClient = opts.publicClient ?? createArenaPublicClient();
    this.opts = opts;
    this.store = opts.store ?? null;
    this.livePrices = opts.livePrices ?? null;
  }

  get factoryAddress(): `0x${string}` {
    return this.factory;
  }

  get client(): PublicClient {
    return this.publicClient;
  }

  /** Same signature and semantics as StockMarketReader.markMarketDirty:
   *  the next list read refreshes only this clash, and its
   *  single-clash cache entry is dropped immediately. */
  markClashDirty(id: bigint): void {
    const clashId = Number(id);
    if (!Number.isSafeInteger(clashId) || clashId < 0) return;
    this.dirtyClashIds.set(clashId, (this.dirtyClashIds.get(clashId) ?? 0) + 1);
    meter.count("arena_clash_events");
    this.clashCache.delete(`clash:${clashId}`);
  }

  async getClashes(): Promise<{ clashes: ArenaClashSummary[]; asOfBlock: string; refreshedAt: string }> {
    return this.coalesce("clashes", async () => {
      const now = Date.now();
      if (this.clashesCache && now - this.clashesCache.at < arenaConfig.cache.clashesTtlMs) {
        if (this.dirtyClashIds.size === 0) return this.clashesCache.value;
        const pending = [...this.dirtyClashIds];
        const updates = await Promise.all(pending.map(async ([id]) => this.fetchClash(BigInt(id))));
        const clashes = [...this.clashesCache.value.clashes];
        for (let i = 0; i < pending.length; i++) {
          const [id, version] = pending[i];
          clashes[id] = updates[i];
          this.clashCache.set(`clash:${id}`, { at: now, value: updates[i] });
          if (this.dirtyClashIds.get(id) === version) this.dirtyClashIds.delete(id);
        }
        meter.count("arena_clashes_targeted_refresh", pending.length);
        const value = { ...this.clashesCache.value, clashes };
        this.clashesCache = { at: this.clashesCache.at, value };
        return value;
      }
      const pending = [...this.dirtyClashIds];
      const value = await this.fetchClashes().catch((err) => {
        throw new ChainApiError("RPC_UNAVAILABLE", rpcUnavailableMessage(err));
      });
      this.clashesCache = { at: now, value };
      for (const [id, version] of pending) {
        if (this.dirtyClashIds.get(id) === version) this.dirtyClashIds.delete(id);
      }
      return value;
    }) as Promise<{ clashes: ArenaClashSummary[]; asOfBlock: string; refreshedAt: string }>;
  }

  async getClash(id: number): Promise<ArenaClashSummary> {
    if (!Number.isInteger(id) || id < 0) {
      throw new ChainApiError("BAD_REQUEST", "Clash id must be a non-negative integer.");
    }
    const key = `clash:${id}`;
    return this.coalesce(key, async () => {
      const now = Date.now();
      const cached = this.clashCache.get(key);
      if (cached && now - cached.at < arenaConfig.cache.clashTtlMs) return cached.value;
      const value = await this.fetchClash(BigInt(id)).catch((err) => {
        if (err instanceof ChainApiError) throw err;
        throw new ChainApiError("RPC_UNAVAILABLE", rpcUnavailableMessage(err));
      });
      this.clashCache.set(key, { at: now, value });
      if (this.clashCache.size > 500) {
        const oldest = this.clashCache.keys().next().value;
        if (oldest !== undefined) this.clashCache.delete(oldest);
      }
      return value;
    }) as Promise<ArenaClashSummary>;
  }

  /** One user's stakes and claim flag for one clash (3 reads in one
   *  multicall). Not cached, exactly like the stock reader. */
  async getUserPosition(id: number, user: `0x${string}`): Promise<ArenaClashUserPosition> {
    if (!Number.isInteger(id) || id < 0) {
      throw new ChainApiError("BAD_REQUEST", "Clash id must be a non-negative integer.");
    }
    const clashId = BigInt(id);
    let results: MulticallResult[];
    try {
      results = (await this.publicClient.multicall({
        contracts: [
          { address: this.factory, abi: MEME_CLASH_FACTORY_ABI, functionName: "stakes", args: [clashId, user, 0n] },
          { address: this.factory, abi: MEME_CLASH_FACTORY_ABI, functionName: "stakes", args: [clashId, user, 1n] },
          { address: this.factory, abi: MEME_CLASH_FACTORY_ABI, functionName: "claimed", args: [clashId, user] },
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
      clashId: id,
      user,
      stakes: [yes.toString(), no.toString()],
      totalStaked: (yes + no).toString(),
      claimed,
    };
  }

  private async fetchClashes(): Promise<{ clashes: ArenaClashSummary[]; asOfBlock: string; refreshedAt: string }> {
    const [count, asOfBlock] = await Promise.all([
      this.publicClient.readContract({
        address: this.factory,
        abi: MEME_CLASH_FACTORY_ABI,
        functionName: "clashCount",
      }),
      this.publicClient.getBlockNumber(),
    ]);
    const n = Number(count);
    if (n === 0) return { clashes: [], asOfBlock: asOfBlock.toString(), refreshedAt: new Date().toISOString() };
    if (n > 10_000) throw new Error(`clashCount absurdly large: ${n}`);

    const ids = Array.from({ length: n }, (_, i) => BigInt(i));
    const infoResults = await this.multicallChunked(
      ids.map((id) => ({
        address: this.factory,
        abi: MEME_CLASH_FACTORY_ABI,
        functionName: "clashInfo",
        args: [id] as readonly [bigint],
      }))
    );
    const settlementResults = await this.multicallChunked(
      ids.map((id) => ({
        address: this.factory,
        abi: MEME_CLASH_FACTORY_ABI,
        functionName: "clashSettlement",
        args: [id] as readonly [bigint],
      }))
    );
    const totalsResults = await this.multicallChunked(
      ids.flatMap((id) => [
        { address: this.factory, abi: MEME_CLASH_FACTORY_ABI, functionName: "outcomeTotals", args: [id, 0n] as readonly [bigint, bigint] },
        { address: this.factory, abi: MEME_CLASH_FACTORY_ABI, functionName: "outcomeTotals", args: [id, 1n] as readonly [bigint, bigint] },
      ]),
      200
    );
    const featured = this.store ? await this.store.getFeaturedClashIds().catch(() => new Set<number>()) : new Set<number>();

    const clashes: ArenaClashSummary[] = [];
    for (let i = 0; i < ids.length; i++) {
      const info = normalizeClashInfoResult(unwrap(infoResults[i], `clashInfo(${ids[i]})`));
      const settlement = normalizeClashSettlementResult(unwrap(settlementResults[i], `clashSettlement(${ids[i]})`));
      const totals: [bigint, bigint] = [
        unwrap(totalsResults[i * 2], `outcomeTotals(${ids[i]},0)`) as bigint,
        unwrap(totalsResults[i * 2 + 1], `outcomeTotals(${ids[i]},1)`) as bigint,
      ];
      clashes.push(await this.toSummary(Number(ids[i]), info, settlement, totals, featured));
    }
    meter.count("arena_clashes_refresh", 1);
    return { clashes, asOfBlock: asOfBlock.toString(), refreshedAt: new Date().toISOString() };
  }

  private async fetchClash(id: bigint): Promise<ArenaClashSummary> {
    const [infoRaw, settlementRaw] = (await this.publicClient.multicall({
      contracts: [
        { address: this.factory, abi: MEME_CLASH_FACTORY_ABI, functionName: "clashInfo", args: [id] },
        { address: this.factory, abi: MEME_CLASH_FACTORY_ABI, functionName: "clashSettlement", args: [id] },
      ],
      allowFailure: false,
    }).catch((err) => {
      throw looksLikeMissingClash(err)
        ? new ChainApiError("NOT_FOUND", `Arena clash #${id} does not exist.`)
        : err;
    })) as unknown as [unknown, unknown];
    const info = normalizeClashInfoResult(infoRaw);
    const settlement = normalizeClashSettlementResult(settlementRaw);
    const totalsResults = await this.multicallChunked(
      [0, 1].map((o) => ({
        address: this.factory,
        abi: MEME_CLASH_FACTORY_ABI,
        functionName: "outcomeTotals",
        args: [id, BigInt(o)] as readonly [bigint, bigint],
      })),
      200
    );
    const totals: [bigint, bigint] = [
      unwrap(totalsResults[0], `outcomeTotals(${id},0)`) as bigint,
      unwrap(totalsResults[1], `outcomeTotals(${id},1)`) as bigint,
    ];
    const featured = this.store ? await this.store.getFeaturedClashIds().catch(() => new Set<number>()) : new Set<number>();
    return this.toSummary(Number(id), info, settlement, totals, featured);
  }

  private async toSummary(
    id: number,
    info: ArenaClashInfoFields,
    settlement: ArenaClashSettlementFields,
    outcomeTotals: [bigint, bigint],
    featured: Set<number>
  ): Promise<ArenaClashSummary> {
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = Number(info.windowStart);
    const windowEnd = Number(info.windowEnd);
    const state = Number(settlement.state);
    const status: ArenaClashSummary["status"] =
      state === 2 ? "voided"
      : state === 1 ? "settled"
      : nowSec < windowStart ? "upcoming"
      : "inplay";
    const winner: 0 | 1 | null =
      state === 1 ? ((settlement.winnerBitmap & 1n) === 1n ? 0 : (settlement.winnerBitmap & 2n) === 2n ? 1 : null) : null;
    const settled = state === 1 && settlement.memeStartPrice > 0n && settlement.oppStartPrice > 0n;
    const memeMovePct = settled ? percentMove(settlement.memeStartPrice, settlement.memeEndPrice) : null;
    const oppMovePct = settled ? percentMove(settlement.oppStartPrice, settlement.oppEndPrice) : null;

    // Live derivation while in play: current prices against the
    // keeper's recorded start snapshots. Any missing input leaves the
    // live fields null rather than inventing a move.
    let liveMemeMovePct: number | null = null;
    let liveOppMovePct: number | null = null;
    let liveMemeGoals: number | null = null;
    let liveOppGoals: number | null = null;
    if (status === "inplay" && this.livePrices) {
      const start = await this.livePrices.getStartSnapshots(id).catch(() => null);
      const memeNow = this.livePrices.getMemePriceUsd(info.memeToken);
      const oppNow = info.opponentKind === 0
        ? this.livePrices.getStockNavUsd(info.opponentToken)
        : this.livePrices.getMemePriceUsd(info.opponentToken);
      if (start && memeNow !== null && oppNow !== null && start.memePrice > 0 && start.oppPrice > 0) {
        liveMemeMovePct = Math.round(percentMoveNumbers(start.memePrice, memeNow) * 10_000) / 10_000;
        liveOppMovePct = Math.round(percentMoveNumbers(start.oppPrice, oppNow) * 10_000) / 10_000;
        const line = scorelineFromMoves(liveMemeMovePct, liveOppMovePct);
        liveMemeGoals = line.memeGoals;
        liveOppGoals = line.oppGoals;
      }
    }

    const cup = this.store ? await this.store.getTieForClash(id).catch(() => null) : null;
    const priceOrNull = (v: bigint): string | null => (v > 0n ? scaledToPrice(v) : null);
    return {
      id,
      memeToken: info.memeToken,
      memeSymbol: info.memeSymbol,
      memeName: this.opts.memeNameLookup ? this.opts.memeNameLookup(info.memeToken) : null,
      memeLogoUrl: this.opts.memeLogoLookup ? this.opts.memeLogoLookup(info.memeToken) : null,
      opponentKind: info.opponentKind === 0 ? "stock" : "meme",
      opponentToken: info.opponentToken,
      opponentSymbol: info.opponentSymbol,
      opponentName: info.opponentKind === 0
        ? (this.opts.stockNameLookup ? this.opts.stockNameLookup(info.opponentToken) : null)
        : (this.opts.memeNameLookup ? this.opts.memeNameLookup(info.opponentToken) : null),
      opponentLogoUrl: info.opponentKind === 0
        ? (this.opts.stockLogoLookup ? this.opts.stockLogoLookup(info.opponentToken) : null)
        : (this.opts.memeLogoLookup ? this.opts.memeLogoLookup(info.opponentToken) : null),
      creator: info.creator,
      creatorName: info.creatorName,
      createdAt: Number(info.createdAt),
      windowStart,
      windowEnd,
      windowDuration: windowEnd - windowStart,
      cupTie: info.cupTie,
      cup,
      featured: featured.has(id),
      state,
      status,
      seedAmount: settlement.seedAmount.toString(),
      totalStaked: settlement.totalStaked.toString(),
      outcomeTotals: [outcomeTotals[0].toString(), outcomeTotals[1].toString()],
      outcomeLabels: ["Yes", "No"],
      multipliers: clashMultipliers(settlement.seedAmount, settlement.totalStaked, outcomeTotals),
      winner,
      memeStartPrice: priceOrNull(settlement.memeStartPrice),
      memeEndPrice: priceOrNull(settlement.memeEndPrice),
      oppStartPrice: priceOrNull(settlement.oppStartPrice),
      oppEndPrice: priceOrNull(settlement.oppEndPrice),
      memeMovePct,
      oppMovePct,
      liveMemeMovePct,
      liveOppMovePct,
      liveMemeGoals,
      liveOppGoals,
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
          abi: typeof MEME_CLASH_FACTORY_ABI;
          functionName: "clashInfo" | "clashSettlement" | "outcomeTotals";
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

function looksLikeMissingClash(err: unknown): boolean {
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
  return "Live clash data is refreshing, please try again in a moment.";
}
