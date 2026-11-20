/**
 * Stock NAV poller, Chainlink NAV via the Base Tokenized Stocks API.
 *
 * Intended destination: packages/backend/src/services/stockNavPoller.ts.
 * Mirrors the shape of the crypto CoinbasePoller (EventEmitter, in-memory
 * Map, getLatest(), on-demand pollNow()) so StockPriceFeed can treat it
 * as the primary source, but the polling discipline is different in every
 * way that matters for the 1 GB/month bandwidth cap:
 *
 *   - ONE HTTP call per poll covers ALL 12 teams. GET / with page_size
 *     500 returns the full token list (87 tokens live 2026-11-18) in a
 *     single response, paginated only via next_page_token. There is no
 *     per-team endpoint to hammer; per-team polling would be pure waste.
 *   - HOT/IDLE cadence. Hot (60s) only inside the daily hot window: 30
 *     min before the first kickoff of the day to the last full-time + 15
 *     min. Idle (15 min) otherwise. The lifecycle owns the hot window
 *     and calls setHot(); the poller never decides it alone. At idle
 *     cadence the API costs ~96 calls/day; at hot cadence during a ~12h
 *     matchday window it costs ~720 calls/day. Either way it is orders
 *     of magnitude inside any rate limit, and the meter below proves it.
 *   - NO backend WebSocket price feed. NAV is reference data, not a
 *     ticking market: Chainlink equity feeds update on 0.5% deviation or
 *     a 24h heartbeat and hold their last value outside market hours.
 *     Polling faster than 60s, or streaming it, buys nothing.
 *
 * Staleness (the field that decides matches):
 *   - nav_price is the most recently published Chainlink-based NAV. It
 *     is NOT a live bid/ask or execution price.
 *   - nav_price_updated_at is an RFC3339 timestamp (e.g.
 *     "2026-11-16T18:50:27Z"), not unix seconds. It is when the NAV was
 *     last published onchain. A missing nav_price (the API omits
 *     unset/zero fields) means NO usable price for that token, never a
 *     zero. Live check 2026-11-16: only 12 of 368 tokens carried a NAV
 *     at 19:27 UTC, and GMEc had none at all; live check 2026-11-18:
 *     the list holds 87 tokens and all 12 roster teams carry a NAV. A
 *     team with no NAV is a forfeit candidate, never a zero price.
 *   - Freshness for PRICING uses stockConfig.nav.staleAfterMs (25h:
 *     24h heartbeat + 1h tolerance). Freshness for FORFEIT uses the
 *     match window plus grace (stockPriceFeed.isWindowFresh): the NAV
 *     must have been published inside [kickoff, FT + grace] for the team
 *     to count as having performed.
 *
 * Deviation / circuit breaker:
 *   - A new NAV more than +/-30% away from the previous good tick is
 *     treated as suspect: it is logged at ERROR, kept out of the
 *     last-good map, and exposed via getSuspect() for manual review. The
 *     feed keeps serving the last good tick, so a bad publish can never
 *     decide a match on its own. (The on-chain circuit breaker is the
 *     stock contracts' job; this is the backend's first line.)
 *
 * Meter: every call and every response byte is counted (the repo has no
 * shared outboundMeter module, so the meter lives here). The soft cap in
 * stockConfig is ops visibility only: breaching it logs at ERROR but
 * never blocks a snapshot, because a blocked snapshot locks stakers'
 * funds in the pool.
 */

import { EventEmitter } from "node:events";
import { stockConfig } from "../stockConfig.js";
import { logger } from "../lib/logger.js";
import { describeFetchFailure } from "../lib/fetchError.js";
import { STOCK_TEAMS } from "./stockTeams.js";

export interface NavTick {
  teamId: number;
  ticker: string;
  tokenSymbol: string;
  /** NAV/reference price in USD, decimal string exactly as published. */
  navPrice: string;
  /** When nav_price was last published onchain (ms since epoch). */
  navPriceUpdatedAtMs: number;
  /** Raw RFC3339 value from the API, for audit logs. */
  navPriceUpdatedAtIso: string;
  /** Current share-to-token multiplier from the API. */
  multiplier: number;
  /** Local receipt time (ms). */
  receivedAtMs: number;
  /** True when this tick was rejected by the deviation check. */
  suspect: boolean;
}

export interface NavMeterStats {
  calls: number;
  bytes: number;
  errors: number;
  lastPollAtMs: number | null;
  lastPollOk: boolean;
  softCapBreached: boolean;
}

interface NavPollerEventMap {
  prices: (ticks: Map<number, NavTick>) => void;
  status: (status: "polling" | "idle" | "error", detail?: string) => void;
}

const MAX_BACKOFF_MS = 10 * 60_000;
/** Tokens fetched per list page. The API caps page_size at 500. */
const PAGE_SIZE = 500;
/** A NAV jump beyond this (bps) vs the previous good tick is suspect. */
const SUSPECT_DEVIATION_BPS = 3000; // +/-30%

interface ApiToken {
  contract_address?: string;
  symbol?: string;
  decimals?: number;
  isin?: string;
  multiplier?: number;
  nav_price?: number | string;
  nav_price_updated_at?: string;
}

export class StockNavPoller extends EventEmitter {
  private readonly baseUrl: string;
  private readonly hotPollMs: number;
  private readonly idlePollMs: number;
  /** Last GOOD tick per teamId (suspect ticks never land here). */
  private readonly latest = new Map<number, NavTick>();
  /** Latest suspect tick per teamId, for manual review. */
  private readonly suspect = new Map<number, NavTick>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private hot = false;
  private backoffMs: number;
  private readonly meter: NavMeterStats = {
    calls: 0,
    bytes: 0,
    errors: 0,
    lastPollAtMs: null,
    lastPollOk: false,
    softCapBreached: false,
  };
  private warnedSoftCap = false;

  constructor(
    baseUrl: string = stockConfig.nav.baseUrl,
    hotPollMs: number = stockConfig.nav.hotPollMs,
    idlePollMs: number = stockConfig.nav.idlePollMs
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
    logger.info("[StockNavPoller] starting", {
      baseUrl: this.baseUrl,
      hotPollMs: this.hotPollMs,
      idlePollMs: this.idlePollMs,
      teams: STOCK_TEAMS.length,
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
   * Hot window switch, owned by the stock lifecycle: hot from 30 min
   * before the first kickoff of the day until the last full-time + 15
   * min, idle otherwise. Switching to hot triggers an immediate poll;
   * switching to idle just stretches the next timer.
   */
  setHot(hot: boolean): void {
    if (this.hot === hot) return;
    this.hot = hot;
    logger.info("[StockNavPoller] cadence change", { hot });
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

  /** Synchronous in-memory read: the feed never awaits the network. */
  getLatest(teamId: number): NavTick | undefined {
    return this.latest.get(teamId);
  }

  getAllLatest(): Map<number, NavTick> {
    return new Map(this.latest);
  }

  /** Suspect (deviation-rejected) ticks, for manual circuit-breaker review. */
  getSuspect(teamId: number): NavTick | undefined {
    return this.suspect.get(teamId);
  }

  getMeter(): NavMeterStats {
    return { ...this.meter };
  }

  /** Ms since epoch of the last poll attempt (any outcome), or null before the first poll. */
  getLastPollAtMs(): number | null {
    return this.meter.lastPollAtMs;
  }

  /**
   * Feed health, the gate for the last-NAV fallback (see stockPriceFeed.ts):
   * true only when the last poll SUCCEEDED and landed within
   * `withinMs` (default stockConfig.nav.feedHealthyWithinMs, 30 min).
   * A quiet feed is only trustworthy when the poller itself is proving,
   * poll after poll, that the API is reachable and returning data. An
   * outage must never be mistaken for a quiet feed: when this returns
   * false, the fallback does NOT apply and the forfeit/void path stands.
   */
  isFeedHealthy(withinMs: number = stockConfig.nav.feedHealthyWithinMs, now: number = Date.now()): boolean {
    return (
      this.meter.lastPollOk &&
      this.meter.lastPollAtMs !== null &&
      now - this.meter.lastPollAtMs <= withinMs
    );
  }

  /**
   * One-shot poll, e.g. a gap-fill before a snapshot when the in-memory
   * map is stale. Never touches the poll timer. Note the list endpoint
   * returns every token, so there is no per-team gap-fill: one call
   * refreshes the whole roster.
   */
  async pollNow(): Promise<void> {
    await this.poll();
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
    let tokens: ApiToken[];
    try {
      tokens = await this.fetchAllTokens();
    } catch (err) {
      this.onFailure(err);
      return;
    }
    let count = 0;
    let missing = 0;
    for (const token of tokens) {
      const team = token.contract_address
        ? STOCK_TEAMS.find((t) => t.contractAddress.toLowerCase() === token.contract_address!.toLowerCase())
        : undefined;
      if (!team) continue; // not a league team: ignore, do not store
      if (token.nav_price == null || token.nav_price_updated_at == null) {
        missing++;
        continue; // no NAV published for this token: no price, never a zero
      }
      const updatedAtMs = Date.parse(token.nav_price_updated_at);
      if (!Number.isFinite(updatedAtMs)) {
        logger.warn("[StockNavPoller] unparseable nav_price_updated_at", {
          teamId: team.teamId,
          value: token.nav_price_updated_at,
        });
        missing++;
        continue;
      }
      const tick: NavTick = {
        teamId: team.teamId,
        ticker: team.ticker,
        tokenSymbol: team.tokenSymbol,
        navPrice: String(token.nav_price),
        navPriceUpdatedAtMs: updatedAtMs,
        navPriceUpdatedAtIso: token.nav_price_updated_at,
        multiplier: typeof token.multiplier === "number" ? token.multiplier : team.multiplier,
        receivedAtMs: now,
        suspect: false,
      };
      const prev = this.latest.get(team.teamId);
      if (prev && this.deviationBps(tick.navPrice, prev.navPrice) > SUSPECT_DEVIATION_BPS) {
        // Circuit-breaker review: keep the last good tick, quarantine this one.
        tick.suspect = true;
        this.suspect.set(team.teamId, tick);
        logger.error("[StockNavPoller] SUSPECT NAV, deviation beyond +/-30%, quarantined, last good kept", {
          teamId: team.teamId,
          ticker: team.ticker,
          previous: prev.navPrice,
          suspect: tick.navPrice,
          updatedAt: tick.navPriceUpdatedAtIso,
        });
        continue;
      }
      this.latest.set(team.teamId, tick);
      this.suspect.delete(team.teamId);
      count++;
    }
    this.backoffMs = this.hot ? this.hotPollMs : this.idlePollMs;
    this.meter.lastPollAtMs = now;
    this.meter.lastPollOk = true;
    this.setStatus(this.hot ? "polling" : "idle");
    if (missing > 0) {
      logger.warn("[StockNavPoller] teams with no published NAV this poll", {
        missing,
        total: STOCK_TEAMS.length,
        hint: "No NAV is not a zero price. At full-time a team with no NAV in the match window forfeits (see stockMatchLifecycle).",
      });
    }
    logger.debug("[StockNavPoller] NAV updated", { teams: count, missing });
    this.emit("prices", this.getAllLatest());
  }

  /**
   * Fetch every token record, following next_page_token until exhausted.
   * One page holds 500 tokens and the live list is 87 (Nov 18), so this is
   * normally a single request. Each page counts against the meter.
   */
  private async fetchAllTokens(): Promise<ApiToken[]> {
    const out: ApiToken[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = new URL(this.baseUrl);
      url.searchParams.set("page_size", String(PAGE_SIZE));
      if (pageToken) url.searchParams.set("page_token", pageToken);
      let res: Response;
      try {
        res = await fetch(url.toString(), {
          headers: { accept: "application/json", "user-agent": "tickr-backend/1.0" },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new Error(`NAV API fetch failed: ${describeFetchFailure(err)}`, { cause: err });
      }
      this.meter.calls++;
      const bodyText = await res.text();
      this.meter.bytes += Buffer.byteLength(bodyText);
      this.checkSoftCap();
      if (res.status === 429) throw new Error("NAV API rate limited (429)");
      if (res.status === 503) throw new Error("NAV API temporarily unavailable (503)");
      if (!res.ok) throw new Error(`NAV API request failed: ${res.status}`);
      let body: { tokens?: ApiToken[]; next_page_token?: string };
      try {
        body = JSON.parse(bodyText) as typeof body;
      } catch {
        throw new Error("NAV API returned unparseable JSON");
      }
      out.push(...(body.tokens ?? []));
      pageToken = body.next_page_token;
      if (!pageToken) break;
    }
    return out;
  }

  /** Absolute deviation in bps between two decimal price strings. */
  private deviationBps(next: string, prev: string): number {
    const toScaled = (s: string): bigint => {
      const [intPart, fracPart = ""] = s.trim().split(".");
      return BigInt(intPart + fracPart.padEnd(8, "0").slice(0, 8));
    };
    let a: bigint;
    let b: bigint;
    try {
      a = toScaled(next);
      b = toScaled(prev);
    } catch {
      return 0;
    }
    if (b === 0n) return 0;
    const diff = a >= b ? a - b : b - a;
    return Number((diff * 10_000n) / b);
  }

  private checkSoftCap(): void {
    if (this.meter.calls < stockConfig.meter.navCallsPerMonthSoftCap) return;
    this.meter.softCapBreached = true;
    if (!this.warnedSoftCap) {
      this.warnedSoftCap = true;
      logger.error("[StockNavPoller] NAV call soft cap breached for the month", {
        calls: this.meter.calls,
        softCap: stockConfig.meter.navCallsPerMonthSoftCap,
        hint: "Ops visibility only: polling is NOT stopped, a blocked snapshot would lock stakers' funds. Check the hot/idle cadence.",
      });
    }
  }

  private onFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.meter.errors++;
    this.meter.lastPollOk = false;
    logger.warn("[StockNavPoller] poll failed", { message });
    this.setStatus("error", message);
    // Back off, but keep trying: a NAV outage must recover alone.
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    if (this.running) this.armTimer(this.backoffMs);
  }

  private setStatus(status: "polling" | "idle" | "error", detail?: string): void {
    this.emit("status", status, detail);
  }

  // Typed EventEmitter overrides
  on<K extends keyof NavPollerEventMap>(event: K, listener: NavPollerEventMap[K]): this {
    return super.on(event, listener);
  }
  emit<K extends keyof NavPollerEventMap>(event: K, ...args: Parameters<NavPollerEventMap[K]>): boolean {
    return super.emit(event, ...args);
  }
}
