/**
 * Stock price feed, validator + aggregator, the single choke point every
 * stock snapshot goes through before it touches the chain.
 *
 * Intended destination: packages/backend/src/services/stockPriceFeed.ts.
 * Mirrors the crypto PriceFeed (same error pattern, same soft-preference
 * for start/end source consistency, same cross-validation), but the
 * source stack is the stock stack:
 *
 *   1. Chainlink NAV (primary), StockNavPoller, Base Tokenized Stocks
 *      API. nav_price + nav_price_updated_at + multiplier.
 *   2. Dinari (gated, NOT automatic), only when DINARI_API_KEY_ID is
 *      supplied by the user AND a Dinari client is provided to the
 *      constructor. VERIFIED 2026-11-16: Dinari rows exist for all 20
 *      roster tickers plus all 10 reserves, but the Dinari API is
 *      enterprise/key-gated, not a free public feed, so it is NOT 100%
 *      worthy as a drop-in fallback. There is deliberately no Dinari HTTP
 *      client in this file: the endpoint and auth scheme are unverified,
 *      and guessing at an enterprise API would silently wire a fallback
 *      nobody can audit. When the user supplies a key, wire a
 *      DinariPriceSource implementation (one method, getLatest) and the
 *      tier activates; until then the tier is inert and the feed logs
 *      once that Dinari is configured-but-unavailable.
 *   3. CoinGecko (last resort), only if it has a price for the ticker.
 *      The crypto CoingeckoPoller is reused by shape (getPrice(id)),
 *      but the id map is passed in separately and defaults to EMPTY:
 *      no CoinGecko ids for these stocks have been verified, and none
 *      are invented here. A team with no id simply has no CoinGecko
 *      tier. If no tier is fresh, the price is unavailable and the
 *      caller must NOT submit (the match waits or forfeits at FT; the
 *      contract has no deadline and a snapshot is never fabricated).
 *
 * Validation rules (same as crypto):
 * - If TWO OR MORE sources are fresh and any disagrees with the chosen
 *   primary by more than maxDeviationBps (default 2%), the price is
 *   REJECTED with StockPriceValidationError. A divergent feed must never
 *   decide a match on its own.
 * - If only one source is fresh, it is used alone (degraded mode, logged).
 * - If no source is fresh, StockPriceUnavailableError is thrown.
 *
 * Two different freshness tests exist on purpose; do not merge them:
 * - getValidatedPrice() uses the PRICING staleness bound (NAV older than
 *   25h is stale). A yesterday-close NAV is a legitimate start reference.
 * - isWindowFresh() is the FORFEIT test: the NAV must have been
 *   PUBLISHED inside the match window [kickoff, FT + grace]. A team
 *   whose NAV never refreshed during the match had no performance for
 *   that period, even if its yesterday-close price is still within the
 *   25h pricing bound. The lifecycle calls this at FT, never at kickoff.
 *
 * LAST-NAV FALLBACK (user approved 2026-11-18, implemented here as
 * resolveEndPrice / checkLastNavFallback): Chainlink equity feeds publish
 * on 0.5% deviation or a 24h heartbeat. A stock that moves less than 0.5%
 * inside a 1-hour match publishes NO new NAV round, so under the old
 * forfeit rule it forfeited even though nothing was wrong with the feed.
 * The approved rule accepts the last NAV within the 24h heartbeat as the
 * end price when the feed is healthy but quiet, instead of forfeiting.
 * The fallback is named, bounded, and logged, and it NEVER fabricates a
 * price: it reuses the actual last published NAV value and timestamp.
 * Conditions, all required (see checkLastNavFallback):
 *   (a) the team HAS a last NAV tick at all (a team with no NAV ever
 *       published is not covered; that is why the roster shrank to 12);
 *   (b) the last NAV was published BEFORE kickoff (the quiet case: no
 *       publish during the window, so the pre-match NAV is the end
 *       price; a NAV published after FT + grace is post-match data and
 *       is never used as the end price);
 *   (c) the last NAV is no older than
 *       stockConfig.nav.lastNavFallbackMaxAgeMs (24h) at full-time;
 *   (d) the feed is HEALTHY: the poller's last poll succeeded within
 *       stockConfig.nav.feedHealthyWithinMs (30 min), so an outage is
 *       never mistaken for a quiet feed.
 * When the fallback applies, the end price equals the start price for
 * that team (same NAV), so the team scores 0 goals from its own move
 * and the result is decided by the opponent's move. Every use is logged
 * at WARN with fixture, team, NAV price, publish time and age, counted
 * in lastNavFallbackUses, and flagged on the validated price
 * (lastNavFallback: true) so the API and the submitter audit show it.
 * The fallback applies ONLY at full-time, via resolveEndPrice. The
 * start snapshot still uses getValidatedPrice (25h pricing bound) and
 * the forfeit rule is unchanged for teams that fail every condition:
 * no performance and no fallback means 0-3 forfeit, both sides missing
 * means void.
 */

import { stockConfig } from "../stockConfig.js";
import { priceToScaled, deviationBps, scaledToPrice } from "../lib/priceMath.js";
import { logger } from "../lib/logger.js";
import type { StockNavPoller, NavTick } from "./stockNavPoller.js";
import { STOCK_TEAMS } from "./stockTeams.js";

/** Anything that can serve a latest tick for a stock ticker. */
export interface StockPrimaryPriceSource {
  getLatest(ticker: string): { price: string; receivedAtMs: number } | undefined;
}

/** Shape of the crypto CoingeckoPoller, reused by interface only. The
 *  stock feed never imports the crypto poller module (it would drag the
 *  crypto team map with it); the wiring in index.ts passes the instance. */
export interface CoingeckoPriceSource {
  getPrice(coinId: string): { priceUsd: string; receivedAtMs: number } | undefined;
}

/** Dinari price source. Implemented ONLY when the user supplies a
 *  DINARI_API_KEY_ID and a verified Dinari client. Until then, pass
 *  undefined: the Dinari tier stays inert. */
export interface DinariPriceSource {
  getLatest(ticker: string): { price: string; receivedAtMs: number } | undefined;
}

export type StockPriceSource = "nav" | "dinari" | "coingecko-fallback";

export interface StockValidatedPrice {
  teamId: number;
  /** Scaled by 10^8, ready for the stock PriceOracle submission. */
  scaled: bigint;
  source: StockPriceSource;
  navPrice: string | null;
  navPriceUpdatedAtIso: string | null;
  dinariPrice: string | null;
  coingeckoPrice: string | null;
  /** Largest deviation of any other fresh source vs the chosen primary. */
  deviationBps: number | null;
  /** True when this price came from the last-NAV fallback (see header):
   *  the NAV was published before kickoff and reused as the end price
   *  because the feed was healthy but quiet. False for every normal price. */
  lastNavFallback: boolean;
  /** Age of the reused NAV at full-time (ms), or null when no fallback. */
  lastNavFallbackAgeMs: number | null;
}

export class StockPriceUnavailableError extends Error {
  readonly teamId: number;
  constructor(teamId: number, message: string) {
    super(message);
    this.name = "StockPriceUnavailableError";
    this.teamId = teamId;
  }
}

export class StockPriceValidationError extends Error {
  readonly teamId: number;
  readonly navPrice: string | null;
  readonly dinariPrice: string | null;
  readonly coingeckoPrice: string | null;
  readonly deviationBps: number;
  constructor(
    teamId: number,
    navPrice: string | null,
    dinariPrice: string | null,
    coingeckoPrice: string | null,
    deviationBps: number
  ) {
    super(
      `Stock price feeds disagree for team ${teamId}: nav=${navPrice ?? "n/a"} ` +
        `dinari=${dinariPrice ?? "n/a"} coingecko=${coingeckoPrice ?? "n/a"} ` +
        `(${(deviationBps / 100).toFixed(2)}% deviation)`
    );
    this.name = "StockPriceValidationError";
    this.teamId = teamId;
    this.navPrice = navPrice;
    this.dinariPrice = dinariPrice;
    this.coingeckoPrice = coingeckoPrice;
    this.deviationBps = deviationBps;
  }
}

/** Result of the last-NAV fallback eligibility check. */
export interface LastNavFallbackCheck {
  eligible: boolean;
  /** Short machine-readable reason (logged on every check that matters). */
  reason: string;
  /** The last published NAV tick, when one exists. */
  tick?: NavTick;
  /** Age of the tick at full-time (ms), when a tick exists. */
  ageAtFullTimeMs?: number;
}

const STALE_WARN_THROTTLE_MS = 5 * 60_000;

export class StockPriceFeed {
  private readonly nav: StockNavPoller;
  private readonly dinari: DinariPriceSource | undefined;
  private readonly coingecko: CoingeckoPriceSource | undefined;
  /** teamId -> verified CoinGecko coin id. EMPTY by default: no ids for
   *  these stocks have been verified, and none are invented. */
  private readonly coingeckoIds: ReadonlyMap<number, string>;
  private readonly maxDeviationBps: number;
  private readonly navStaleAfterMs: number;
  private readonly coingeckoStaleAfterMs: number;
  private readonly lastStaleWarnAt = new Map<string, number>();
  private warnedDinariUnavailable = false;
  /** Count of last-NAV fallback uses this process lifetime (ops visibility). */
  private lastNavFallbackUses = 0;

  constructor(
    nav: StockNavPoller,
    opts: {
      dinari?: DinariPriceSource;
      coingecko?: CoingeckoPriceSource;
      coingeckoIds?: ReadonlyMap<number, string>;
      maxDeviationBps?: number;
      navStaleAfterMs?: number;
      coingeckoStaleAfterMs?: number;
    } = {}
  ) {
    this.nav = nav;
    this.dinari = opts.dinari;
    this.coingecko = opts.coingecko;
    this.coingeckoIds = opts.coingeckoIds ?? new Map();
    this.maxDeviationBps = opts.maxDeviationBps ?? stockConfig.nav.maxDeviationBps;
    this.navStaleAfterMs = opts.navStaleAfterMs ?? stockConfig.nav.staleAfterMs;
    this.coingeckoStaleAfterMs = opts.coingeckoStaleAfterMs ?? stockConfig.coingecko.staleAfterMs;
  }

  private teamDef(teamId: number) {
    const def = STOCK_TEAMS.find((t) => t.teamId === teamId);
    if (!def) throw new Error(`[StockPriceFeed] unknown teamId: ${teamId}`);
    return def;
  }

  /**
   * Get the validated, submission-ready price for one team.
   * @param preferredSource soft preference (the start snapshot's source),
   *   used when fresh, otherwise priority order applies.
   * @throws StockPriceValidationError when feeds disagree (do NOT submit).
   * @throws StockPriceUnavailableError when no fresh source exists (do NOT submit).
   */
  getValidatedPrice(teamId: number, preferredSource?: StockPriceSource): StockValidatedPrice {
    const def = this.teamDef(teamId);
    const now = Date.now();

    // Tier 1, Chainlink NAV (primary). Missing nav_price = no price.
    let navPrice: string | null = null;
    let navPriceUpdatedAtIso: string | null = null;
    const tick: NavTick | undefined = this.nav.getLatest(teamId);
    if (tick && now - tick.navPriceUpdatedAtMs <= this.navStaleAfterMs) {
      navPrice = tick.navPrice;
      navPriceUpdatedAtIso = tick.navPriceUpdatedAtIso;
    }

    // Tier 2, Dinari (GATED). Only when the user supplied a key AND a
    // client was wired in. A key with no client is not a fallback: it is
    // a configuration gap, logged once, and the tier is skipped.
    let dinariPrice: string | null = null;
    if (stockConfig.dinari.apiKeyId !== "") {
      if (this.dinari) {
        const d = this.dinari.getLatest(def.ticker);
        if (d) dinariPrice = d.price;
      } else if (!this.warnedDinariUnavailable) {
        this.warnedDinariUnavailable = true;
        logger.error("[StockPriceFeed] DINARI_API_KEY_ID is set but no Dinari client is wired in, Dinari tier is INERT, snapshots will block on stale NAV instead of falling back", {
          hint: "Dinari is enterprise/key-gated and its API surface is unverified. Wire a DinariPriceSource, or remove the key to silence this.",
        });
      }
    }

    // Tier 3, CoinGecko (last resort). Only when a verified id exists
    // for this team AND CoinGecko actually has a price for it. An
    // unverified or missing id means no tier, never a guessed id.
    let coingeckoPrice: string | null = null;
    const cgId = this.coingeckoIds.get(teamId);
    if (this.coingecko && cgId) {
      const cg = this.coingecko.getPrice(cgId);
      if (cg != null && now - cg.receivedAtMs <= this.coingeckoStaleAfterMs) {
        coingeckoPrice = cg.priceUsd;
      }
    }

    // Pick the primary: preferred source first (soft), else priority order.
    const candidates: Array<{ source: StockPriceSource; price: string | null }> = [
      { source: "nav", price: navPrice },
      { source: "dinari", price: dinariPrice },
      { source: "coingecko-fallback", price: coingeckoPrice },
    ];
    let chosen = candidates.find((c) => c.price !== null);
    if (preferredSource) {
      const pref = candidates.find((c) => c.source === preferredSource && c.price !== null);
      if (pref) {
        chosen = pref;
      } else if (chosen) {
        logger.debug("[StockPriceFeed] preferred source stale, falling back to priority order", {
          teamId,
          preferredSource,
          source: chosen.source,
        });
      }
    }
    if (!chosen || chosen.price === null) {
      throw new StockPriceUnavailableError(
        teamId,
        `No fresh price for stock team ${teamId} (${def.ticker}): ` +
          `nav: ${navPrice ?? "stale/missing"}, ` +
          `dinari: ${dinariPrice ?? "stale/missing/gated"}, ` +
          `coingecko: ${coingeckoPrice ?? "stale/missing/no-verified-id"}`
      );
    }
    const primaryPrice = chosen.price;

    // Cross-validate every other fresh source against the chosen primary.
    const primaryScaled = priceToScaled(primaryPrice);
    let maxDev: number | null = null;
    for (const c of candidates) {
      if (c.source === chosen.source || c.price === null) continue;
      const dev = deviationBps(priceToScaled(c.price), primaryScaled);
      if (dev === null) continue;
      if (maxDev === null || dev > maxDev) maxDev = dev;
      if (dev > this.maxDeviationBps) {
        logger.error("[StockPriceFeed] VALIDATION FAILED, feeds disagree, blocking snapshot", {
          teamId,
          ticker: def.ticker,
          source: chosen.source,
          navPrice,
          dinariPrice,
          coingeckoPrice,
          deviationBps: dev,
        });
        throw new StockPriceValidationError(teamId, navPrice, dinariPrice, coingeckoPrice, dev);
      }
    }

    if (chosen.source !== "nav" && navPrice === null) {
      this.warnTierStaleThrottled(teamId, def.ticker, chosen.source, primaryPrice);
    }

    return {
      teamId,
      scaled: primaryScaled,
      source: chosen.source,
      navPrice,
      navPriceUpdatedAtIso,
      dinariPrice,
      coingeckoPrice,
      deviationBps: maxDev,
      lastNavFallback: false,
      lastNavFallbackAgeMs: null,
    };
  }

  /** How many times the last-NAV fallback has been used (this process). */
  getLastNavFallbackUses(): number {
    return this.lastNavFallbackUses;
  }

  /**
   * LAST-NAV FALLBACK eligibility (user approved 2026-11-18). Pure check,
   * no logging except through the caller: returns why the fallback does
   * or does not apply for one team at full-time.
   *
   * All four conditions are required:
   *   (a) a last NAV tick exists at all;
   *   (b) it was published before kickoff (quiet feed, not post-match data);
   *   (c) it is no older than lastNavFallbackMaxAgeMs (24h) at full-time;
   *   (d) the feed is healthy (poller last poll succeeded recently).
   * A team with no NAV at all fails (a) and is never covered: the fallback
   * does NOT fix missing NAV, which is why the roster shrank to 12.
   */
  checkLastNavFallback(
    teamId: number,
    windowStartMs: number,
    windowEndMs: number,
    now: number = Date.now()
  ): LastNavFallbackCheck {
    this.teamDef(teamId); // throws on an unknown teamId
    const tick = this.nav.getLatest(teamId);
    if (!tick) {
      return { eligible: false, reason: "no NAV ever published for this team" };
    }
    const ageAtFullTimeMs = windowEndMs - tick.navPriceUpdatedAtMs;
    if (tick.navPriceUpdatedAtMs > windowStartMs) {
      return {
        eligible: false,
        reason: "latest NAV was published after kickoff, not before it",
        tick,
        ageAtFullTimeMs,
      };
    }
    if (ageAtFullTimeMs > stockConfig.nav.lastNavFallbackMaxAgeMs) {
      return {
        eligible: false,
        reason: `last NAV is older than the 24h fallback bound (${Math.round(ageAtFullTimeMs / 3_600_000)}h old at full-time)`,
        tick,
        ageAtFullTimeMs,
      };
    }
    if (!this.nav.isFeedHealthy(stockConfig.nav.feedHealthyWithinMs, now)) {
      return {
        eligible: false,
        reason: "NAV feed is not healthy (no recent successful poll), outage is not a quiet feed",
        tick,
        ageAtFullTimeMs,
      };
    }
    // Pricing bound as a final guard: the reused NAV must still be a
    // fresh-enough price (25h). The 24h fallback bound is tighter, so
    // this only trips if the call runs long after full-time.
    if (now - tick.navPriceUpdatedAtMs > this.navStaleAfterMs) {
      return {
        eligible: false,
        reason: "last NAV is stale for pricing",
        tick,
        ageAtFullTimeMs,
      };
    }
    return { eligible: true, reason: "healthy feed, quiet window, last NAV within 24h", tick, ageAtFullTimeMs };
  }

  /**
   * Full-time end price for one team: the normal path when the team
   * performed in the window, the last-NAV fallback when it did not but
   * is eligible, and StockPriceUnavailableError otherwise (the lifecycle
   * turns that into a forfeit for this team). The returned quote carries
   * lastNavFallback: true when the fallback was used, and every use is
   * logged at WARN and counted.
   */
  resolveEndPrice(
    teamId: number,
    windowStartMs: number,
    windowEndMs: number,
    fixtureId?: bigint,
    preferredSource?: StockPriceSource
  ): StockValidatedPrice {
    const def = this.teamDef(teamId);
    if (this.isWindowFresh(teamId, windowStartMs, windowEndMs)) {
      return this.getValidatedPrice(teamId, preferredSource);
    }
    const check = this.checkLastNavFallback(teamId, windowStartMs, windowEndMs);
    if (!check.eligible || !check.tick) {
      throw new StockPriceUnavailableError(
        teamId,
        `No performance and no last-NAV fallback for stock team ${teamId} (${def.ticker}) in the match window: ${check.reason}`
      );
    }
    const quote = this.getValidatedPrice(teamId, preferredSource);
    quote.lastNavFallback = true;
    quote.lastNavFallbackAgeMs = check.ageAtFullTimeMs ?? null;
    this.lastNavFallbackUses++;
    logger.warn("[StockPriceFeed] LAST_NAV_FALLBACK used as end price (healthy feed, quiet window)", {
      fixtureId: fixtureId?.toString() ?? null,
      teamId,
      ticker: def.ticker,
      navPrice: check.tick.navPrice,
      navPriceUpdatedAt: check.tick.navPriceUpdatedAtIso,
      ageAtFullTimeMs: check.ageAtFullTimeMs,
      fallbackUses: this.lastNavFallbackUses,
    });
    return quote;
  }

  /**
   * FORFEIT test (locked rule): did this team have a NAV published inside
   * the match window [windowStartMs, windowEndMs + graceMs]? The check
   * reads the latest tick's nav_price_updated_at: NAV publication is
   * monotonic, so the latest publish time tells whether any publish
   * landed in the window. A team whose NAV last published before the
   * window (quiet stock, or a token with no NAV at all like GMEc on
   * 2026-11-16) had no performance for the match period.
   *
   * Call at FULL-TIME, never at kickoff: at kickoff the window has not
   * happened yet. The start snapshot uses getValidatedPrice (25h pricing
   * bound); this test decides the forfeit at FT.
   */
  isWindowFresh(
    teamId: number,
    windowStartMs: number,
    windowEndMs: number,
    graceMs: number = stockConfig.nav.forfeitGraceMs
  ): boolean {
    const tick = this.nav.getLatest(teamId);
    if (!tick) return false;
    return (
      tick.navPriceUpdatedAtMs >= windowStartMs &&
      tick.navPriceUpdatedAtMs <= windowEndMs + graceMs
    );
  }

  /** Teams whose NAV is currently stale for pricing (gap-fill diagnostics). */
  navGapTeamIds(): number[] {
    const now = Date.now();
    const gaps: number[] = [];
    for (const t of STOCK_TEAMS) {
      const tick = this.nav.getLatest(t.teamId);
      if (!tick || now - tick.navPriceUpdatedAtMs > this.navStaleAfterMs) gaps.push(t.teamId);
    }
    return gaps;
  }

  private warnTierStaleThrottled(
    teamId: number,
    ticker: string,
    usedSource: StockPriceSource,
    usedPrice: string
  ): void {
    const now = Date.now();
    const key = `${teamId}:nav`;
    const last = this.lastStaleWarnAt.get(key) ?? 0;
    if (now - last < STALE_WARN_THROTTLE_MS) return;
    this.lastStaleWarnAt.set(key, now);
    logger.warn("[StockPriceFeed] NAV stale/missing, using fallback source", {
      teamId,
      ticker,
      usedSource,
      usedPrice,
    });
  }

  /** Human-readable one-liner for logs / the live API. */
  describeQuote(q: StockValidatedPrice): string {
    return (
      `team=${q.teamId} price=${scaledToPrice(q.scaled)} source=${q.source}` +
      (q.navPrice !== null ? ` nav=${q.navPrice}` : "") +
      (q.navPriceUpdatedAtIso !== null ? ` navUpdatedAt=${q.navPriceUpdatedAtIso}` : "") +
      (q.dinariPrice !== null ? ` dinari=${q.dinariPrice}` : "") +
      (q.coingeckoPrice !== null ? ` cg=${q.coingeckoPrice}` : "") +
      (q.deviationBps !== null ? ` dev=${(q.deviationBps / 100).toFixed(3)}%` : " dev=n/a") +
      (q.lastNavFallback ? ` lastNavFallback age=${q.lastNavFallbackAgeMs}ms` : "")
    );
  }
}
