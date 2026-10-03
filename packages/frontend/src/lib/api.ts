/**
 * Typed client for the TICKR backend REST API (spec P2.7).
 * Base URL: same-origin Next.js proxy. BigInts arrive as strings.
 *
 * Resilience: no `cache: "no-store"` — caching is the data layer's job
 * (React Query). All failures throw CodedError (lib/errors) with calm,
 * user-safe messages — never infrastructure wording, never the backend URL.
 */

import { BACKEND_API_URL } from "./contracts";
import { CodedError, toAppError, type ErrorCode } from "./errors";

export interface ApiTeam {
  teamId: number;
  name: string;
  symbol: string;
  cmcId: number;
  imageUrl: string | null;
}

export interface ApiFixtureTeam {
  teamId: number;
  name: string;
  symbol: string;
}

export interface ApiFixture {
  fixtureId: string;
  seasonId: string;
  home: ApiFixtureTeam | null;
  away: ApiFixtureTeam | null;
  matchdayIndex: number;
  windowStart: string; // ISO
  windowEnd: string; // ISO
  kickoff: string | null; // ISO
  scheduledKickoff: string | null; // ISO; provisional deterministic slot before on-chain reveal
  kickoffRevealed: boolean;
  settled: boolean;
  voided: boolean; // escape hatch: fixture voided by owner, stakes refundable via claimVoid
}

export interface ApiPool {
  seasonId: string;
  fixtureId: string;
  totalHome: string;
  totalDraw: string;
  totalAway: string;
  seed: string;
  totalPool: string;
  settled: boolean;
  voided: boolean; // escape hatch: stakes refundable via claimVoid, never payable via claim
  winningOutcome: number | null;
}

export interface ApiTableRow {
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
}

export interface ApiPlayer {
  address: string;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  longestStreak: number;
  totalStakedTick: string;
  totalWonTick: string;
  winRateBps: string;
}

export interface ApiPrice {
  teamId: number;
  symbol: string;
  price: string | null;
  source: string | null;
  ok: boolean;
  error?: string;
}

/**
 * @deprecated Use CodedError from "./errors". Kept so existing
 * `instanceof ApiError` / `.status` catch sites compile during migration.
 */
export class ApiError extends CodedError {
  status: number;
  constructor(status: number, code: ErrorCode, detail?: string) {
    super(code, detail);
    this.name = "ApiError";
    this.status = status;
  }
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_API_URL}${path}`, {
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new CodedError(timedOut ? "TIMEOUT" : "BACKEND_UNAVAILABLE");
  }
  if (!res.ok) {
    if (res.status === 404) throw new ApiError(404, "NOT_FOUND");
    // Backend answered with an error — normalize via the shared taxonomy.
    // The raw body is never surfaced (it may contain infra wording).
    throw toAppError({ ok: false, code: "query_failed" });
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => get<{ status: string; chainEnv: string; seasonId: string }>("/health"),
  teams: () => get<ApiTeam[]>("/api/teams"),
  fixtures: () => get<ApiFixture[]>("/api/fixtures"),
  fixture: (id: string | number) => get<ApiFixture>(`/api/fixtures/${id}`),
  pool: (id: string | number) => get<ApiPool>(`/api/fixtures/${id}/pool`),
  table: () => get<ApiTableRow[]>("/api/table"),
  leaderboard: () => get<ApiPlayer[]>("/api/leaderboard"),
  player: (address: string) => get<ApiPlayer>(`/api/players/${address}`),
  prices: () => get<ApiPrice[]>("/api/prices"),
};
