
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
  windowStart: string;
  windowEnd: string;
  kickoff: string | null;
  scheduledKickoff: string | null;
  kickoffRevealed: boolean;
  settled: boolean;
  voided: boolean;
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
  voided: boolean;
  winningOutcome: number | null;
}

export interface ApiFormEntry {
  fixtureId: string;
  opponentTeamId: number;
  result: "W" | "D" | "L";
  goalsFor: number;
  goalsAgainst: number;
}

export interface ApiFixtureForm {
  ready: boolean;
  home: ApiFormEntry[];
  away: ApiFormEntry[];
}

export interface ApiPriceHistoryPoint {
  t: number;
  p: number;
  source?: "Binance" | "CoinGecko";
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

    throw toAppError({ ok: false, code: "query_failed" });
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => get<{ status: string; chainEnv: string; seasonId: string }>("/health"),
  teams: () => get<ApiTeam[]>("/api/teams"),
  targetTeams: () => get<ApiTeam[]>("/api/target-teams"),
  fixtures: () => get<ApiFixture[]>("/api/fixtures"),
  fixture: (id: string | number) => get<ApiFixture>(`/api/fixtures/${id}`),
  pool: (id: string | number) => get<ApiPool>(`/api/fixtures/${id}/pool`),
  fixtureForm: (id: string | number) => get<ApiFixtureForm>(`/api/fixtures/${id}/form`),
  table: () => get<ApiTableRow[]>("/api/table"),
  priceHistory: (symbol: string) => get<ApiPriceHistoryPoint[]>(`/api/price-history/${encodeURIComponent(symbol)}`),
  player: (address: string) => get<ApiPlayer>(`/api/players/${address}`),
  prices: () => get<ApiPrice[]>("/api/prices"),
};
