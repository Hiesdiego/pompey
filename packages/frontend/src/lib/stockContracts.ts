/**
 * Stock League contract config (TICKR Stock League, Season 1).
 *
 * Target location in the repo:
 *   packages/frontend/src/lib/stockContracts.ts
 *
 * Every address comes from a NEXT_PUBLIC_STOCK_* env var. Nothing is
 * hardcoded. An empty string means "not configured yet" (fill in
 * .env.local after the stock stack deploys). TICK is reused, so the
 * tickToken address is imported from the crypto config, not duplicated.
 *
 * Locked season facts, stated here so every consumer agrees:
 *   22 teams, single round-robin, 21 matchdays, 11 fixtures per matchday,
 *   231 fixtures, Nov 26 to Dec 16 2026, 1-hour matches staggered randomly
 *   like crypto, one matchday lasts 1 day. Scoring: 1 goal = 0.05% (5 bps),
 *   half-up rounding, no-negative scorelines exactly like crypto, max 10
 *   goals per team per match, raw volatile cap 3% with circuit breaker
 *   review, 3 pts win / 1 draw / 0 loss, tiebreak points, GD, GF, wins,
 *   fewest losses. Forfeit: no performance for that period means 0-3,
 *   opponent wins 3-0, marked FORFEIT. Both sides missing means void,
 *   stakes refunded.
 *
 * Never import from the @tickr/shared barrel. Direct module paths only.
 */

import { baseSepolia, baseMainnet } from "@tickr/shared/chains";
import type { Address } from "viem";
import { BACKEND_API_URL, CONTRACTS as CRYPTO_CONTRACTS } from "./contracts";

export const STOCK_ACTIVE_CHAIN =
  process.env.NEXT_PUBLIC_TICKR_CHAIN_ENV === "mainnet" ? baseMainnet : baseSepolia;

/** Stock season id. Defaults to 1, the first stock season. */
export const STOCK_SEASON_ID: bigint = BigInt(
  process.env.NEXT_PUBLIC_STOCK_SEASON_ID ?? "1"
);

/** Stock season calendar, locked. Dates are UTC. */
export const STOCK_SEASON = {
  seasonId: 1,
  teamCount: 22,
  matchdays: 21,
  fixturesPerMatchday: 11,
  totalFixtures: 231,
  /** First matchday, UTC midnight. Matchday n starts Nov 26 + n days. */
  firstMatchdayUtc: "2026-11-26",
  lastMatchdayUtc: "2026-12-16",
  matchDurationMinutes: 60,
} as const;

function envAddress(value: string | undefined): Address | "" {
  const v = (value ?? "").trim();
  return v === "" ? "" : (v as Address);
}

/**
 * Deployed stock contract addresses. "" = not configured yet.
 * Keep these references static: Next.js inlines NEXT_PUBLIC_* values only
 * when it can see the property access at build time.
 */
export const STOCK_CONTRACTS = {
  /** TICK is reused from the crypto league. Same token, same address. */
  tickToken: CRYPTO_CONTRACTS.tickToken,
  /** Shared PlayerStats. No separate stock leaderboard, TP is unified. */
  playerStats: CRYPTO_CONTRACTS.playerStats,
  teamRegistry: envAddress(process.env.NEXT_PUBLIC_STOCK_TEAM_REGISTRY_ADDRESS),
  matchRegistry: envAddress(process.env.NEXT_PUBLIC_STOCK_MATCH_REGISTRY_ADDRESS),
  priceOracle: envAddress(process.env.NEXT_PUBLIC_STOCK_PRICE_ORACLE_ADDRESS),
  resultEngine: envAddress(process.env.NEXT_PUBLIC_STOCK_RESULT_ENGINE_ADDRESS),
  predictionPool: envAddress(process.env.NEXT_PUBLIC_STOCK_PREDICTION_POOL_ADDRESS),
} as const;

/** Stock PriceOracle stores NAV prices scaled by 1e8, same as crypto. */
export const STOCK_PRICE_DECIMALS = 8;
/** SeasonMath.FIXTURE_ID_SPACE, same composite key scheme as crypto. */
export const STOCK_FIXTURE_ID_SPACE = 1_000_000n;

export function stockGlobalFixtureId(seasonId: bigint, fixtureId: bigint): bigint {
  return seasonId * STOCK_FIXTURE_ID_SPACE + fixtureId;
}

/** Minimum stake enforced by StockPredictionPool, mirrors crypto. */
export const STOCK_MIN_STAKE_TICK = 10;

// ── Minimal ABIs (mirror the crypto ABIs, stock contract names) ───────────

/**
 * StockPredictionPool. See the stock contracts (cup-style fresh stack).
 * stake(seasonId, fixtureId, outcome, amount), outcome is uint8
 * (WinHome=0, Draw=1, WinAway=2). claim(seasonId, fixtureId). claimed()
 * is keyed by the GLOBAL fixture id (see stockGlobalFixtureId above).
 */
export const STOCK_PREDICTION_POOL_ABI = [
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
      { name: "outcome", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "totalHome", type: "uint256" },
          { name: "totalDraw", type: "uint256" },
          { name: "totalAway", type: "uint256" },
          { name: "seed", type: "uint256" },
          { name: "settled", type: "bool" },
          { name: "voided", type: "bool" },
          { name: "winningOutcome", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getStake",
    stateMutability: "view",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
      { name: "player", type: "address" },
      { name: "outcome", type: "uint8" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [
      { name: "globalFixtureId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * StockPriceOracle.getSnapshot. NAV prices, scaled 1e8.
 * Chainlink NAV is the primary feed. A stale NAV blocks the snapshot,
 * exactly like crypto, unless a verified fallback is supplied.
 */
export const STOCK_PRICE_ORACLE_ABI = [
  {
    type: "function",
    name: "getSnapshot",
    stateMutability: "view",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "homeStart", type: "uint256" },
          { name: "awayStart", type: "uint256" },
          { name: "homeEnd", type: "uint256" },
          { name: "awayEnd", type: "uint256" },
          { name: "startSubmitted", type: "bool" },
          { name: "endSubmitted", type: "bool" },
        ],
      },
    ],
  },
] as const;

/** StockMatchRegistry read-only views. */
export const STOCK_MATCH_REGISTRY_ABI = [
  {
    type: "function",
    name: "getFixture",
    stateMutability: "view",
    inputs: [{ name: "fixtureId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "homeTeamId", type: "uint16" },
          { name: "awayTeamId", type: "uint16" },
          { name: "matchdayIndex", type: "uint8" },
          { name: "windowStart", type: "uint64" },
          { name: "windowEnd", type: "uint64" },
          { name: "kickoffTimestamp", type: "uint64" },
          { name: "kickoffRevealed", type: "bool" },
          { name: "settled", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isBettingOpen",
    stateMutability: "view",
    inputs: [{ name: "fixtureId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── Stock backend API ──────────────────────────────────────────────────────

/**
 * Stock backend endpoints, mounted by the backend under /api/stocks/*.
 * Backend must implement these with the same shapes as /api/table,
 * /api/fixtures, /api/fixtures/:id and /api/fixtures/:id/pool, plus the
 * stock-only fields on fixtures: forfeit, forfeitingTeamId, voided,
 * homeGoals, awayGoals. Until the backend ships them, pages using
 * stockApi degrade to the same ErrorState the crypto pages show.
 *
 * Prices are NOT fetched here. Prices arrive over the single shared
 * WebSocket in useLiveFeed, which stock pages reuse. Do not add a second
 * /api/prices poll for stocks, it would double egress against the 1GB
 * per month backend cap.
 */
export interface StockApiFixtureTeam {
  teamId: number;
  name: string;
  symbol: string;
}

export interface StockApiFixture {
  fixtureId: string;
  seasonId: string;
  home: StockApiFixtureTeam | null;
  away: StockApiFixtureTeam | null;
  matchdayIndex: number;
  windowStart: string; // ISO, UTC
  windowEnd: string; // ISO, UTC
  kickoff: string | null; // ISO, UTC
  kickoffRevealed: boolean;
  settled: boolean;
  /** True when the result is a 3-0 forfeit. */
  forfeit?: boolean;
  /** teamId of the side that forfeited, null when neither or both. */
  forfeitingTeamId?: number | null;
  /** True when both sides had no performance, stakes refunded. */
  voided?: boolean;
  homeGoals?: number | null;
  awayGoals?: number | null;
}

export interface StockApiPool {
  seasonId: string;
  fixtureId: string;
  totalHome: string;
  totalDraw: string;
  totalAway: string;
  seed: string;
  totalPool: string;
  settled: boolean;
  voided: boolean;
  winningOutcome: number | null;
}

export interface StockApiTableRow {
  teamId: number;
  name: string;
  symbol: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  goalDifference: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Number of fixtures in this row decided by forfeit. */
  forfeits?: number;
}

export class StockApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function stockGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_API_URL}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new StockApiError(
      0,
      timedOut
        ? `Stock backend request timed out at ${BACKEND_API_URL}. Check the backend logs.`
        : `Backend unreachable at ${BACKEND_API_URL}, is it running?`
    );
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) detail = String(body.error);
    } catch {
      /* ignore */
    }
    throw new StockApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const stockApi = {
  fixtures: () => stockGet<StockApiFixture[]>("/api/stocks/fixtures"),
  fixture: (id: string | number) => stockGet<StockApiFixture>(`/api/stocks/fixtures/${id}`),
  pool: (id: string | number) => stockGet<StockApiPool>(`/api/stocks/fixtures/${id}/pool`),
  table: () => stockGet<StockApiTableRow[]>("/api/stocks/table"),
  prices: () => stockGet<StockApiPrice[]>("/api/stocks/prices"),
};

export interface StockApiPrice {
  teamId: number;
  ticker: string;
  symbol: string;
  price: string | null;
  source: string | null;
  navPriceUpdatedAt: string | null;
  multiplier: number | null;
  ok: boolean;
}
