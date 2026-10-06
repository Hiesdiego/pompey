/**
 * Typed client for the TICKR social layer API (profiles, predictions, markets,
 * leaderboard, analytics) — v0.1, same-origin edition.
 *
 * The social backend now lives in Next.js Route Handlers under
 * /api/social/*, so this client calls relative URLs: no base URL, no CORS.
 * Conventions mirror lib/api.ts: 30s abort timeout on writes, coded errors.
 * Amount fields mirror the indexer's raw 18-decimal integer units. Addresses are lowercase hex.
 *
 * Resilience: no `cache: "no-store"` — caching is the data layer's job
 * (React Query + the route handlers' `revalidate` windows). All failures
 * throw CodedError (lib/errors) — never infrastructure wording.
 */

import { CodedError, toAppError, type ErrorCode } from "./errors";

export type PredictionStatusFilter = "all" | "open" | "settled";
export type MarketState = "open" | "resolved" | "voided";

export interface SocialProfileStats {
  marketsBacked: number;
  openMarkets: number;
  resolvedMarkets: number;
  voidedMarkets: number;
  marketsCreated: number;
}

export interface SocialProfile {
  walletAddress: string;
  username: string;
  favouriteTeamId: number;
  bio: string;
  stats: SocialProfileStats;
  seasonId: number;
}

/** Own profile: public fields + edit permissions for the current season. */
export interface MyProfile extends SocialProfile {
  canEditUsername: boolean;
  canEditTeam: boolean;
  usernameLockedUntil: string | null;
  teamLockedUntil: string | null;
  currentSeasonId: number;
}

export interface SocialPrediction {
  stakeId: number;
  marketId: number;
  templateId: number;
  params: string; // 0x hex abi-encoded template params
  outcome: number;
  amountTick: string | null; // private; null on public profile views
  oddsBps: number | null; // implied win probability (bps) at stake time
  status: MarketState;
  won: boolean | null;
  pnlTick: string | null; // raw 18-decimal integer units, null until settled
  stakedAt: string; // ISO
  creatorName: string;
}

export interface SocialMarket {
  marketId: number;
  templateId: number;
  params: string;
  creatorName: string;
  state: MarketState;
  totalStakedTick: string; // raw 18-decimal integer units
  bettors: number;
  bettingCloseTime: string; // ISO
  endTime: string; // ISO
}

export interface PnlPoint {
  t: string; // ISO
  cumPnlTick: string; // raw 18-decimal integer units
}

export interface TemplateWinRate {
  templateId: number;
  profitable: number;
  resolved: number;
}

export interface SocialAnalytics {
  netPnlTick: string;
  volumeTick: string;
  resolvedStakeTick: string;
  openStakeTick: string;
  resolvedMarkets: number;
  profitableMarkets: number;
  incompleteSettlements: number;
  undatedSettlements: number;
  bestMarketTick: string | null;
  worstMarketTick: string | null;
  pnlCurve: PnlPoint[];
  byTemplate: TemplateWinRate[];
  recentResults: Array<{ marketId: string; templateId: number; stakeTick: string; netTick: string; resolvedAt: string }>;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: number | null;
}

export type TokenGetter = () => Promise<string | null>;

const SOCIAL_API_TIMEOUT_MS = 30_000;

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

async function request<T>(
  path: string,
  init?: RequestInit,
  getToken?: TokenGetter
): Promise<T> {
  const headers: Record<string, string> = {};
  if (getToken) {
    const token = await getToken();
    if (!token) throw new CodedError("UNKNOWN", "Sign in to continue.");
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (init?.body != null) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, {
      signal: AbortSignal.timeout(SOCIAL_API_TIMEOUT_MS),
      ...init,
      headers: { ...headers, ...((init?.headers as Record<string, string> | undefined) ?? {}) },
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new CodedError(timedOut ? "TIMEOUT" : "BACKEND_UNAVAILABLE");
  }
  if (!res.ok) {
    if (res.status === 404) throw new ApiError(404, "NOT_FOUND");
    if (res.status === 401) throw new ApiError(401, "UNKNOWN", "Sign in to continue.");
    // Normalize via the shared taxonomy; the raw body is never surfaced.
    throw toAppError({ ok: false, code: "query_failed" });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string): Promise<T> => request<T>(path);
const authedGet = <T>(path: string, getToken: TokenGetter): Promise<T> =>
  request<T>(path, undefined, getToken);

export interface ClaimProfileInput {
  walletAddress: string;
  username?: string;
  favouriteTeamId?: number;
  bio?: string;
}

export const social = {
  /** Public profile by username (case-insensitive). Throws 404-coded error when unknown. */
  profile: (username: string) =>
    get<SocialProfile>(`/api/social/profiles/${encodeURIComponent(username)}`),

  /** Public profile by wallet address. Throws 404-coded error when unknown. */
  profileByWallet: (address: string) =>
    get<SocialProfile>(`/api/social/profiles/by-wallet/${address}`),

  /** Own full profile incl. edit permissions. Returns null when no profile claimed yet. */
  me: async (walletAddress: string, getToken: TokenGetter): Promise<MyProfile | null> => {
    try {
      return await authedGet<MyProfile>(
        `/api/social/profiles/me?walletAddress=${walletAddress}`,
        getToken
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },

  /** Claim a new profile or update username/team/bio (season-gated server-side). */
  saveProfile: (input: ClaimProfileInput, getToken: TokenGetter) =>
    request<MyProfile>(
      "/api/social/profiles/me",
      { method: "PUT", body: JSON.stringify(input) },
      getToken
    ),

  /** Paginated predictions for a username. */
  predictions: (
    username: string,
    status: PredictionStatusFilter = "all",
    limit = 25,
    cursor?: number | null,
    getToken?: TokenGetter
  ) =>
    request<PageResult<SocialPrediction>>(
      `/api/social/profiles/${encodeURIComponent(username)}/predictions?status=${status}&limit=${limit}${cursor != null ? `&cursor=${cursor}` : ""}`,
      undefined,
      getToken
    ),

  /** Paginated created markets for a username. */
  createdMarkets: (
    username: string,
    status: PredictionStatusFilter = "all",
    limit = 25,
    cursor?: number | null
  ) =>
    get<PageResult<SocialMarket>>(
      `/api/social/profiles/${encodeURIComponent(username)}/markets?status=${status}&limit=${limit}${cursor != null ? `&cursor=${cursor}` : ""}`
    ),

  /** Owner-only analytics (address must be linked to the caller's Privy user). */
  analytics: (walletAddress: string, season: number, getToken: TokenGetter) =>
    authedGet<SocialAnalytics>(
      `/api/social/analytics?walletAddress=${walletAddress}&season=${season}`,
      getToken
    ),

};
