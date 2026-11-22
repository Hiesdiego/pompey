/**
 * Arena registry service: the dynamic BaseStonk meme registry.
 *
 * Intended destination: packages/backend/src/services/arenaRegistryService.ts.
 * Mirrors services/stockListService.ts (StockListService) pattern for
 * pattern:
 *   - EventEmitter with an in-memory cache served synchronously. A
 *     request NEVER triggers an upstream call: getMemes() is a
 *     synchronous read of the cache, exactly like getStocks().
 *   - Failures back off exponentially (cap 10 min) and keep serving
 *     the last good cache. A failed poll never clears the cache.
 *   - Every call and every response byte is counted on the shared
 *     bandwidth meter (lib/net.ts). The user has a 1 GB/month
 *     bandwidth hard cap.
 *
 * THE SOURCE (verified live 2026-11-20): BaseStonk's REST API is open,
 * free and needs no key. GET /api/v1/launchpad/tokens with params
 * chain=base, sort, dir, q, pair, limit, offset, view answers
 * { sort, total, hasNext, tokens: [...] } (the body also duplicates
 * the page under `items`; `tokens` is the field read here). The
 * shared lane is rated at 1,500 units per 5 minutes. NO webhooks
 * exist, so launch watching is polling, which is what this service is.
 *
 * VIEW CHOICE (verified live 2026-11-20 against both views): view=list
 * DOES carry every field the bulk polls need (priceUsd, liquidityUsd,
 * volume24hUsd, pairToken, createdAt, holders, marketcapUsd), so the
 * volume and trending pages use view=list. view=list drops logoUrl and
 * pool, so the NEWEST page uses view=full (it is the launch detector
 * and the enrichment source), logoUrl falls back to the documented
 * derived URL https://api.basestonk.io/api/img/{address}?chain=base,
 * and pool falls back to the record's venue field, which equals the
 * pool address on live records.
 *
 * ONE POLL = THREE PAGES, merged into the cache by address:
 *   - newest (sort=age, dir=desc, limit 50, view=full): launch
 *     detection plus full records for the freshest tokens.
 *   - volume (sort=volume, dir=desc, limit 50, view=list): fresh
 *     volume, liquidity and price for the tokens that matter for
 *     qualification and the cup tiebreak.
 *   - trending (sort=trending, dir=desc, limit 50, view=list): cheap
 *     extra freshness for whatever the platform is surfacing.
 * A token absent from a later poll is NOT evicted: the registry is a
 * directory of everything ever seen this process lifetime, and the
 * cup's trailing-volume maths needs the full field. Prices on tokens
 * outside the three pages go stale between polls; that is accepted,
 * because snapshots and resolutions only ever read tokens that are in
 * an active clash, and active-clash tokens are by construction liquid
 * and high-volume, so they sit on the volume page.
 *
 * PAIRED STOCK RESOLUTION: a token's pairToken is an ADDRESS. When it
 * is a B20 stock, the injected StockListService.getStockByAddress
 * resolves it to { address, symbol, name } (the pairedStock). The
 * pair-identity endpoint is used ONLY as a cached fallback for the
 * pair's symbol and name (pairSymbol), never per poll per token: the
 * identity cache is filled lazily, at most a handful of lookups per
 * poll, and a pair identity never changes.
 *
 * NEW-LAUNCH DETECTION: addresses never seen since boot are new. The
 * boot sync marks every token as seen EXCEPT tokens created within
 * the last 2 hours, which are treated as new, so a restart inside the
 * launch window still emits their debut events. Each new token emits
 * exactly one "launch" event, after the cache merge, so listeners
 * (the keeper's debut loop) read the merged entry.
 *
 * PAIR TYPE AND SEARCH: every entry carries pairType, derived in
 * decorate() from pairToken at pairing-resolution time ("stock"
 * when pairToken resolves to a B20 stock, else "usdc", "weth" or
 * "other"). The user-triggered searchMemes() is the one search path
 * beyond the poll pages: it queries the full BaseStonk catalogue
 * with q, merges the hits into the cache and returns them in API
 * order. It never emits "launch" or "memes" events and never
 * touches the poll timer, backoff, status or lastPoll stats.
 *
 * DAILY VOLUME SNAPSHOTS: on the first poll after each UTC midnight,
 * every cached meme's volume24hUsd and liquidityUsd are written to
 * Supabase arena_volume_snapshots (address, day, volume24h_usd,
 * liquidity_usd), one row per meme per day. The cup service sums
 * these rows into the trailing 7-day volume used for qualification.
 * The write is best-effort: a Supabase outage logs and retries on the
 * next poll, it never blocks the registry.
 */

import { EventEmitter } from "node:events";
import type { SupabaseClient } from "@supabase/supabase-js";
import { arenaConfig } from "../arenaConfig.js";
import { logger } from "../lib/logger.js";
import { meter } from "../lib/net.js";
import type { StockListService } from "./stockListService.js";

/** The paired stock identity for a meme, from the stock list service. */
export interface ArenaPairedStock {
  address: string;
  symbol: string;
  name: string;
}

/** The kind of token a meme is paired with, derived from pairToken. */
export type ArenaPairType = "stock" | "usdc" | "weth" | "other";

/** One registry row, the shape served to the arena routes. */
export interface ArenaRegistryEntry {
  /** Meme token contract on Base, as returned by the API. */
  address: string;
  symbol: string;
  name: string;
  /** BaseStonk logo URL (full view), or the derived img URL. */
  logoUrl: string;
  /** Token image URL from the API, or null. */
  imageUrl: string | null;
  /** The pair token ADDRESS (a B20 stock, USDC, WETH, or another meme). */
  pairToken: string;
  /** Pair symbol from pair-identity or the stock list, or null. */
  pairSymbol: string | null;
  /** The paired B20 stock when pairToken resolves in the stock list,
   *  else null (USDC/WETH pairs and meme pairs have no paired stock). */
  pairedStock: ArenaPairedStock | null;
  /** Pair kind derived at pairing-resolution time from pairToken:
   *  "stock" when pairToken resolves to a B20 stock, else "usdc"
   *  for the USDC pair address, "weth" for the WETH pair address,
   *  or "other" for anything else. */
  pairType: ArenaPairType;
  /** Pool (or venue) address, or null when unknown. */
  pool: string | null;
  liquidityUsd: number;
  volume24hUsd: number;
  holders: number;
  /** Live price in USD, or null when the API reports no usable price
   *  (zero or missing). A missing price is never a zero price. */
  priceUsd: number | null;
  /** Launch time (ms since epoch) from createdAt. */
  createdAt: number;
  /** True when a clash may be created against this meme right now. */
  creationEnabled: boolean;
  /** Why creation is disabled, or null when enabled. */
  disableReason: string | null;
}

export interface ArenaRegistryMeterStats {
  calls: number;
  bytes: number;
  errors: number;
  lastPollAtMs: number | null;
  lastPollOk: boolean;
}

interface ArenaRegistryEventMap {
  launch: (entry: ArenaRegistryEntry) => void;
  memes: (entries: ArenaRegistryEntry[]) => void;
  status: (status: "polling" | "idle" | "error", detail?: string) => void;
}

/** Raw token shape from the BaseStonk launchpad API. Numeric fields
 *  arrive as JSON numbers; anything unexpected is treated as missing,
 *  never defaulted into a price. */
interface ApiToken {
  address?: string;
  symbol?: string;
  name?: string;
  imageUrl?: string | null;
  logoUrl?: string | null;
  pairToken?: string;
  pool?: string | null;
  venue?: string | null;
  liquidityUsd?: number | string | null;
  volume24hUsd?: number | string | null;
  priceUsd?: number | string | null;
  holders?: number | string | null;
  marketcapUsd?: number | string | null;
  createdAt?: string | null;
}

interface PairIdentity {
  symbol: string | null;
  name: string | null;
}

const MAX_BACKOFF_MS = 10 * 60_000;
/** USDC on Base, lowercase: the pair token for USDC-paired memes. */
const USDC_PAIR_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/** WETH on Base, lowercase: the pair token for WETH-paired memes. */
const WETH_PAIR_ADDRESS = "0x4200000000000000000000000000000000000006";
/** Results returned by one user-triggered catalogue search. */
const SEARCH_LIMIT = 25;

/**
 * The pair kind for a meme: "stock" when pairToken resolved to a
 * B20 stock, else "usdc" or "weth" when pairToken is that pair
 * address (compared case-insensitively), else "other". Pure:
 * exported for tests.
 */
export function pairTypeFor(pairToken: string, hasPairedStock: boolean): ArenaPairType {
  if (hasPairedStock) return "stock";
  const pair = pairToken.toLowerCase();
  if (pair === USDC_PAIR_ADDRESS) return "usdc";
  if (pair === WETH_PAIR_ADDRESS) return "weth";
  return "other";
}
/** Pair-identity lookups per poll (runaway guard; identities are
 *  cached forever once fetched, so this only bites on the first polls). */
const MAX_IDENTITY_LOOKUPS_PER_POLL = 10;

function num(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function priceOrNull(value: number | string | null | undefined): number | null {
  const n = num(value);
  return n > 0 ? n : null;
}

/** The documented derived logo URL for a token with no logoUrl. */
export function basestonkLogoUrl(address: string, baseUrl: string = arenaConfig.basestonk.baseUrl): string {
  return `${baseUrl.replace(/\/$/, "")}/api/img/${address}?chain=${arenaConfig.basestonk.chain}`;
}

/**
 * Parse one BaseStonk token record into the registry's internal row.
 * Pure: exported for tests. Records missing an address or a symbol
 * are skipped (they can never be clashed). pairedStock, pairSymbol
 * and the creation gate are applied by the service, which owns the
 * stock list lookup and the floor; this parser only normalizes.
 */
export function parseBasestonkToken(raw: unknown): Omit<ArenaRegistryEntry, "pairedStock" | "pairSymbol" | "pairType" | "creationEnabled" | "disableReason"> | null {
  const token = raw as ApiToken;
  if (!token || typeof token.address !== "string" || typeof token.symbol !== "string") {
    return null;
  }
  const createdAtMs = typeof token.createdAt === "string" ? Date.parse(token.createdAt) : NaN;
  return {
    address: token.address,
    symbol: token.symbol,
    name: typeof token.name === "string" && token.name !== "" ? token.name : token.symbol,
    logoUrl: typeof token.logoUrl === "string" && token.logoUrl !== "" ? token.logoUrl : basestonkLogoUrl(token.address),
    imageUrl: typeof token.imageUrl === "string" && token.imageUrl !== "" ? token.imageUrl : null,
    pairToken: typeof token.pairToken === "string" ? token.pairToken : "",
    pool: typeof token.pool === "string" && token.pool !== "" ? token.pool
      : typeof token.venue === "string" && token.venue !== "" ? token.venue
      : null,
    liquidityUsd: num(token.liquidityUsd),
    volume24hUsd: num(token.volume24hUsd),
    holders: Math.trunc(num(token.holders)),
    priceUsd: priceOrNull(token.priceUsd),
    createdAt: Number.isFinite(createdAtMs) ? createdAtMs : 0,
  };
}

/** Parse a full BaseStonk list response body ({ tokens, ... }). */
export function parseBasestonkResponse(body: unknown): Array<Omit<ArenaRegistryEntry, "pairedStock" | "pairSymbol" | "pairType" | "creationEnabled" | "disableReason">> {
  const tokens = (body as { tokens?: unknown[] } | null)?.tokens;
  if (!Array.isArray(tokens)) return [];
  const out: Array<Omit<ArenaRegistryEntry, "pairedStock" | "pairSymbol" | "pairType" | "creationEnabled" | "disableReason">> = [];
  for (const raw of tokens) {
    const parsed = parseBasestonkToken(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ---------------------------------------------------------- the service

export interface ArenaRegistryDeps {
  /** The dynamic stock list, for paired-stock resolution. Optional:
   *  without it every pairedStock is null and stock clashes cannot be
   *  created, but the registry itself still works. */
  stockList?: StockListService | null;
  /** Supabase (service role) for the daily volume snapshots. Optional:
   *  without it snapshots are skipped and the cup cannot qualify on
   *  trailing volume. */
  db?: SupabaseClient | null;
}

export class ArenaRegistryService extends EventEmitter {
  private readonly baseUrl: string;
  private readonly pollMs: number;
  private readonly db: SupabaseClient | null;
  private readonly stockList: StockListService | null;
  /** The merged cache, keyed by lowercase address. */
  private readonly byAddress = new Map<string, ArenaRegistryEntry>();
  /** Addresses seen since boot (launch detection). */
  private readonly seen = new Set<string>();
  private booted = false;
  /** Pair-identity cache, keyed by lowercase pair address. */
  private readonly pairIdentities = new Map<string, PairIdentity>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private backoffMs: number;
  /** UTC day (YYYY-MM-DD) of the last volume snapshot write. */
  private lastSnapshotDay: string | null = null;
  private readonly meterStats: ArenaRegistryMeterStats = {
    calls: 0,
    bytes: 0,
    errors: 0,
    lastPollAtMs: null,
    lastPollOk: false,
  };

  constructor(deps: ArenaRegistryDeps = {}, pollMs: number = arenaConfig.registry.pollMinutes * 60_000) {
    super();
    this.baseUrl = arenaConfig.basestonk.baseUrl.replace(/\/$/, "");
    this.pollMs = pollMs;
    this.db = deps.db ?? null;
    this.stockList = deps.stockList ?? null;
    this.backoffMs = pollMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info("[ArenaRegistry] starting", { baseUrl: this.baseUrl, pollMs: this.pollMs });
    this.setStatus("idle");
    void this.poll().catch(() => {});
    this.armTimer(this.pollMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Synchronous in-memory read: the request path never awaits the
   *  network and never triggers an upstream call. Sorted by 24h
   *  volume descending, the order the arena pages want. */
  getMemes(): ArenaRegistryEntry[] {
    return [...this.byAddress.values()]
      .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
      .map((e) => ({ ...e, pairedStock: e.pairedStock ? { ...e.pairedStock } : null }));
  }

  getMemeByAddress(address: string): ArenaRegistryEntry | undefined {
    const entry = this.byAddress.get(address.toLowerCase());
    return entry ? { ...entry, pairedStock: entry.pairedStock ? { ...entry.pairedStock } : null } : undefined;
  }

  /** Current live price for snapshots, or null when the meme is
   *  unknown or has no usable price. Never a zero. */
  getPriceUsd(address: string): number | null {
    return this.byAddress.get(address.toLowerCase())?.priceUsd ?? null;
  }

  /**
   * Feed health, identical semantics to StockListService.isFeedHealthy:
   * true only when the last poll SUCCEEDED and landed within
   * `withinMs` (default 30 min, two registry polls).
   */
  isFeedHealthy(withinMs: number = 30 * 60_000, now: number = Date.now()): boolean {
    return (
      this.meterStats.lastPollOk &&
      this.meterStats.lastPollAtMs !== null &&
      now - this.meterStats.lastPollAtMs <= withinMs
    );
  }

  getMeter(): ArenaRegistryMeterStats {
    return { ...this.meterStats };
  }

  /** One-shot poll (gap-fill). Never touches the poll timer. */
  async pollNow(): Promise<void> {
    await this.poll();
  }

  /**
   * User-triggered full-catalogue search: query BaseStonk with q,
   * merge the hits into the cache, resolve their pairs, and return
   * the decorated entries in the API's result order. This is the
   * only registry read that makes an upstream call, and it happens
   * only when a user searches. It never emits "launch" or "memes"
   * events and never touches the poll timer, backoff, status or
   * lastPoll stats; the shared API call metering in fetchSearchPage
   * is the only stats effect. ingestTokens still marks the hits as
   * seen, on purpose: a later poll must not treat a searched old
   * token as a new launch.
   */
  async searchMemes(query: string): Promise<ArenaRegistryEntry[]> {
    const rows = await this.fetchSearchPage(query.trim());
    this.ingestTokens(rows);
    await this.fillPairIdentities();
    this.redecorateAll();
    return rows
      .map((row) => this.getMemeByAddress(row.address))
      .filter((entry): entry is ArenaRegistryEntry => entry !== undefined);
  }

  /**
   * Merge already-fetched token records into the cache, resolve pairs,
   * apply the creation gate, and return the entries that are NEW
   * (never seen since boot). Split out of poll() so the merge and
   * launch logic is testable without the network. Boot semantics: the
   * first ingest marks everything seen EXCEPT tokens created within
   * the boot window, which are returned as new.
   */
  ingestTokens(
    rows: Array<Omit<ArenaRegistryEntry, "pairedStock" | "pairSymbol" | "pairType" | "creationEnabled" | "disableReason">>,
    nowMs: number = Date.now()
  ): ArenaRegistryEntry[] {
    const fresh: ArenaRegistryEntry[] = [];
    for (const row of rows) {
      const key = row.address.toLowerCase();
      const entry = this.decorate(row);
      this.byAddress.set(key, entry);
      if (!this.seen.has(key)) {
        this.seen.add(key);
        const isBootAncient = !this.booted && nowMs - entry.createdAt > arenaConfig.registry.bootNewWindowMs;
        if (!isBootAncient) fresh.push(entry);
      }
    }
    this.booted = true;
    return fresh;
  }

  /** Apply paired-stock resolution, the pair symbol and the creation
   *  gate to one normalized row. */
  private decorate(
    row: Omit<ArenaRegistryEntry, "pairedStock" | "pairSymbol" | "pairType" | "creationEnabled" | "disableReason">
  ): ArenaRegistryEntry {
    const stock = row.pairToken ? this.stockList?.getStockByAddress(row.pairToken) : undefined;
    const pairedStock: ArenaPairedStock | null = stock
      ? { address: stock.contractAddress, symbol: stock.symbol, name: stock.name }
      : null;
    const identity = row.pairToken ? this.pairIdentities.get(row.pairToken.toLowerCase()) : undefined;
    const pairSymbol = pairedStock ? pairedStock.symbol : identity?.symbol ?? null;
    const pairType = pairTypeFor(row.pairToken, pairedStock !== null);

    // An opponent exists when the meme has a paired stock, or when any
    // OTHER cached meme shares the same pair token (a derby).
    let hasOpponent = pairedStock !== null;
    if (!hasOpponent && row.pairToken) {
      for (const other of this.byAddress.values()) {
        if (
          other.address.toLowerCase() !== row.address.toLowerCase() &&
          other.pairToken.toLowerCase() === row.pairToken.toLowerCase()
        ) {
          hasOpponent = true;
          break;
        }
      }
    }

    let creationEnabled = true;
    let disableReason: string | null = null;
    if (row.priceUsd === null) {
      creationEnabled = false;
      disableReason = "no live price";
    } else if (row.liquidityUsd < arenaConfig.creation.minLiquidityUsd) {
      creationEnabled = false;
      disableReason = `below liquidity floor ($${arenaConfig.creation.minLiquidityUsd.toLocaleString("en-US")})`;
    } else if (!hasOpponent) {
      creationEnabled = false;
      disableReason = "no opponent available";
    }
    return { ...row, pairedStock, pairSymbol, pairType, creationEnabled, disableReason };
  }

  /** Re-apply the gate to every cached entry (pair resolutions and
   *  derby availability change as the stock list and the cache grow). */
  private redecorateAll(): void {
    for (const [key, entry] of this.byAddress) {
      this.byAddress.set(key, this.decorate(entry));
    }
  }

  private armTimer(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll().catch(() => {});
      if (this.running) this.armTimer(this.backoffMs);
    }, delayMs);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    let pages: Array<Array<Omit<ArenaRegistryEntry, "pairedStock" | "pairSymbol" | "pairType" | "creationEnabled" | "disableReason">>>;
    try {
      pages = await Promise.all([
        this.fetchPage({ sort: "age", dir: "desc", view: "full" }),
        this.fetchPage({ sort: "volume", dir: "desc", view: "list" }),
        this.fetchPage({ sort: "trending", dir: "desc", view: "list" }),
      ]);
    } catch (err) {
      this.onFailure(err);
      return;
    }
    // Merge order matters: volume and trending first, the full newest
    // page last, so full records win over list records for fresh tokens.
    const fresh = this.ingestTokens([...pages[1], ...pages[2], ...pages[0]], now);
    await this.fillPairIdentities();
    this.redecorateAll();
    this.backoffMs = this.pollMs;
    this.meterStats.lastPollAtMs = now;
    this.meterStats.lastPollOk = true;
    meter.count("arena_registry_polls", 1);
    this.setStatus("idle");
    logger.debug("[ArenaRegistry] registry updated", {
      memes: this.byAddress.size,
      fresh: fresh.length,
    });
    this.emit("memes", this.getMemes());
    for (const entry of fresh) {
      logger.info("[ArenaRegistry] new launch detected", {
        address: entry.address,
        symbol: entry.symbol,
        pairToken: entry.pairToken,
        pairedStock: entry.pairedStock?.symbol ?? null,
        liquidityUsd: entry.liquidityUsd,
      });
      this.emit("launch", entry);
    }
    await this.maybeWriteDailySnapshots(now);
  }

  private async fetchPage(opts: { sort: string; dir: string; view: "full" | "list" }): Promise<Array<Omit<ArenaRegistryEntry, "pairedStock" | "pairSymbol" | "pairType" | "creationEnabled" | "disableReason">>> {
    const url = new URL(`${this.baseUrl}/api/v1/launchpad/tokens`);
    url.searchParams.set("chain", arenaConfig.basestonk.chain);
    url.searchParams.set("sort", opts.sort);
    url.searchParams.set("dir", opts.dir);
    url.searchParams.set("limit", String(arenaConfig.registry.pageSize));
    url.searchParams.set("offset", "0");
    url.searchParams.set("view", opts.view);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: { accept: "application/json", "user-agent": "tickr-backend/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`BaseStonk API fetch failed: ${String(err)}`);
    }
    this.meterStats.calls++;
    meter.count("arena_registry_calls", 1);
    const bodyText = await res.text();
    this.meterStats.bytes += Buffer.byteLength(bodyText);
    meter.count("outbound_bytes:arena-registry", Buffer.byteLength(bodyText));
    if (res.status === 429) throw new Error("BaseStonk API rate limited (429)");
    if (!res.ok) throw new Error(`BaseStonk API request failed: ${res.status}`);
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error("BaseStonk API returned unparseable JSON");
    }
    return parseBasestonkResponse(body);
  }

  /** One page of search results, mirroring fetchPage's metering and
   *  error discipline exactly, with the search params added. */
  private async fetchSearchPage(query: string): Promise<Array<Omit<ArenaRegistryEntry, "pairedStock" | "pairSymbol" | "pairType" | "creationEnabled" | "disableReason">>> {
    const url = new URL(`${this.baseUrl}/api/v1/launchpad/tokens`);
    url.searchParams.set("chain", arenaConfig.basestonk.chain);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(SEARCH_LIMIT));
    url.searchParams.set("offset", "0");
    url.searchParams.set("view", "full");
    url.searchParams.set("sort", "trending");
    url.searchParams.set("dir", "desc");
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: { accept: "application/json", "user-agent": "tickr-backend/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`BaseStonk API fetch failed: ${String(err)}`);
    }
    this.meterStats.calls++;
    meter.count("arena_registry_calls", 1);
    const bodyText = await res.text();
    this.meterStats.bytes += Buffer.byteLength(bodyText);
    meter.count("outbound_bytes:arena-registry", Buffer.byteLength(bodyText));
    if (res.status === 429) throw new Error("BaseStonk API rate limited (429)");
    if (!res.ok) throw new Error(`BaseStonk API request failed: ${res.status}`);
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error("BaseStonk API returned unparseable JSON");
    }
    return parseBasestonkResponse(body);
  }

  /**
   * Fill the pair-identity cache for pair tokens the stock list does
   * not resolve. Bounded per poll and cached forever: an identity is
   * a fact about the pair token, not a price.
   */
  private async fillPairIdentities(): Promise<void> {
    let lookups = 0;
    for (const entry of this.byAddress.values()) {
      if (lookups >= MAX_IDENTITY_LOOKUPS_PER_POLL) break;
      if (!entry.pairToken || entry.pairedStock) continue;
      const key = entry.pairToken.toLowerCase();
      if (this.pairIdentities.has(key)) continue;
      lookups++;
      try {
        const url = `${this.baseUrl}/api/v1/launchpad/pair-identity/${arenaConfig.basestonk.chain}/${entry.pairToken}`;
        const res = await fetch(url, {
          headers: { accept: "application/json", "user-agent": "tickr-backend/1.0" },
          signal: AbortSignal.timeout(10_000),
        });
        this.meterStats.calls++;
        meter.count("arena_registry_calls", 1);
        const bodyText = await res.text();
        this.meterStats.bytes += Buffer.byteLength(bodyText);
        meter.count("outbound_bytes:arena-registry", Buffer.byteLength(bodyText));
        if (!res.ok) {
          this.pairIdentities.set(key, { symbol: null, name: null });
          continue;
        }
        const body = JSON.parse(bodyText) as { symbol?: string; name?: string };
        this.pairIdentities.set(key, {
          symbol: typeof body.symbol === "string" ? body.symbol : null,
          name: typeof body.name === "string" ? body.name : null,
        });
      } catch {
        this.pairIdentities.set(key, { symbol: null, name: null });
      }
    }
  }

  /**
   * Daily volume snapshots: on the first poll after each UTC
   * midnight, write every cached meme's volume and liquidity into
   * arena_volume_snapshots. Best-effort: a failure leaves
   * lastSnapshotDay unset so the next poll retries.
   */
  private async maybeWriteDailySnapshots(nowMs: number): Promise<void> {
    if (!this.db) return;
    const day = new Date(nowMs).toISOString().slice(0, 10);
    if (this.lastSnapshotDay === day) return;
    const rows = [...this.byAddress.values()].map((e) => ({
      address: e.address.toLowerCase(),
      day,
      volume24h_usd: e.volume24hUsd,
      liquidity_usd: e.liquidityUsd,
    }));
    if (rows.length === 0) {
      this.lastSnapshotDay = day;
      return;
    }
    const { error } = await this.db
      .from("arena_volume_snapshots")
      .upsert(rows, { onConflict: "address,day" });
    if (error) {
      logger.warn("[ArenaRegistry] daily volume snapshot write failed, will retry next poll", {
        day,
        error: error.message,
      });
      return;
    }
    this.lastSnapshotDay = day;
    logger.info("[ArenaRegistry] daily volume snapshots written", { day, memes: rows.length });
  }

  private onFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.meterStats.errors++;
    this.meterStats.lastPollOk = false;
    logger.warn("[ArenaRegistry] poll failed, serving last good cache", { message });
    this.setStatus("error", message);
    // Back off, but keep trying: a registry outage must recover alone,
    // and the stale cache keeps /api/arena/registry answering meanwhile.
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    if (this.running) this.armTimer(this.backoffMs);
  }

  private setStatus(status: "polling" | "idle" | "error", detail?: string): void {
    this.emit("status", status, detail);
  }

  // Typed EventEmitter overrides
  on<K extends keyof ArenaRegistryEventMap>(event: K, listener: ArenaRegistryEventMap[K]): this {
    return super.on(event, listener);
  }
  emit<K extends keyof ArenaRegistryEventMap>(event: K, ...args: Parameters<ArenaRegistryEventMap[K]>): boolean {
    return super.emit(event, ...args);
  }
}
