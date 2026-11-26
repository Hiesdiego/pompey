/**
 * Stock Meme Arena (BaseStonk), factory config, ABI, API client and helpers.
 *
 * Target location in the repo:
 *   packages/frontend/src/lib/arenaContracts.ts
 *
 * V2 REBASE (Nov 21 2026): rebased on origin/main d0834c5. The env
 * address pattern below (envAddress plus a NEXT_PUBLIC_ env var) matches
 * lib/stockMarketContracts.ts on main exactly, and the imports were
 * re-checked against main: BACKEND_API_URL from ./contracts and
 * formatUtcDateTime from ./utcTime both exist there with these names.
 * Two data-shape corrections against the backend reader
 * (backend arenaClashReader.ts) and the factory contract
 * (contracts/MemeClashFactory.sol) are marked inline where they land:
 * ClashCupLink.round is a round id string, not a number, and the
 * CREATION_SEED entry was removed from the ABI because the factory
 * exposes no such getter (the seed is the MemeClashConstants library
 * constant, pulled inside createClash).
 *
 * This is a NEW lib file for step 3 of the STOCK BUILD. It does not touch
 * lib/stockContracts.ts (the stock league stack), lib/stockMarketContracts.ts
 * (stock price target markets) or lib/marketFactory.ts (the crypto factory).
 * The MemeClashFactory is a separate deployment whose address comes from
 * NEXT_PUBLIC_ARENA_CLASH_FACTORY_ADDRESS.
 *
 * Product shape (locked Nov 20 2026):
 *   "Will [MEME] outperform [OPPONENT]?" Yes/No. The opponent defaults to
 *   the BaseStonk paired stock. A meme against another meme on the same
 *   paired stock is a derby. Yes wins only when the meme percent move is
 *   strictly greater than the opponent percent move. An exact tie is No.
 *   The window starts 1 hour after creation. Standard windows are 24
 *   hours, blitz windows are 1 hour. Staking closes at window start.
 *   Snapshots use BaseStonk priceUsd for memes and Coinbase NAV for
 *   stocks. A raw move of plus or minus 30 percent on either side voids
 *   the clash with refunds. Creation needs a liquidity floor (default
 *   5000 USD, backend config) and a 250 TICK seed pulled on creation.
 *   The Weekly Meme Cup is seeded automatically by the backend. This
 *   file only reads cup data, it never creates cup ties (cupTie is
 *   always false from the UI).
 *
 * Scoring display: the card and detail scoreline uses the league
 * formula, 1 goal per 0.5 percent, half-up, no-negative normalization,
 * exactly like the crypto league in lib/format.ts. The scoreline is a
 * display of the percent moves. The winner is decided by the strict
 * percent comparison, not by the rounded goals, so a clash can show
 * level goals and still have a winner.
 *
 * Routing: clash detail lives at /arena/clash/[id]. The data page lives
 * at /arena. Clashes also appear on /fixtures (Memes filter and the All
 * view) and on /markets (Memes filter), mirroring how stock fixtures
 * and stock markets join the shared boards.
 *
 * ABI note: the ABI below was aligned field by field against the
 * delivered MemeClashFactory.sol at build consolidation (2026-11-20):
 * createClash(memeToken, memeSymbol, opponentKind, opponentToken,
 * opponentSymbol, windowDuration, cupTie, creatorName), stake(clashId,
 * outcome, amount), claim(clashId), clashInfo (12 outputs, no
 * windowDuration on chain; it is derived as windowEnd - windowStart)
 * and clashSettlement (9 outputs: the six settlement fields, then the
 * four snapshot prices). The API summaries in this file carry the same
 * fields, so the UI never has to decode on-chain tuples for the boards.
 *
 * Prices: meme and stock snapshot prices arrive from the backend as
 * decimal strings or numbers in USD. All timestamps are UTC. Unix
 * seconds are used for windowStart, windowEnd and createdAt in the API
 * shapes, matching the stock market summaries.
 *
 * Never import from the @tickr/shared barrel. Direct module paths only.
 */

import type { Address } from "viem";
import { BACKEND_API_URL } from "./contracts";
import { formatUtcDateTime } from "./utcTime";

// ── factory address ─────────────────────────────────────────────────

function envAddress(value: string | undefined): Address | "" {
  const v = (value ?? "").trim();
  return v === "" ? "" : (v as Address);
}

/** MemeClashFactory address. "" = not configured yet (fill after deploy). */
export const ARENA_CLASH_FACTORY_ADDRESS = envAddress(
  process.env.NEXT_PUBLIC_ARENA_CLASH_FACTORY_ADDRESS
) as Address;

// ── constants ───────────────────────────────────────────────────────

/** Creation seed in whole TICK. Same 250 TICK seed as stock creation. */
export const ARENA_CREATION_SEED_TICK = 250;
/** Minimum stake on a clash. Mirrors the league and factory minimums. */
export const ARENA_MIN_STAKE_TICK = 10;
/** Standard window: 24 hours, in seconds. */
export const ARENA_WINDOW_STANDARD_SECONDS = 86_400;
/** Blitz window: 1 hour, in seconds. */
export const ARENA_WINDOW_BLITZ_SECONDS = 3_600;
/** Raw move at or beyond this on either side voids the clash. */
export const ARENA_SPIKE_LIMIT_PCT = 30;
/** Default creation liquidity floor in USD, mirrors backend config. */
export const ARENA_DEFAULT_LIQUIDITY_FLOOR_USD = 5_000;
/** Goals per percent: 1 goal per 0.5 percent, same as the crypto league. */
export const ARENA_GOAL_PCT = 0.5;

/**
 * Opponent kind for createClash. The contract takes a uint8:
 * 0 = Stock, 1 = Meme. The API uses the string form.
 */
export const ARENA_OPPONENT_KIND = {
  STOCK: 0,
  MEME: 1,
} as const;
export type ArenaOpponentKindCode =
  (typeof ARENA_OPPONENT_KIND)[keyof typeof ARENA_OPPONENT_KIND];
export type ArenaOpponentKind = "stock" | "meme";

export function opponentKindCode(kind: ArenaOpponentKind): ArenaOpponentKindCode {
  return kind === "meme" ? ARENA_OPPONENT_KIND.MEME : ARENA_OPPONENT_KIND.STOCK;
}

export function opponentKindFromCode(code: number): ArenaOpponentKind {
  return code === ARENA_OPPONENT_KIND.MEME ? "meme" : "stock";
}

// ── scoreline (league formula: 1 goal per 0.5 percent, half-up) ─────

/**
 * Round a raw percent change to goals exactly like
 * PriceOracle._roundedPercentChange in lib/format.ts: 1 goal = 0.5
 * percent, round-half-up on absolute basis points at the 25 bps
 * threshold. Returns a signed goal count, negative when price fell.
 */
export function roundPctLikeOracleArena(pct: number): number {
  const bps = Math.round(Math.abs(pct) * 100);
  const goals = Math.floor((bps + 25) / 50);
  return pct < 0 ? -goals : goals;
}

/**
 * Mirror of the league no-negative normalization: each side negative
 * goals become plus goals for the opponent. Margin preserving, so the
 * ordering of the two sides never changes.
 */
export function normalizeClashScoreline(
  memeGoals: number,
  oppGoals: number
): [number, number] {
  const meme = Math.max(0, memeGoals) + Math.max(0, -oppGoals);
  const opp = Math.max(0, oppGoals) + Math.max(0, -memeGoals);
  return [meme, opp];
}

/**
 * Full clash scoreline from two raw percent moves, using the league
 * formula. Example: meme +3 percent vs stock +1 percent gives 6-2.
 * Meme -1 percent vs opponent +2 percent gives raw goals -2 and +4,
 * normalized to 0-6.
 */
export function clashScoreline(
  memeMovePct: number,
  oppMovePct: number
): { memeGoals: number; oppGoals: number } {
  const [memeGoals, oppGoals] = normalizeClashScoreline(
    roundPctLikeOracleArena(memeMovePct),
    roundPctLikeOracleArena(oppMovePct)
  );
  return { memeGoals, oppGoals };
}

/** "6-2" style label for a clash scoreline. */
export function formatClashScoreline(memeGoals: number, oppGoals: number): string {
  return `${memeGoals}-${oppGoals}`;
}

// ── symbols and question formatter ──────────────────────────────────

/** Display symbol for a meme or opponent token: trimmed, upper case. */
export function arenaDisplaySymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** True when the window is a 1 hour blitz window. */
export function isBlitzWindow(windowDuration: number): boolean {
  return windowDuration === ARENA_WINDOW_BLITZ_SECONDS;
}

/**
 * The card and detail question, verbatim shape from the locked spec:
 * "Will [MEME] outperform [STOCK] over the next 24 hours?" Blitz
 * windows read "in the next hour" and carry a Blitz tag on the card.
 * A derby (meme opponent) uses the same sentence with the opponent
 * meme symbol, the card adds the Derby tag so the two cases read
 * apart at a glance.
 */
export function arenaClashQuestion(
  memeSymbol: string,
  opponentSymbol: string,
  opponentKind: ArenaOpponentKind,
  windowDuration: number
): string {
  const meme = arenaDisplaySymbol(memeSymbol);
  const opp = arenaDisplaySymbol(opponentSymbol);
  void opponentKind;
  if (isBlitzWindow(windowDuration)) {
    return `Will ${meme} outperform ${opp} in the next hour?`;
  }
  return `Will ${meme} outperform ${opp} over the next 24 hours?`;
}

/** Question for a clash summary, from its own fields. */
export function arenaClashQuestionFor(clash: ClashSummary): string {
  return arenaClashQuestion(
    clash.memeSymbol,
    clash.opponentSymbol,
    clash.opponentKind,
    clash.windowDuration
  );
}

/** BaseStonk token page for a meme address. */
export function baseStonkTokenUrl(memeAddress: string): string {
  return `https://basestonk.io/token/${memeAddress}`;
}

// ── backend API types (fixed contract, build against it) ────────────

/** How a registry meme is paired: a B20 stock, USDC, WETH or another token. */
export type ArenaPairType = "stock" | "usdc" | "weth" | "other";

/** Paired stock summary inside a registry meme. */
export interface ArenaPairedStock {
  address: string;
  symbol: string;
  name: string;
}

/** One row from GET /api/arena/registry. */
export interface RegistryMeme {
  address: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  imageUrl: string | null;
  pairToken: string | null;
  pairSymbol: string | null;
  pairType: ArenaPairType;
  pairedStock: ArenaPairedStock | null;
  pool: string | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  priceUsd: number | null;
  createdAt: string | null;
  creationEnabled: boolean;
  disableReason: string | null;
}

export type ClashStatus = "upcoming" | "inplay" | "settled" | "voided";

/** Cup round ids, mirroring ArenaRoundId in the backend cup service. */
export type ArenaCupRoundId = "R32" | "R16" | "QF" | "SF" | "F";

/** Human label for a cup round id, for titles and pills. */
export function cupRoundLabel(round: ArenaCupRoundId): string {
  switch (round) {
    case "R32":
      return "Round of 32";
    case "R16":
      return "Round of 16";
    case "QF":
      return "Quarter-final";
    case "SF":
      return "Semi-final";
    case "F":
      return "Final";
  }
}

/**
 * Cup link on a clash that belongs to a Weekly Meme Cup tie.
 * Correction in the v2 rebase: the old frontend typed round as a
 * number and rendered `Round ${round + 1}`, but the backend reader
 * sends the ArenaRoundId string ("R32" | "R16" | "QF" | "SF" | "F"),
 * and the backend commentary scope check compares round against "SF"
 * and "F". The string shape is the real one.
 */
export interface ClashCupLink {
  cupId: string | number;
  round: ArenaCupRoundId;
  tieIndex: number;
}

/**
 * Commentary eligibility, locked scope: lines exist only on featured
 * clashes and on Weekly Meme Cup semi-final and final ties. Mirrors
 * ArenaCommentary.inScope in the backend. The detail page renders its
 * commentary section only when this returns true.
 */
export function arenaCommentaryEligible(clash: ClashSummary): boolean {
  if (clash.featured) return true;
  return clash.cup !== null && (clash.cup.round === "SF" || clash.cup.round === "F");
}

/**
 * One clash summary from GET /api/arena/clashes. Bigint amounts arrive
 * as decimal strings, matching the stock market summaries. Snapshot
 * prices are USD numbers or decimal strings, null before the snapshot
 * exists. Percent moves are plain numbers in percent units.
 */
export interface ClashSummary {
  id: number;
  memeToken: string;
  memeSymbol: string;
  memeName: string | null;
  memeLogoUrl: string | null;
  opponentKind: ArenaOpponentKind;
  opponentToken: string;
  opponentSymbol: string;
  opponentName: string | null;
  opponentLogoUrl: string | null;
  creator: string;
  creatorName: string;
  createdAt: number;
  windowStart: number;
  windowEnd: number;
  windowDuration: number;
  cupTie: boolean;
  cup: ClashCupLink | null;
  featured: boolean;
  state: number;
  status: ClashStatus;
  seedAmount: string;
  totalStaked: string;
  outcomeTotals: string[];
  multipliers: (number | null)[] | null;
  winner: 0 | 1 | null;
  memeStartPrice: string | number | null;
  memeEndPrice: string | number | null;
  oppStartPrice: string | number | null;
  oppEndPrice: string | number | null;
  memeMovePct: number | null;
  oppMovePct: number | null;
  liveMemeMovePct: number | null;
  liveOppMovePct: number | null;
  liveMemeGoals: number | null;
  liveOppGoals: number | null;
}

/** One commentary line on a featured or cup semi-final or final clash. */
export interface ArenaCommentaryLine {
  voice: string;
  kind: string;
  line: string;
  createdAt: string;
}

/** The connected user position on a clash detail, when present. */
export interface ArenaUserPosition {
  address: string;
  yesStake: string;
  noStake: string;
  claimed: boolean;
  claimable: string | null;
}

/** Detail shape from GET /api/arena/clashes/:id. */
export interface ClashDetail extends ClashSummary {
  commentary: ArenaCommentaryLine[];
}

/** Raw detail envelope before the user position is split out. */
export interface ClashDetailResponse {
  clash: ClashDetail;
  userPosition?: ArenaUserPosition | null;
}

/** One row from GET /api/arena/rankings. Cup matches only. */
export interface RankingRow {
  rank: number;
  address: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  points: number;
  wins: number;
  losses: number;
  appearances: number;
  titles: number;
  runnerUps: number;
}

/** One row from GET /api/arena/cups. */
export interface CupHistory {
  id: string | number;
  weekStart: string;
  status: string;
  fieldSize: number;
  bracketSize: number;
  champion: RankingSide | null;
  runnerUp: RankingSide | null;
}

/** A meme side in a cup tie or a cup result. */
export interface RankingSide {
  address: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
}

/** One tie in the current cup bracket. */
export interface CupTie {
  tieIndex: number;
  seedA: number | null;
  seedB: number | null;
  memeA: RankingSide | null;
  memeB: RankingSide | null;
  clashId: number | null;
  winner: string | null;
  status: string;
}

/** One round in the current cup bracket. */
export interface CupRound {
  round: number;
  ties: CupTie[];
}

/** Shape from GET /api/arena/cups/current. */
export interface CupBracket {
  id: string | number;
  weekStart: string;
  status: string;
  rounds: CupRound[];
}

// ── backend API client ──────────────────────────────────────────────

export class ArenaApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function arenaGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_API_URL}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new ArenaApiError(
      0,
      timedOut
        ? "Arena request timed out. Check the backend logs."
        : "Backend unreachable, is it running?"
    );
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) detail = String(body.error);
      else if (body?.message) detail = String(body.message);
    } catch {
      /* ignore */
    }
    throw new ArenaApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

function normalizeClash(raw: ClashSummary): ClashSummary {
  return {
    ...raw,
    outcomeTotals: raw.outcomeTotals ?? ["0", "0"],
    multipliers: raw.multipliers ?? null,
    cup: raw.cup ?? null,
    ...commentarySafe(raw),
  } as ClashSummary;
}

// Small helper kept separate so normalizeClash stays readable. It only
// passes through fields that already exist on the summary shape.
function commentarySafe(raw: ClashSummary): Partial<ClashSummary> {
  return {
    memeStartPrice: raw.memeStartPrice ?? null,
    memeEndPrice: raw.memeEndPrice ?? null,
    oppStartPrice: raw.oppStartPrice ?? null,
    oppEndPrice: raw.oppEndPrice ?? null,
    memeMovePct: raw.memeMovePct ?? null,
    oppMovePct: raw.oppMovePct ?? null,
    liveMemeMovePct: raw.liveMemeMovePct ?? null,
    liveOppMovePct: raw.liveOppMovePct ?? null,
    liveMemeGoals: raw.liveMemeGoals ?? null,
    liveOppGoals: raw.liveOppGoals ?? null,
  };
}

/**
 * Arena API. Endpoints are fixed by the backend contract:
 *   GET /api/arena/registry        -> { memes: RegistryMeme[] }
 *   GET /api/arena/registry/search -> { memes: RegistryMeme[] }
 *   GET /api/arena/clashes         -> { ok, data: { clashes, asOfBlock, refreshedAt } }
 *   GET /api/arena/clashes/:id     -> { ok, data: { clash, userPosition? } }
 *   GET /api/arena/rankings        -> { ok, data: { rankings, updatedAt } }
 *   GET /api/arena/cups            -> { ok, data: { cups } }
 *   GET /api/arena/cups/current    -> { ok, data: { cup } }
 * Every unwrapper accepts both the enveloped shape ({ ok, data }) and
 * a bare shape, so a small envelope difference never blanks a board,
 * mirroring the stock market client.
 */
export const arenaApi = {
  registry: async (): Promise<RegistryMeme[]> => {
    const data = await arenaGet<
      | { memes: RegistryMeme[] }
      | { ok: boolean; data: { memes: RegistryMeme[] } }
      | RegistryMeme[]
    >("/api/arena/registry");
    if (Array.isArray(data)) return data;
    if ("data" in data && data.data) return data.data.memes ?? [];
    return (data as { memes: RegistryMeme[] }).memes ?? [];
  },
  registrySearch: async (q: string): Promise<RegistryMeme[]> => {
    const data = await arenaGet<
      | { memes: RegistryMeme[] }
      | { ok: boolean; data: { memes: RegistryMeme[] } }
      | RegistryMeme[]
    >(`/api/arena/registry/search?q=${encodeURIComponent(q)}`);
    if (Array.isArray(data)) return data;
    if ("data" in data && data.data) return data.data.memes ?? [];
    return (data as { memes: RegistryMeme[] }).memes ?? [];
  },
  registryByAddress: async (address: string): Promise<RegistryMeme | null> => {
    const data = await arenaGet<{ meme: RegistryMeme }>(
      `/api/arena/registry/address/${encodeURIComponent(address)}`
    );
    return data.meme ?? null;
  },
  clashes: async (): Promise<{ clashes: ClashSummary[]; asOfBlock: string | null; refreshedAt: string | null }> => {
    const data = await arenaGet<
      | { ok: boolean; data: { clashes: ClashSummary[]; asOfBlock?: string; refreshedAt?: string } }
      | { clashes: ClashSummary[]; asOfBlock?: string; refreshedAt?: string }
      | ClashSummary[]
    >("/api/arena/clashes");
    const payload = Array.isArray(data)
      ? { clashes: data, asOfBlock: undefined, refreshedAt: undefined }
      : "data" in data && data.data
        ? data.data
        : (data as { clashes: ClashSummary[]; asOfBlock?: string; refreshedAt?: string });
    return {
      clashes: (payload.clashes ?? []).map(normalizeClash),
      asOfBlock: payload.asOfBlock ?? null,
      refreshedAt: payload.refreshedAt ?? null,
    };
  },
  clash: async (
    id: string | number | bigint,
    address?: string | null
  ): Promise<ClashDetailResponse> => {
    const query = address ? `?address=${encodeURIComponent(address)}` : "";
    const data = await arenaGet<
      | { ok: boolean; data: { clash: ClashDetail; userPosition?: ArenaUserPosition | null } }
      | { clash: ClashDetail; userPosition?: ArenaUserPosition | null }
      | ClashDetail
    >(`/api/arena/clashes/${id.toString()}${query}`);
    const payload =
      "data" in data && (data as { data?: unknown }).data
        ? (data as { data: { clash: ClashDetail; userPosition?: ArenaUserPosition | null } }).data
        : "clash" in data
          ? (data as { clash: ClashDetail; userPosition?: ArenaUserPosition | null })
          : { clash: data as ClashDetail, userPosition: null };
    const clash = payload.clash;
    return {
      clash: {
        ...normalizeClash(clash),
        commentary: clash.commentary ?? [],
      } as ClashDetail,
      userPosition: payload.userPosition ?? null,
    };
  },
  rankings: async (): Promise<{ rankings: RankingRow[]; updatedAt: string | null }> => {
    const data = await arenaGet<
      | { ok: boolean; data: { rankings: RankingRow[]; updatedAt?: string } }
      | { rankings: RankingRow[]; updatedAt?: string }
      | RankingRow[]
    >("/api/arena/rankings");
    if (Array.isArray(data)) return { rankings: data, updatedAt: null };
    const payload =
      "data" in data && data.data
        ? data.data
        : (data as { rankings: RankingRow[]; updatedAt?: string });
    return { rankings: payload.rankings ?? [], updatedAt: payload.updatedAt ?? null };
  },
  cups: async (): Promise<CupHistory[]> => {
    const data = await arenaGet<
      | { ok: boolean; data: { cups: CupHistory[] } }
      | { cups: CupHistory[] }
      | CupHistory[]
    >("/api/arena/cups");
    if (Array.isArray(data)) return data;
    if ("data" in data && data.data) return data.data.cups ?? [];
    return (data as { cups: CupHistory[] }).cups ?? [];
  },
  currentCup: async (): Promise<CupBracket | null> => {
    const data = await arenaGet<
      | { ok: boolean; data: { cup: CupBracket | null } }
      | { cup: CupBracket | null }
      | CupBracket
      | null
    >("/api/arena/cups/current");
    if (data === null) return null;
    if ("data" in data) return data.data?.cup ?? null;
    if ("cup" in data) return (data as { cup: CupBracket | null }).cup ?? null;
    return data as CupBracket;
  },
};

// ── MemeClashFactory ABI ────────────────────────────────────────────

/**
 * Minimal ABI, only what the frontend calls. Built to the brief spec.
 * createClash pulls the 250 TICK seed on creation, so the create page
 * approves the seed to the factory first, exactly like stock creation.
 * stake takes (clashId, outcome, amount) with outcome 0 = Yes and
 * 1 = No. claim takes (clashId) and pays a settled win or refunds a
 * voided stake, following the pool claim pattern.
 */
export const MEME_CLASH_FACTORY_ABI = [
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
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "clashId", type: "uint256" }],
    outputs: [],
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
  { type: "error", name: "BettingClosed", inputs: [{ name: "clashId", type: "uint256" }] },
  { type: "error", name: "AlreadySettled", inputs: [{ name: "clashId", type: "uint256" }] },
  {
    type: "error",
    name: "NothingToClaim",
    inputs: [
      { name: "clashId", type: "uint256" },
      { name: "user", type: "address" },
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
  {
    type: "event",
    name: "FeesUpdated",
    inputs: [
      { name: "treasuryFeeBps", type: "uint16", indexed: false },
      { name: "creatorFeeBps", type: "uint16", indexed: false },
      { name: "resolverFeeBps", type: "uint16", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TreasuryUpdated",
    inputs: [{ name: "treasury", type: "address", indexed: false }],
  },
  {
    type: "event",
    name: "ResolverUpdated",
    inputs: [{ name: "resolver", type: "address", indexed: false }],
  },
] as const;

/** Normalized on-chain clashInfo, tolerant of tuple or named returns. */
export interface ArenaClashInfoResult {
  memeToken: string;
  memeSymbol: string;
  opponentKind: ArenaOpponentKind;
  opponentToken: string;
  opponentSymbol: string;
  creator: string;
  creatorName: string;
  createdAt: bigint;
  windowStart: bigint;
  windowEnd: bigint;
  windowDuration: bigint;
  cupTie: boolean;
  outcomeCount: number;
}

export function normalizeArenaClashInfo(raw: unknown): ArenaClashInfoResult {
  const result = raw as Partial<ArenaClashInfoResult> &
    readonly unknown[] & { opponentKind?: number };
  const code = (result.opponentKind ?? result[2] ?? 0) as unknown as number;
  return {
    memeToken: (result.memeToken ?? result[0] ?? "") as string,
    memeSymbol: (result.memeSymbol ?? result[1] ?? "") as string,
    opponentKind: opponentKindFromCode(Number(code)),
    opponentToken: (result.opponentToken ?? result[3] ?? "") as string,
    opponentSymbol: (result.opponentSymbol ?? result[4] ?? "") as string,
    creator: (result.creator ?? result[5] ?? "") as string,
    creatorName: (result.creatorName ?? result[6] ?? "") as string,
    createdAt: (result.createdAt ?? result[7]) as bigint,
    windowStart: (result.windowStart ?? result[8]) as bigint,
    windowEnd: (result.windowEnd ?? result[9]) as bigint,
    // The factory does not return windowDuration; it is windowEnd - windowStart.
    windowDuration: (result.windowDuration ??
      ((result.windowEnd ?? result[9]) as bigint) -
        ((result.windowStart ?? result[8]) as bigint)) as bigint,
    cupTie: (result.cupTie ?? result[10]) as boolean,
    outcomeCount: (result.outcomeCount ?? result[11]) as number,
  };
}

export type ArenaClashState = 0 | 1 | 2; // Open | Resolved | Voided
export const ARENA_CLASH_STATE_NAMES: Record<number, string> = {
  0: "Open",
  1: "Resolved",
  2: "Voided",
};

/** UTC window label for cards, for example the start and end together. */
export function arenaWindowLabel(clash: ClashSummary): string {
  return `${formatUtcDateTime(clash.windowStart * 1000)} to ${formatUtcDateTime(clash.windowEnd * 1000)}`;
}
