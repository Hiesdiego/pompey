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
 *   12 teams, double round-robin, home and away, 22 rounds, 6 fixtures
 *   per round, 132 fixtures, Nov 26 to Dec 16 2026, 1-hour matches
 *   staggered randomly like crypto, one round lasts 1 day, except the
 *   Dec 16 finale, which hosts rounds 21 and 22 in two waves, morning
 *   and evening, 12 fixtures that day. Scoring: 1 goal = 0.05% (5 bps),
 *   integer basis point math, so 0.03% is the first scoring move,
 *   no-negative scorelines exactly like crypto, max 10 goals per team
 *   per match, raw volatile cap 3% with circuit breaker review, 3 pts
 *   win / 1 draw / 0 loss, tiebreak points, GD, GF, wins, fewest
 *   losses. Forfeit: no performance for that period means 0-3,
 *   opponent wins 3-0, marked FORFEIT. Both sides missing means void,
 *   stakes refunded.
 *
 * Price rule, user approved Nov 18 2026: accept the last NAV within the
 * 24h heartbeat as the end price when the feed is healthy but quiet.
 * That rule does NOT fix teams with no NAV at all, which is why the
 * roster shrank from 22 teams to these 12. See StockScoringExplainer
 * for the plain-language version.
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
  teamCount: 12,
  rounds: 22,
  fixturesPerRound: 6,
  totalFixtures: 132,
  /** First round, UTC midnight. Round n starts Nov 26 + n days, except round 22, which shares Dec 16 with round 21. */
  firstRoundUtc: "2026-11-26",
  lastRoundUtc: "2026-12-16",
  /** Dec 16 hosts rounds 21 and 22 in two waves, morning and evening. */
  doubleHeaderDate: "2026-12-16",
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
 *
 * NOTE: the 22-team stock stack already deployed on Base Sepolia used a
 * 22-team schedule that is now stale. This 12-team season needs the
 * schedule redone, an upgrade, or a fresh registry, an engineering team
 * call. Do not point these vars at the 22-team registry and expect a
 * 12-team season. Fill them in only after the 12-team stack deploys.
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
 * platformFeeBps is read for payout estimates. It is a real public
 * view on StockPredictionPool (owner-adjustable, 7% default); it was
 * missing from this frontend ABI, so the stake panel and the
 * pre-match briefing could not read the fee on-chain. There is no
 * claimVoid on the stock pool: claim() refunds voided stakes 1:1, so
 * do not add a claimVoid entry here.
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
    name: "platformFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
 * Chainlink NAV is the primary feed. Price rule, user approved Nov 18
 * 2026: the backend accepts the last NAV within the 24h heartbeat as
 * the end price when the feed is healthy but quiet. A team with no NAV
 * at all cannot play, that is why the roster is 12 teams.
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

/**
 * StockMatchRegistry read-only views.
 *
 * FIX (12-team revision): the 22-team frontend ABI listed only 8 tuple
 * fields and omitted voided and matchEndTimestamp. The real on-chain
 * tuple has 10 fields, in this order: homeTeamId, awayTeamId,
 * matchdayIndex, windowStart, windowEnd, kickoffTimestamp,
 * kickoffRevealed, settled, voided, matchEndTimestamp. The backend
 * fixed its copy on Nov 17 2026, the frontend copy is fixed here, so
 * the match page can read matchEndTimestamp by name instead of
 * misreading the settled word as a timestamp.
 */
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
          { name: "voided", type: "bool" },
          { name: "matchEndTimestamp", type: "uint64" },
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
 * Stock backend endpoints, mounted by the backend under /api/stocks/*
 * (plural, canonical). The 22-team frontend called /api/stock/*, which
 * the backend never served, so every stock page 404d in production.
 * This file calls /api/stocks/* only. Do not reintroduce the singular
 * path.
 *
 * Backend must implement these with the same shapes as /api/table,
 * /api/fixtures, /api/fixtures/:id and /api/fixtures/:id/pool, plus the
 * stock-only fields on fixtures: forfeit, forfeitingTeamId, voided,
 * homeGoals, awayGoals. Until the backend ships them, pages using
 * stockApi degrade to the same ErrorState the crypto pages show.
 *
 * Prices are NOT fetched here. Prices arrive through useStockLiveFeed,
 * which polls /api/stocks/prices and is namespaced to stock teamIds.
 * Stock teamIds 0 to 11 overlap crypto teamIds, so stock prices must
 * never be merged into the crypto price map or keyed by bare teamId
 * outside the stock namespace. Do not add a second /api/prices poll for
 * stocks, it would double egress against the 1GB per month backend cap.
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
  /** Deterministic backend kickoff slot (ISO, UTC), published before the
   *  on-chain reveal; provisional until the reveal confirms it. */
  scheduledKickoff: string | null;
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

/** One row from /api/stocks/prices. teamId is a STOCK teamId, namespaced, never a crypto teamId. */
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
