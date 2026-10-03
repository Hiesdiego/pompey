/**
 * CoinGecko poller — TICKR's FALLBACK price source + token metadata provider.
 *
 * Design (from CoinGecko official docs, verified 2026-09-24):
 * - Free Demo tier: 100 calls/min, 10,000 credits/month. Auth via
 *   `x-cg-demo-api-key` header against https://api.coingecko.com/api/v3.
 * - Prices: ONE `GET /simple/price` call for all 20 coins every 5 minutes
 *   (≈288 calls/day — safely inside the monthly budget). Demo data refreshes
 *   every 60s, so polling faster is pure waste.
 * - Unknown coin IDs fail SILENTLY (HTTP 200 with missing keys) → we validate
 *   all 20 IDs are present on every poll and alert loudly if any are missing.
 * - Metadata (logos/symbols): ONE `GET /coins/markets` call at startup,
 *   refreshed daily — logos effectively never change.
 * - 429 → exponential backoff, never hot-loop.
 */

import { EventEmitter } from "node:events";
import { logger } from "../lib/logger.js";

export interface CgPrice {
  /** CoinGecko coin ID, e.g. "bitcoin". */
  coinId: string;
  /** Decimal price string in USD. */
  priceUsd: string;
  /** CoinGecko's last_updated_at (unix seconds) — used for staleness checks. */
  updatedAtSec: number;
  /** Local receipt time (ms). */
  receivedAtMs: number;
}

export interface CgTokenMeta {
  coinId: string;
  symbol: string;
  name: string;
  imageUrl: string;
}

interface PollerEventMap {
  prices: (prices: Map<string, CgPrice>) => void;
  metadata: (meta: Map<string, CgTokenMeta>) => void;
  error: (err: Error) => void;
}

const PRICE_POLL_MS = 5 * 60 * 1000;
const META_REFRESH_MS = 24 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;

export class CoingeckoPoller extends EventEmitter {
  private readonly coinIds: string[];
  private readonly baseUrl: string;
  private readonly apiKey: string;

  private prices = new Map<string, CgPrice>();
  private metadata = new Map<string, CgTokenMeta>();
  private priceTimer: NodeJS.Timeout | null = null;
  private metaTimer: NodeJS.Timeout | null = null;
  private backoffMs = 30_000;
  private running = false;

  constructor(coinIds: string[], baseUrl: string, apiKey: string) {
    super();
    if (coinIds.length === 0) throw new Error("[CoingeckoPoller] coinIds must not be empty");
    this.coinIds = [...coinIds];
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info("[CoingeckoPoller] starting", {
      coins: this.coinIds.length,
      keyConfigured: this.apiKey !== "",
    });
    // Fire immediately (don't await — timers drive the steady state).
    void this.pollPrices().catch(() => {});
    void this.refreshMetadata().catch(() => {});
    this.priceTimer = setInterval(() => {
      void this.pollPrices().catch(() => {});
    }, PRICE_POLL_MS);
    this.priceTimer.unref?.();
    this.metaTimer = setInterval(() => {
      void this.refreshMetadata().catch(() => {});
    }, META_REFRESH_MS);
    this.metaTimer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.priceTimer) clearInterval(this.priceTimer);
    if (this.metaTimer) clearInterval(this.metaTimer);
    this.priceTimer = this.metaTimer = null;
  }

  getPrices(): Map<string, CgPrice> {
    return new Map(this.prices);
  }

  getPrice(coinId: string): CgPrice | undefined {
    return this.prices.get(coinId);
  }

  getMetadata(): Map<string, CgTokenMeta> {
    return new Map(this.metadata);
  }

  // ------------------------------------------------------------------ prices

  private async pollPrices(): Promise<void> {
    if (!this.running) return;
    const params = new URLSearchParams({
      ids: this.coinIds.join(","),
      vs_currencies: "usd",
      precision: "full",
      include_last_updated_at: "true",
    });
    let res: Response;
    try {
      res = await this.get(`/simple/price?${params}`);
    } catch (err) {
      this.onFailure(err);
      return;
    }

    let body: Record<string, { usd?: number | string; last_updated_at?: number }>;
    try {
      body = (await res.json()) as typeof body;
    } catch (err) {
      this.onFailure(new Error(`unparseable /simple/price body: ${String(err)}`));
      return;
    }

    // CoinGecko silently omits unknown IDs — treat a missing coin as a hard failure.
    const missing = this.coinIds.filter((id) => body[id]?.usd == null);
    if (missing.length > 0) {
      this.onFailure(
        new Error(`CoinGecko omitted ${missing.length} coin(s): ${missing.join(", ")}`)
      );
      return;
    }

    const now = Date.now();
    const next = new Map<string, CgPrice>();
    for (const id of this.coinIds) {
      next.set(id, {
        coinId: id,
        priceUsd: String(body[id].usd),
        updatedAtSec: Number(body[id].last_updated_at ?? 0),
        receivedAtMs: now,
      });
    }
    this.prices = next;
    this.backoffMs = 30_000; // healthy poll resets backoff
    this.emit("prices", this.getPrices());
    logger.debug("[CoingeckoPoller] prices updated", { coins: next.size });
  }

  // ------------------------------------------------------------------ metadata

  private async refreshMetadata(): Promise<void> {
    if (!this.running) return;
    const params = new URLSearchParams({
      vs_currency: "usd",
      ids: this.coinIds.join(","),
      per_page: String(this.coinIds.length),
      page: "1",
    });
    let res: Response;
    try {
      res = await this.get(`/coins/markets?${params}`);
    } catch (err) {
      logger.warn("[CoingeckoPoller] metadata refresh failed", { error: String(err) });
      return;
    }
    let list: Array<{ id: string; symbol: string; name: string; image?: string }>;
    try {
      list = (await res.json()) as typeof list;
    } catch {
      logger.warn("[CoingeckoPoller] unparseable /coins/markets body");
      return;
    }
    const next = new Map<string, CgTokenMeta>();
    for (const entry of list ?? []) {
      if (!entry?.id) continue;
      next.set(entry.id, {
        coinId: entry.id,
        symbol: (entry.symbol ?? "").toUpperCase(),
        name: entry.name ?? entry.id,
        imageUrl: entry.image ?? "",
      });
    }
    if (next.size > 0) {
      this.metadata = next;
      this.emit("metadata", this.getMetadata());
      logger.info("[CoingeckoPoller] metadata refreshed", { coins: next.size });
    }
  }

  // ------------------------------------------------------------------ http

  private async get(path: string): Promise<Response> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) headers["x-cg-demo-api-key"] = this.apiKey;
    const res = await fetch(`${this.baseUrl}${path}`, { headers });

    if (res.status === 429) {
      throw new Error("CoinGecko rate limit hit (429)");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`CoinGecko auth error (${res.status}) — check COINGECKO_API_KEY`);
    }
    if (!res.ok) {
      throw new Error(`CoinGecko request failed: ${res.status} ${res.statusText}`);
    }
    return res;
  }

  private onFailure(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn("[CoingeckoPoller] poll failed", { error: error.message });
    this.emit("error", error);
    // Back off the next poll instead of hammering a failing endpoint.
    if (this.priceTimer) {
      clearInterval(this.priceTimer);
      const delay = Math.min(this.backoffMs, MAX_BACKOFF_MS);
      logger.info("[CoingeckoPoller] backing off", { inMs: delay });
      this.priceTimer = setTimeout(() => {
        if (!this.running) return;
        this.priceTimer = setInterval(() => {
          void this.pollPrices().catch(() => {});
        }, PRICE_POLL_MS);
        this.priceTimer.unref?.();
        void this.pollPrices().catch(() => {});
      }, delay);
      this.priceTimer.unref?.();
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  // Typed EventEmitter overrides
  on<K extends keyof PollerEventMap>(event: K, listener: PollerEventMap[K]): this {
    return super.on(event, listener);
  }
  emit<K extends keyof PollerEventMap>(event: K, ...args: Parameters<PollerEventMap[K]>): boolean {
    return super.emit(event, ...args);
  }
}
