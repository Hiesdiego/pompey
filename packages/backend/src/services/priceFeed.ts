

import type { CoingeckoPoller } from "./coingecko.js";
import { priceToScaled, deviationBps, scaledToPrice } from "../lib/priceMath.js";
import { logger } from "../lib/logger.js";

export interface PrimaryPriceSource {
  getLatest(symbol: string): { price: string; receivedAtMs: number } | undefined;
}

export interface TeamPriceMap {
  teamId: number;

  coinbasePair: string;

  binanceSymbol: string;

  coingeckoId: string;
}

export type PriceSource = "coinbase" | "binance" | "coingecko-fallback";

export interface ValidatedPrice {
  teamId: number;

  scaled: bigint;
  source: PriceSource;
  coinbasePrice: string | null;
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
  readonly coinbasePrice: string | null;
  readonly binancePrice: string | null;
  readonly coingeckoPrice: string | null;
  readonly deviationBps: number;
  constructor(
    teamId: number,
    coinbasePrice: string | null,
    binancePrice: string | null,
    coingeckoPrice: string | null,
    deviationBps: number
  ) {
    super(
      `Price feeds disagree for team ${teamId}: coinbase=${coinbasePrice ?? "n/a"} ` +
        `binance=${binancePrice ?? "n/a"} coingecko=${coingeckoPrice ?? "n/a"} ` +
        `(${(deviationBps / 100).toFixed(2)}% deviation)`
    );
    this.name = "PriceValidationError";
    this.teamId = teamId;
    this.coinbasePrice = coinbasePrice;
    this.binancePrice = binancePrice;
    this.coingeckoPrice = coingeckoPrice;
    this.deviationBps = deviationBps;
  }
}

const STALE_WARN_THROTTLE_MS = 5 * 60_000;

export class PriceFeed {
  private readonly coinbase: PrimaryPriceSource;
  private readonly binancePrimaries: PrimaryPriceSource[];
  private readonly coingecko: CoingeckoPoller;
  private readonly teams: TeamPriceMap[];
  private readonly maxDeviationBps: number;
  private readonly coinbaseStaleAfterMs: number;
  private readonly binanceStaleAfterMs: number;
  private readonly coingeckoStaleAfterMs: number;

  private readonly lastStaleWarnAt = new Map<string, number>();

  constructor(
    coinbase: PrimaryPriceSource,
    binancePrimaries: PrimaryPriceSource[],
    coingecko: CoingeckoPoller,
    teams: TeamPriceMap[],
    opts: {
      maxDeviationBps: number;
      coinbaseStaleAfterMs: number;
      binanceStaleAfterMs: number;
      coingeckoStaleAfterMs: number;
    }
  ) {
    this.coinbase = coinbase;
    this.binancePrimaries = binancePrimaries;
    this.coingecko = coingecko;
    this.teams = teams;
    this.maxDeviationBps = opts.maxDeviationBps;
    this.coinbaseStaleAfterMs = opts.coinbaseStaleAfterMs;
    this.binanceStaleAfterMs = opts.binanceStaleAfterMs;
    this.coingeckoStaleAfterMs = opts.coingeckoStaleAfterMs;
  }

  private teamDef(teamId: number): TeamPriceMap {
    const def = this.teams.find((t) => t.teamId === teamId);
    if (!def) throw new Error(`[PriceFeed] unknown teamId: ${teamId}`);
    return def;
  }

  getValidatedPrice(teamId: number, preferredSource?: PriceSource): ValidatedPrice {
    const def = this.teamDef(teamId);
    const now = Date.now();

    let coinbasePrice: string | null = null;
    if (def.coinbasePair) {
      const tick = this.coinbase.getLatest(def.coinbasePair);
      if (tick && now - tick.receivedAtMs <= this.coinbaseStaleAfterMs) {
        coinbasePrice = tick.price;
      }
    }

    let binancePrice: string | null = null;
    if (def.binanceSymbol) {
      let binanceAtMs = 0;
      for (const feed of this.binancePrimaries) {
        const tick = feed.getLatest(def.binanceSymbol);
        if (tick && tick.receivedAtMs > binanceAtMs) {
          binanceAtMs = tick.receivedAtMs;
          binancePrice = tick.price;
        }
      }
      if (!(binancePrice !== null && now - binanceAtMs <= this.binanceStaleAfterMs)) {
        binancePrice = null;
      }
    }

    const cg = def.coingeckoId ? this.coingecko.getPrice(def.coingeckoId) : undefined;
    const coingeckoPrice =
      cg != null && now - cg.receivedAtMs <= this.coingeckoStaleAfterMs ? cg.priceUsd : null;

    const candidates: Array<{ source: PriceSource; price: string | null }> = [
      { source: "coinbase", price: coinbasePrice },
      { source: "binance", price: binancePrice },
      { source: "coingecko-fallback", price: coingeckoPrice },
    ];
    let chosen = candidates.find((c) => c.price !== null);
    if (preferredSource) {
      const pref = candidates.find((c) => c.source === preferredSource && c.price !== null);
      if (pref) {
        chosen = pref;
      } else if (chosen) {
        logger.debug("[PriceFeed] preferred source stale — falling back to priority order", {
          teamId,
          preferredSource,
          source: chosen.source,
        });
      }
    }
    if (!chosen || chosen.price === null) {
      throw new PriceUnavailableError(
        teamId,
        `No fresh price for team ${teamId} (coinbase: ${coinbasePrice ?? "stale/missing"}, ` +
          `binance: ${binancePrice ?? "stale/missing"}, ` +
          `coingecko: ${coingeckoPrice ?? "stale/missing"})`
      );
    }
    const primaryPrice = chosen.price;

    const primaryScaled = priceToScaled(primaryPrice);
    let maxDev: number | null = null;
    for (const c of candidates) {
      if (c.source === chosen.source || c.price === null) continue;
      const dev = deviationBps(priceToScaled(c.price), primaryScaled);
      if (dev === null) continue;
      if (maxDev === null || dev > maxDev) maxDev = dev;
      if (dev > this.maxDeviationBps) {
        logger.error("[PriceFeed] VALIDATION FAILED — feeds disagree, blocking snapshot", {
          teamId,
          source: chosen.source,
          coinbasePrice,
          binancePrice,
          coingeckoPrice,
          deviationBps: dev,
        });
        throw new PriceValidationError(
          teamId,
          coinbasePrice,
          binancePrice,
          coingeckoPrice,
          dev
        );
      }
    }

    if (chosen.source !== "coinbase" && def.coinbasePair && coinbasePrice === null) {
      this.warnTierStaleThrottled(teamId, "coinbase", def.coinbasePair, chosen.source, primaryPrice);
    }
    if (chosen.source !== "binance" && def.binanceSymbol && binancePrice === null) {
      this.warnTierStaleThrottled(teamId, "binance", def.binanceSymbol, chosen.source, primaryPrice);
    }

    return {
      teamId,
      scaled: primaryScaled,
      source: chosen.source,
      coinbasePrice,
      binancePrice,
      coingeckoPrice,
      deviationBps: maxDev,
    };
  }

  private warnTierStaleThrottled(
    teamId: number,
    tier: "coinbase" | "binance",
    symbol: string,
    usedSource: PriceSource,
    usedPrice: string
  ): void {
    const now = Date.now();
    const key = `${teamId}:${tier}`;
    const last = this.lastStaleWarnAt.get(key) ?? 0;
    if (now - last < STALE_WARN_THROTTLE_MS) return;
    this.lastStaleWarnAt.set(key, now);

    const health = tier === "coinbase" ? this.coinbaseHealth() : this.binanceHealth();
    if (health.fresh >= Math.ceil(health.total / 2) && health.total > 1) {
      logger.error(`[PriceFeed] SYMBOL FEED GAP — ${tier} healthy overall, no ticks for this symbol`, {
        teamId,
        symbol,
        healthySymbols: `${health.fresh}/${health.total}`,
        usedSource,
        usedPrice,
        hint: "Check the pair/symbol is listed and the poller/WS stream name matches.",
      });
      return;
    }
    logger.warn(`[PriceFeed] ${tier} stale/missing — using ${usedSource} fallback`, {
      teamId,
      symbol,
      usedPrice,
    });
  }

  private coinbaseHealth(): { fresh: number; total: number } {
    const now = Date.now();
    let fresh = 0;
    let total = 0;
    for (const t of this.teams) {
      if (!t.coinbasePair) continue;
      total++;
      const tick = this.coinbase.getLatest(t.coinbasePair);
      if (tick && now - tick.receivedAtMs <= this.coinbaseStaleAfterMs) fresh++;
    }
    return { fresh, total };
  }

  private binanceHealth(): { fresh: number; total: number } {
    const now = Date.now();
    let fresh = 0;
    let total = 0;
    for (const t of this.teams) {
      if (!t.binanceSymbol) continue;
      total++;
      for (const feed of this.binancePrimaries) {
        const tick = feed.getLatest(t.binanceSymbol);
        if (tick && now - tick.receivedAtMs <= this.binanceStaleAfterMs) {
          fresh++;
          break;
        }
      }
    }
    return { fresh, total };
  }

  coinbaseGapPairs(): string[] {
    const health = this.coinbaseHealth();
    if (health.total <= 1 || health.fresh < Math.ceil(health.total / 2)) return [];
    const now = Date.now();
    const gaps: string[] = [];
    for (const t of this.teams) {
      if (!t.coinbasePair) continue;
      const tick = this.coinbase.getLatest(t.coinbasePair);
      if (!tick || now - tick.receivedAtMs > this.coinbaseStaleAfterMs) {
        gaps.push(t.coinbasePair);
      }
    }
    return gaps;
  }

  binanceGapSymbols(): string[] {
    const health = this.binanceHealth();
    if (health.total <= 1 || health.fresh < Math.ceil(health.total / 2)) return [];
    const now = Date.now();
    const gaps: string[] = [];
    for (const t of this.teams) {
      if (!t.binanceSymbol) continue;
      let fresh = false;
      for (const feed of this.binancePrimaries) {
        const tick = feed.getLatest(t.binanceSymbol);
        if (tick && now - tick.receivedAtMs <= this.binanceStaleAfterMs) {
          fresh = true;
          break;
        }
      }
      if (!fresh) gaps.push(t.binanceSymbol);
    }
    return gaps;
  }

  describeQuote(q: ValidatedPrice): string {
    return (
      `team=${q.teamId} price=${scaledToPrice(q.scaled)} source=${q.source}` +
      (q.coinbasePrice !== null ? ` cb=${q.coinbasePrice}` : "") +
      (q.binancePrice !== null ? ` bin=${q.binancePrice}` : "") +
      (q.coingeckoPrice !== null ? ` cg=${q.coingeckoPrice}` : "") +
      (q.deviationBps !== null ? ` dev=${(q.deviationBps / 100).toFixed(3)}%` : " dev=n/a")
    );
  }
}
