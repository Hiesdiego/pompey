/**
 * Dynamic stock list service: poller, cache, NAV history, and the
 * resolution NAV decision for the stock price target markets.
 *
 * Intended destination: packages/backend/src/services/stockListService.ts.
 * Powers GET /api/stocks/list (see api/stockMarketRoutes.ts).
 *
 * THE LIST (locked spec): the dynamic stock list is every tokenized
 * stock on Base from the Coinbase tokenized stocks API,
 * GET https://api.coinbase.com/v1/tokenized-stocks with page_size=500,
 * following next_page_token if present. Verified live 2026-11-19: the
 * response is { tokens, next_page_token }, 90 tokens; token fields
 * include symbol (e.g. NVDAc), name, contract_address, decimals (8),
 * multiplier, isin, icon_url (a metadata.coinbase.com PNG, present on
 * 88 of 90), and nav_price plus nav_price_updated_at present ONLY on
 * tokens with a live NAV (12 today). hasNav = nav_price present and not
 * null. iconUrl is null for the rare token without one (the frontend
 * falls back to a letter avatar).
 *
 * CACHE AND COALESCING (the repo's pattern, followed exactly):
 *   - The list is served from an in-memory cache refreshed by ONE
 *     batched poll. A request NEVER triggers an upstream call:
 *     getStocks() is a synchronous read of the cache, exactly like
 *     StockNavPoller.getLatest() and PriceFeed's in-memory Maps.
 *   - Poll cadence is aligned with the existing NAV poller cadence by
 *     construction: hotPollMs / idlePollMs ARE stockConfig.nav's values
 *     (hot 60s inside a hot window, idle 15 min otherwise), re-exported
 *     through stockMarketConfig.list. setHot() mirrors
 *     StockNavPoller.setHot(): the caller owns the hot window, the
 *     poller never decides it alone. At idle cadence the list costs
 *     about 96 calls/day, one call per poll covering ALL tokens.
 *   - Failures back off exponentially (cap 10 min) and keep serving the
 *     last good cache, exactly like StockNavPoller.onFailure. A failed
 *     poll never clears the cache.
 *   - Every call and every response byte is counted on the shared
 *     bandwidth meter (lib/net.ts), like the crypto ChainCache counts
 *     its RPC calls. The user has a 1 GB/month bandwidth hard cap.
 *
 * NAV HISTORY (why this file keeps more than the latest tick): a price
 * target market resolves on the NAV AT its deadline, meaning the last
 * NAV published at or before the deadline. The league NAV poller keeps
 * only the latest tick per team, which is right for a 1-hour match
 * window but wrong here: by the time the keeper runs, the latest tick
 * may already be a post-deadline publish. This service therefore keeps
 * a bounded per-token history of every distinct NAV publish it has
 * seen (8 days, capped per token), and getNavAtOrBefore() returns the
 * tick that was live at any past instant. NAV publishes are sparse
 * (Chainlink equity feeds publish on 0.5% deviation or a 24h
 * heartbeat), so the history stays small.
 *
 * RESOLUTION DECISION (decideResolutionNav, pure and exported for
 * tests): applies the league's LAST_NAV_FALLBACK rule exactly as
 * stockPriceFeed.checkLastNavFallback defines it, translated from a
 * match window to a deadline instant:
 *   (a) a NAV tick at or before the deadline must exist at all (a stock
 *       with no NAV at the deadline is never covered: VOID);
 *   (b) the tick must have been published BEFORE the deadline (a NAV
 *       published after the deadline is post-market data and is never
 *       used as the resolution price);
 *   (c) the tick must be no older than lastNavFallbackMaxAgeMs (24h)
 *       at the deadline (older: VOID);
 *   (d) the feed must be HEALTHY for the fallback tier: when the tick
 *       is older than the fresh window (1h, the league's forfeit grace
 *       analog), the poller's last poll must have succeeded within
 *       feedHealthyWithinMs (30 min), so an outage is never mistaken
 *       for a quiet feed. When the feed is unhealthy and the decision
 *       would depend on the fallback (or on the ABSENCE of a fresher
 *       tick), the decision is DEFER, never VOID: the keeper retries
 *       next pass instead of voiding a resolvable market because our
 *       own poller was down.
 * A tick inside the fresh window resolves without the health gate: it
 * demonstrably published right before the deadline, so it IS the NAV
 * at the deadline regardless of what the poller did afterwards.
 */

import { EventEmitter } from "node:events";
import { stockConfig } from "../stockConfig.js";
import { stockMarketConfig } from "../stockMarketConfig.js";
import { logger } from "../lib/logger.js";
import { meter } from "../lib/net.js";
import { priceToScaled } from "../lib/priceMath.js";

/** One row of GET /api/stocks/list. Field names are the locked API
 *  contract; the frontend is built against exactly these. */
export interface StockListEntry {
  /** B20 token symbol, e.g. "NVDAc". */
  symbol: string;
  /** Company name, e.g. "NVIDIA Corporation". */
  name: string;
  /** B20 token contract on Base, as returned by the API. */
  contractAddress: string;
  /** Token decimals (8 for every B20 stock today). */
  decimals: number;
  /** Current share-to-token multiplier from the API. */
  multiplier: number;
  /** metadata.coinbase.com icon URL, or null when the token has none. */
  iconUrl: string | null;
  /** Latest published NAV as a decimal string, or null when the token
   *  has no live NAV. A string, never a float: every price in this
   *  backend is a decimal string (see lib/priceMath.ts). */
  navPrice: string | null;
  /** RFC3339 timestamp of the latest NAV publish, or null. */
  navUpdatedAt: string | null;
  /** True only when nav_price is present and not null. */
  hasNav: boolean;
}

/** One published NAV tick, kept in the per-token history. */
export interface StockNavTick {
  contractAddress: string;
  symbol: string;
  /** NAV/reference price in USD, decimal string exactly as published. */
  navPrice: string;
  /** When the NAV was published onchain (ms since epoch). */
  updatedAtMs: number;
  /** Raw RFC3339 value from the API, for audit logs. */
  updatedAtIso: string;
  /** Local receipt time (ms). */
  receivedAtMs: number;
}

export interface StockListMeterStats {
  calls: number;
  bytes: number;
  errors: number;
  lastPollAtMs: number | null;
  lastPollOk: boolean;
}

interface StockListEventMap {
  stocks: (entries: StockListEntry[]) => void;
  status: (status: "polling" | "idle" | "error", detail?: string) => void;
}

/** Raw token shape from the Coinbase tokenized stocks API. Fields the
 *  API omits when unset (nav_price on tokens without a NAV) are
 *  optional here, never defaulted to zero. */
interface ApiToken {
  contract_address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  multiplier?: number;
  icon_url?: string | null;
  nav_price?: number | string | null;
  nav_price_updated_at?: string | null;
}

const MAX_BACKOFF_MS = 10 * 60_000;
/** Pages are followed via next_page_token; the cap is a runaway guard.
 *  One page holds 500 tokens and the live list is 90 (2026-11-19). */
const MAX_PAGES = 10;
/** NAV history retention: long enough to cover any market deadline the
 *  keeper might resolve late (void window is 7 days on the factory). */
const NAV_HISTORY_RETENTION_MS = 8 * 24 * 60 * 60_000;
/** Per-token history cap (runaway guard; real publishes are sparse). */
const NAV_HISTORY_MAX_PER_TOKEN = 512;
/** Fresh window for the resolution decision: a NAV published within
 *  this long before the deadline is unambiguously the live NAV at the
 *  deadline. Mirrors the league's forfeit grace (1h). */
export const RESOLUTION_FRESH_WINDOW_MS = 60 * 60_000;

/**
 * Parse one API token list into API-contract entries. Pure: exported
 * for tests and reused by the poller. Tokens missing a symbol or a
 * contract address are skipped (they can never be a market asset);
 * a missing nav_price means NO usable price, never a zero.
 */
export function parseStockListTokens(tokens: unknown[]): StockListEntry[] {
  const out: StockListEntry[] = [];
  for (const raw of tokens) {
    const token = raw as ApiToken;
    if (!token || typeof token.symbol !== "string" || typeof token.contract_address !== "string") {
      continue;
    }
    const hasNav = token.nav_price !== null && token.nav_price !== undefined;
    out.push({
      symbol: token.symbol,
      name: typeof token.name === "string" ? token.name : token.symbol,
      contractAddress: token.contract_address,
      decimals: typeof token.decimals === "number" ? token.decimals : 8,
      multiplier: typeof token.multiplier === "number" ? token.multiplier : 1,
      iconUrl: typeof token.icon_url === "string" && token.icon_url !== "" ? token.icon_url : null,
      navPrice: hasNav ? String(token.nav_price) : null,
      navUpdatedAt: hasNav && typeof token.nav_price_updated_at === "string"
        ? token.nav_price_updated_at
        : null,
      hasNav,
    });
  }
  return out;
}

/** Parse a full API response body ({ tokens, next_page_token }). */
export function parseStockListResponse(body: unknown): StockListEntry[] {
  const tokens = (body as { tokens?: unknown[] } | null)?.tokens;
  return parseStockListTokens(Array.isArray(tokens) ? tokens : []);
}

// ---------------------------------------------------------- resolution NAV

/** A NAV tick candidate for the resolution decision. */
export interface ResolutionNavTick {
  navPrice: string;
  updatedAtMs: number;
  updatedAtIso: string;
}

export interface ResolutionNavDecision {
  /** resolve: submit this NAV. void: no NAV qualifies, void the market.
   *  defer: the feed is unhealthy, retry next pass, decide nothing. */
  action: "resolve" | "void" | "defer";
  /** Short machine-readable reason (logged on every keeper decision). */
  reason: string;
  /** The resolution NAV (decimal string), when action is resolve. */
  navPrice?: string;
  /** The resolution NAV scaled by 1e8, ready for the factory's
   *  resolve(marketId, finalPrice), when action is resolve. */
  scaled?: bigint;
  /** When the resolution NAV was published (ms), when one was chosen. */
  navUpdatedAtMs?: number;
  /** True when the chosen NAV came from the fallback tier (published
   *  more than the fresh window before the deadline, accepted under
   *  the LAST_NAV_FALLBACK rule). False for a fresh NAV. */
  usedFallback?: boolean;
  /** Age of the chosen (or newest pre-deadline) NAV at the deadline. */
  ageAtDeadlineMs?: number;
}

/**
 * The keeper's resolve/void decision for one market, pure. See the file
 * header for the rule and how each league condition maps. All bounds
 * come from stockConfig.nav (the league's own constants), never from a
 * second copy that could drift.
 */
export function decideResolutionNav(args: {
  /** Last NAV published at or before the deadline, if one is known. */
  tickAtDeadline?: ResolutionNavTick;
  /** Latest NAV known overall (may be post-deadline), for reasons. */
  latestTick?: ResolutionNavTick;
  deadlineMs: number;
  nowMs: number;
  feedHealthy: boolean;
}): ResolutionNavDecision {
  const { tickAtDeadline, latestTick, deadlineMs, feedHealthy } = args;
  const fallbackMaxAgeMs = stockConfig.nav.lastNavFallbackMaxAgeMs;

  if (tickAtDeadline) {
    const ageAtDeadlineMs = deadlineMs - tickAtDeadline.updatedAtMs;
    if (ageAtDeadlineMs <= fallbackMaxAgeMs) {
      const scaled = priceToScaled(tickAtDeadline.navPrice);
      if (ageAtDeadlineMs <= RESOLUTION_FRESH_WINDOW_MS) {
        // Fresh tier: published right before the deadline, so it IS
        // the NAV at the deadline. No health gate (see header).
        return {
          action: "resolve",
          reason: "fresh NAV at deadline",
          navPrice: tickAtDeadline.navPrice,
          scaled,
          navUpdatedAtMs: tickAtDeadline.updatedAtMs,
          usedFallback: false,
          ageAtDeadlineMs,
        };
      }
      // Fallback tier: healthy feed, quiet window, last NAV within 24h.
      if (feedHealthy) {
        return {
          action: "resolve",
          reason: "LAST_NAV_FALLBACK: healthy feed, quiet window, last NAV within 24h of deadline",
          navPrice: tickAtDeadline.navPrice,
          scaled,
          navUpdatedAtMs: tickAtDeadline.updatedAtMs,
          usedFallback: true,
          ageAtDeadlineMs,
        };
      }
      return {
        action: "defer",
        reason: "fallback NAV exists but the feed is not healthy (no recent successful poll), outage is not a quiet feed",
        ageAtDeadlineMs,
      };
    }
    // A pre-deadline NAV exists but is older than the 24h bound. Void
    // only when the feed is healthy: during an outage a fresher
    // pre-deadline NAV may simply be unseen.
    if (feedHealthy) {
      return {
        action: "void",
        reason: `last NAV before deadline is older than the 24h fallback bound (${Math.round(ageAtDeadlineMs / 3_600_000)}h old at deadline)`,
        ageAtDeadlineMs,
      };
    }
    return {
      action: "defer",
      reason: "last known NAV is stale and the feed is not healthy, cannot rule out an unseen fresher NAV",
      ageAtDeadlineMs,
    };
  }

  // No NAV at or before the deadline in the record.
  if (!feedHealthy) {
    return {
      action: "defer",
      reason: "no NAV at deadline in the record and the feed is not healthy, cannot distinguish outage from no NAV",
    };
  }
  if (latestTick && latestTick.updatedAtMs > deadlineMs) {
    return {
      action: "void",
      reason: "first known NAV was published after the deadline, the stock had no NAV at the deadline",
    };
  }
  return {
    action: "void",
    reason: "no NAV ever published for this stock",
  };
}

// ---------------------------------------------------------- the service

export class StockListService extends EventEmitter {
  private readonly baseUrl: string;
  private readonly hotPollMs: number;
  private readonly idlePollMs: number;
  /** The cached list, in API order. Served synchronously, never
   *  refreshed by a request. */
  private entries: StockListEntry[] = [];
  private readonly byAddress = new Map<string, StockListEntry>();
  private readonly bySymbol = new Map<string, StockListEntry>();
  /** Per-token NAV publish history, ascending by updatedAtMs. */
  private readonly navHistory = new Map<string, StockNavTick[]>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private hot = false;
  private backoffMs: number;
  private readonly meterStats: StockListMeterStats = {
    calls: 0,
    bytes: 0,
    errors: 0,
    lastPollAtMs: null,
    lastPollOk: false,
  };

  constructor(
    baseUrl: string = stockMarketConfig.list.baseUrl,
    hotPollMs: number = stockMarketConfig.list.hotPollMs,
    idlePollMs: number = stockMarketConfig.list.idlePollMs
  ) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.hotPollMs = hotPollMs;
    this.idlePollMs = idlePollMs;
    this.backoffMs = idlePollMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info("[StockListService] starting", {
      baseUrl: this.baseUrl,
      hotPollMs: this.hotPollMs,
      idlePollMs: this.idlePollMs,
    });
    this.setStatus("idle");
    void this.poll().catch(() => {});
    this.armTimer(this.idlePollMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Hot window switch, mirroring StockNavPoller.setHot(): hot from
   * 30 min before the first stock kickoff of the day until the last
   * full-time + 15 min, idle otherwise. The stock lifecycle owns the
   * window; this service never decides it alone. Switching to hot
   * triggers an immediate poll.
   */
  setHot(hot: boolean): void {
    if (this.hot === hot) return;
    this.hot = hot;
    logger.info("[StockListService] cadence change", { hot });
    this.setStatus(hot ? "polling" : "idle");
    if (hot && this.running) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      void this.poll().catch(() => {});
      this.armTimer(this.hotPollMs);
    } else if (this.running) {
      this.armTimer(this.idlePollMs);
    }
  }

  isHot(): boolean {
    return this.hot;
  }

  /** Synchronous in-memory read: the request path never awaits the
   *  network and never triggers an upstream call. */
  getStocks(): StockListEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  getStockBySymbol(symbol: string): StockListEntry | undefined {
    return this.bySymbol.get(symbol);
  }

  getStockByAddress(contractAddress: string): StockListEntry | undefined {
    return this.byAddress.get(contractAddress.toLowerCase());
  }

  /** Latest known NAV tick for a token, or undefined when the token
   *  has never published a NAV in this process's record. */
  getLatestNav(contractAddress: string): StockNavTick | undefined {
    const history = this.navHistory.get(contractAddress.toLowerCase());
    return history && history.length > 0 ? history[history.length - 1] : undefined;
  }

  /**
   * The NAV that was live at `atMs`: the last tick published at or
   * before that instant. This is the resolution NAV source for the
   * keeper (the NAV AT the market deadline).
   */
  getNavAtOrBefore(contractAddress: string, atMs: number): StockNavTick | undefined {
    const history = this.navHistory.get(contractAddress.toLowerCase());
    if (!history) return undefined;
    let best: StockNavTick | undefined;
    for (const tick of history) {
      if (tick.updatedAtMs <= atMs) best = tick;
      else break;
    }
    return best;
  }

  /**
   * Feed health, the gate for the last-NAV fallback: true only when
   * the last poll SUCCEEDED and landed within `withinMs` (default
   * stockConfig.nav.feedHealthyWithinMs, 30 min). Identical semantics
   * to StockNavPoller.isFeedHealthy.
   */
  isFeedHealthy(
    withinMs: number = stockConfig.nav.feedHealthyWithinMs,
    now: number = Date.now()
  ): boolean {
    return (
      this.meterStats.lastPollOk &&
      this.meterStats.lastPollAtMs !== null &&
      now - this.meterStats.lastPollAtMs <= withinMs
    );
  }

  getMeter(): StockListMeterStats {
    return { ...this.meterStats };
  }

  /** One-shot poll (gap-fill). Never touches the poll timer. */
  async pollNow(): Promise<void> {
    await this.poll();
  }

  /**
   * Replace the cache from already-fetched API tokens and fold any new
   * NAV publishes into the history. Split out of poll() so the parse
   * and history logic is testable without the network.
   */
  ingestTokens(tokens: unknown[], receivedAtMs: number = Date.now()): StockListEntry[] {
    const entries = parseStockListTokens(tokens);
    this.entries = entries;
    this.byAddress.clear();
    this.bySymbol.clear();
    for (const entry of entries) {
      this.byAddress.set(entry.contractAddress.toLowerCase(), entry);
      this.bySymbol.set(entry.symbol, entry);
      if (!entry.hasNav || entry.navPrice === null || entry.navUpdatedAt === null) continue;
      const updatedAtMs = Date.parse(entry.navUpdatedAt);
      if (!Number.isFinite(updatedAtMs)) continue;
      const key = entry.contractAddress.toLowerCase();
      const history = this.navHistory.get(key) ?? [];
      const last = history[history.length - 1];
      if (!last || last.updatedAtMs !== updatedAtMs) {
        history.push({
          contractAddress: entry.contractAddress,
          symbol: entry.symbol,
          navPrice: entry.navPrice,
          updatedAtMs,
          updatedAtIso: entry.navUpdatedAt,
          receivedAtMs,
        });
        // Prune: retention window plus a hard per-token cap.
        const cutoff = receivedAtMs - NAV_HISTORY_RETENTION_MS;
        let pruned = history.filter((t) => t.updatedAtMs >= cutoff);
        if (pruned.length > NAV_HISTORY_MAX_PER_TOKEN) {
          pruned = pruned.slice(pruned.length - NAV_HISTORY_MAX_PER_TOKEN);
        }
        this.navHistory.set(key, pruned);
      }
    }
    return entries;
  }

  private armTimer(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll().catch(() => {});
      if (this.running) this.armTimer(this.hot ? this.backoffMs : this.idlePollMs);
    }, delayMs);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    let tokens: unknown[];
    try {
      tokens = await this.fetchAllTokens();
    } catch (err) {
      this.onFailure(err);
      return;
    }
    const entries = this.ingestTokens(tokens, now);
    this.backoffMs = this.hot ? this.hotPollMs : this.idlePollMs;
    this.meterStats.lastPollAtMs = now;
    this.meterStats.lastPollOk = true;
    meter.count("stock_list_polls", 1);
    this.setStatus(this.hot ? "polling" : "idle");
    logger.debug("[StockListService] stock list updated", {
      tokens: entries.length,
      withNav: entries.filter((e) => e.hasNav).length,
    });
    this.emit("stocks", this.getStocks());
  }

  /**
   * Fetch every token record, following next_page_token until
   * exhausted. One page holds 500 tokens and the live list is 90
   * (2026-11-19), so this is normally a single request. Each page
   * counts against the meter. Mirrors StockNavPoller.fetchAllTokens,
   * including the page_token request parameter it uses.
   */
  private async fetchAllTokens(): Promise<unknown[]> {
    const out: unknown[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(this.baseUrl);
      url.searchParams.set("page_size", String(stockMarketConfig.list.pageSize));
      if (pageToken) url.searchParams.set("page_token", pageToken);
      let res: Response;
      try {
        res = await fetch(url.toString(), {
          headers: { accept: "application/json", "user-agent": "tickr-backend/1.0" },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new Error(`stock list API fetch failed: ${String(err)}`);
      }
      this.meterStats.calls++;
      meter.count("stock_list_calls", 1);
      const bodyText = await res.text();
      this.meterStats.bytes += Buffer.byteLength(bodyText);
      meter.count("outbound_bytes:stock-list", Buffer.byteLength(bodyText));
      if (res.status === 429) throw new Error("stock list API rate limited (429)");
      if (res.status === 503) throw new Error("stock list API temporarily unavailable (503)");
      if (!res.ok) throw new Error(`stock list API request failed: ${res.status}`);
      let body: { tokens?: unknown[]; next_page_token?: string };
      try {
        body = JSON.parse(bodyText) as typeof body;
      } catch {
        throw new Error("stock list API returned unparseable JSON");
      }
      out.push(...(body.tokens ?? []));
      pageToken = body.next_page_token;
      if (!pageToken) break;
    }
    return out;
  }

  private onFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.meterStats.errors++;
    this.meterStats.lastPollOk = false;
    logger.warn("[StockListService] poll failed, serving last good cache", { message });
    this.setStatus("error", message);
    // Back off, but keep trying: a list outage must recover alone, and
    // the stale cache keeps /api/stocks/list answering meanwhile.
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    if (this.running) this.armTimer(this.backoffMs);
  }

  private setStatus(status: "polling" | "idle" | "error", detail?: string): void {
    this.emit("status", status, detail);
  }

  // Typed EventEmitter overrides
  on<K extends keyof StockListEventMap>(event: K, listener: StockListEventMap[K]): this {
    return super.on(event, listener);
  }
  emit<K extends keyof StockListEventMap>(event: K, ...args: Parameters<StockListEventMap[K]>): boolean {
    return super.emit(event, ...args);
  }
}
