/**
 * Price validator + aggregator — the single choke point every snapshot
 * goes through before it touches the chain (spec P2.3).
 *
 * Source priority:
 *   1. Binance (primary) — WebSocket ticks AND REST polls are treated as ONE
 *      logical source; the freshest tick across both wins. The REST poller
 *      only runs while the WS is down, so normally there's a single feed.
 *   2. CoinGecko REST poll (fallback) — 5-minute cadence.
 *
 * Validation rules:
 * - If BOTH sources are fresh and disagree by more than maxDeviationBps
 *   (default 2%), the price is REJECTED — no snapshot is submitted, and an
 *   alert is logged for manual review. A divergent feed must never decide
 *   a match on its own.
 * - If Binance is stale/missing but CoinGecko is fresh, CoinGecko is used
 *   (degraded mode, logged).
 * - If Binance is fresh but CoinGecko is stale/missing, Binance is used
 *   alone (e.g. first minutes after boot, CoinGecko outage).
 * - If both are stale/missing, the price is unavailable → the caller must
 *   NOT submit (the match simply waits; the contract has no deadline).
 *
 * Every returned quote carries its source + both raw values so the snapshot
 * submitter can log the full audit trail.
 */

import type { CoingeckoPoller } from "./coingecko.js";
import { priceToScaled, deviationBps, scaledToPrice } from "../lib/priceMath.js";
import { logger } from "../lib/logger.js";

/** Anything that can serve a latest Binance tick (WS feed, REST poller). */
export interface PrimaryPriceSource {
  getLatest(symbol: string): { price: string; receivedAtMs: number } | undefined;
}

export interface TeamPriceMap {
  teamId: number;
  binanceSymbol: string; // e.g. "BTCUSDT"
  coingeckoId: string; // e.g. "bitcoin"
}

export type PriceSource = "binance" | "coingecko-fallback";

export interface ValidatedPrice {
  teamId: number;
  /** Scaled by 10^8 — ready for PriceOracle submission. */
  scaled: bigint;
  source: PriceSource;
  binancePrice: string | null;
  coingeckoPrice: string | null;
  deviationBps: number | null;
}

export class PriceUnavailableError extends Error {
  readonly teamId: number;
  constructor(teamId: number, message: string) {
    super(message);
    this.name = "PriceUnavailableError";
    this.teamId = teamId;
  }
}

export class PriceValidationError extends Error {
  readonly teamId: number;
  readonly binancePrice: string;
  readonly coingeckoPrice: string;
  readonly deviationBps: number;
  constructor(teamId: number, binancePrice: string, coingeckoPrice: string, deviationBps: number) {
    super(
      `Price feeds disagree for team ${teamId}: binance=${binancePrice} ` +
        `coingecko=${coingeckoPrice} (${(deviationBps / 100).toFixed(2)}% deviation)`
    );
    this.name = "PriceValidationError";
    this.teamId = teamId;
    this.binancePrice = binancePrice;
    this.coingeckoPrice = coingeckoPrice;
    this.deviationBps = deviationBps;
  }
}

export class PriceFeed {
  private readonly primaries: PrimaryPriceSource[];
  private readonly coingecko: CoingeckoPoller;
  private readonly teams: TeamPriceMap[];
  private readonly maxDeviationBps: number;
  private readonly binanceStaleAfterMs: number;
  private readonly coingeckoStaleAfterMs: number;

  constructor(
    primaries: PrimaryPriceSource[],
    coingecko: CoingeckoPoller,
    teams: TeamPriceMap[],
    opts: { maxDeviationBps: number; binanceStaleAfterMs: number; coingeckoStaleAfterMs: number }
  ) {
    this.primaries = primaries;
    this.coingecko = coingecko;
    this.teams = teams;
    this.maxDeviationBps = opts.maxDeviationBps;
    this.binanceStaleAfterMs = opts.binanceStaleAfterMs;
    this.coingeckoStaleAfterMs = opts.coingeckoStaleAfterMs;
  }

  private teamDef(teamId: number): TeamPriceMap {
    const def = this.teams.find((t) => t.teamId === teamId);
    if (!def) throw new Error(`[PriceFeed] unknown teamId: ${teamId}`);
    return def;
  }

  /**
   * Get the validated, submission-ready price for one team.
   * @throws PriceValidationError when feeds disagree (do NOT submit).
   * @throws PriceUnavailableError when no fresh source exists (do NOT submit).
   */
  getValidatedPrice(teamId: number): ValidatedPrice {
    const def = this.teamDef(teamId);
    const now = Date.now();

    // Freshest tick across all primary (Binance) sources wins.
    let binancePrice: string | null = null;
    let binanceAtMs = 0;
    for (const feed of this.primaries) {
      const tick = feed.getLatest(def.binanceSymbol);
      if (tick && tick.receivedAtMs > binanceAtMs) {
        binanceAtMs = tick.receivedAtMs;
        binancePrice = tick.price;
      }
    }
    const binanceFresh = binancePrice !== null && now - binanceAtMs <= this.binanceStaleAfterMs;
    if (!binanceFresh) binancePrice = null;

    const cg = this.coingecko.getPrice(def.coingeckoId);
    const cgFresh =
      cg != null && now - cg.receivedAtMs <= this.coingeckoStaleAfterMs;
    const coingeckoPrice = cgFresh ? cg!.priceUsd : null;

    // Both fresh → cross-validate.
    if (binancePrice !== null && coingeckoPrice !== null) {
      const bScaled = priceToScaled(binancePrice);
      const cScaled = priceToScaled(coingeckoPrice);
      const dev = deviationBps(bScaled, cScaled);
      if (dev !== null && dev > this.maxDeviationBps) {
        logger.error("[PriceFeed] VALIDATION FAILED — feeds disagree, blocking snapshot", {
          teamId,
          binancePrice,
          coingeckoPrice,
          deviationBps: dev,
        });
        throw new PriceValidationError(teamId, binancePrice, coingeckoPrice, dev);
      }
      return {
        teamId,
        scaled: bScaled,
        source: "binance",
        binancePrice,
        coingeckoPrice,
        deviationBps: dev,
      };
    }

    // Degraded: Binance down, CoinGecko carrying.
    if (coingeckoPrice !== null) {
      logger.warn("[PriceFeed] Binance stale/missing — using CoinGecko fallback", {
        teamId,
        coingeckoPrice,
      });
      return {
        teamId,
        scaled: priceToScaled(coingeckoPrice),
        source: "coingecko-fallback",
        binancePrice,
        coingeckoPrice,
        deviationBps: null,
      };
    }

    // Primary healthy, fallback stale/missing — trust Binance alone
    // (e.g. during the first minutes after boot before CoinGecko's first
    // poll, or during a CoinGecko outage).
    if (binancePrice !== null) {
      logger.debug("[PriceFeed] CoinGecko stale/missing — using Binance alone", {
        teamId,
        binancePrice,
      });
      return {
        teamId,
        scaled: priceToScaled(binancePrice),
        source: "binance",
        binancePrice,
        coingeckoPrice,
        deviationBps: null,
      };
    }

    // Nothing usable.
    throw new PriceUnavailableError(
      teamId,
      `No fresh price for team ${teamId} (binance: ${binancePrice ?? "stale/missing"}, ` +
        `coingecko: ${coingeckoPrice ?? "stale/missing"})`
    );
  }

  /** Human-readable one-liner for logs / the live API. */
  describeQuote(q: ValidatedPrice): string {
    return (
      `team=${q.teamId} price=${scaledToPrice(q.scaled)} source=${q.source}` +
      (q.deviationBps !== null ? ` dev=${(q.deviationBps / 100).toFixed(3)}%` : " dev=n/a")
    );
  }
}
