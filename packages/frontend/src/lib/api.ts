/**
 * Typed client for the TICKR backend REST API (spec P2.7).
 * Base URL: NEXT_PUBLIC_BACKEND_API_URL. BigInts arrive as strings.
 */

import { BACKEND_API_URL } from "./contracts";

export interface ApiTeam {
  teamId: number;
  name: string;
  symbol: string;
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
  kickoffRevealed: boolean;
  settled: boolean;
}

export interface ApiPool {
  seasonId: string;
  fixtureId: string;
  totalHome: string;
  totalDraw: string;
  totalAway: string;
  totalPool: string;
  settled: boolean;
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

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_API_URL}${path}`, { cache: "no-store" });
  } catch (err) {
    throw new ApiError(0, `Backend unreachable at ${BACKEND_API_URL} — is it running?`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) detail = String(body.error);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
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
