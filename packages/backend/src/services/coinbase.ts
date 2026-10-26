

import { EventEmitter } from "node:events";
import { logger } from "../lib/logger.js";

export interface CoinbaseTick {
  pair: string;
  price: string;
  receivedAtMs: number;
}

export type CoinbasePollerStatus = "polling" | "error";

interface CoinbaseEventMap {
  price: (tick: CoinbaseTick) => void;
  status: (status: CoinbasePollerStatus, detail?: string) => void;
}

const MAX_BACKOFF_MS = 5 * 60_000;

const FETCH_CHUNK_SIZE = 10;

const warned404 = new Set<string>();

export class CoinbasePoller extends EventEmitter {
  private readonly pairs: string[];
  private readonly baseUrl: string;
  private readonly pollMs: number;
  private readonly latest = new Map<string, { price: string; receivedAtMs: number }>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private polling = false;
  private backoffMs: number;

  constructor(pairs: string[], baseUrl: string, pollMs: number) {
    super();
    const unique = [...new Set(pairs.map((p) => p.toUpperCase()))].filter(Boolean);
    if (unique.length === 0) throw new Error("[CoinbasePoller] pairs must not be empty");
    this.pairs = unique;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.pollMs = pollMs;
    this.backoffMs = pollMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info("[CoinbasePoller] starting", {
      baseUrl: this.baseUrl,
      pairs: this.pairs.length,
      pollMs: this.pollMs,
    });
    this.setStatus("polling");
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getLatest(pair: string): { price: string; receivedAtMs: number } | undefined {
    return this.latest.get(pair);
  }

  stalenessSec(): number | null {
    if (this.latest.size === 0) return null;
    const newest = Math.max(...[...this.latest.values()].map((tick) => tick.receivedAtMs));
    return Math.round((Date.now() - newest) / 1000);
  }

  async pollPairs(pairs: string[]): Promise<void> {
    const targets = [...new Set(pairs.map((p) => p.toUpperCase()))].filter(Boolean);
    if (targets.length === 0) return;
    let count = 0;
    const results = await Promise.all(targets.map((pair) => this.fetchPair(pair)));
    for (const [index, pair] of targets.entries()) {
      const price = results[index];
      if (price === null) continue;
      const receivedAtMs = Date.now();
      this.latest.set(pair, { price, receivedAtMs });
      this.emit("price", { pair, price, receivedAtMs });
      count++;
    }
    if (count > 0) {
      logger.info("[CoinbasePoller] gap-fill prices updated", {
        pairs: targets,
        count,
      });
    }
  }

  private armTimer(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, delayMs);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    if (!this.running || this.polling) return;
    this.polling = true;
    let count = 0;
    let failures = 0;
    try {
      for (let i = 0; i < this.pairs.length; i += FETCH_CHUNK_SIZE) {
        const chunk = this.pairs.slice(i, i + FETCH_CHUNK_SIZE);
        const results = await Promise.all(chunk.map((pair) => this.fetchPair(pair)));
        results.forEach((price, idx) => {
          if (price === null) {
            failures++;
            return;
          }
          const pair = chunk[idx];
          const receivedAtMs = Date.now();
          this.latest.set(pair, { price, receivedAtMs });
          this.emit("price", { pair, price, receivedAtMs });
          count++;
        });
      }
      if (count === 0) {
        this.onFailure(new Error("Coinbase poll returned no usable prices"));
        return;
      }
      if (failures > 0) logger.warn("[CoinbasePoller] partial poll failure", { ok: count, failed: failures });
      this.backoffMs = this.pollMs;
      this.setStatus("polling");
      logger.debug("[CoinbasePoller] prices updated", { pairs: count });
    } catch (err) {
      this.onFailure(err);
    } finally {
      this.polling = false;
      if (this.running) this.armTimer(this.backoffMs);
    }
  }

  private async fetchPair(pair: string): Promise<string | null> {
    const url = `${this.baseUrl}/products/${pair}/ticker`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "tickr-backend/1.0" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logger.warn("[CoinbasePoller] fetch failed", { pair, error: String(err) });
      return null;
    }
    if (res.status === 404) {
      if (!warned404.has(pair)) {
        warned404.add(pair);
        logger.warn("[CoinbasePoller] pair not listed on Coinbase", {
          pair,
          hint: "Remove the pair from the team map or fix the pair name — the team falls back to Binance/CoinGecko until then.",
        });
      } else {
        logger.debug("[CoinbasePoller] pair still not listed", { pair });
      }
      return null;
    }
    if (res.status === 429) {
      logger.warn("[CoinbasePoller] rate limited (429)", { pair });
      return null;
    }
    if (!res.ok) {
      logger.warn("[CoinbasePoller] fetch failed", {
        pair,
        status: res.status,
      });
      return null;
    }
    let body: { price?: string | number };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      logger.warn("[CoinbasePoller] unparseable ticker body", { pair });
      return null;
    }
    const amount = body.price;
    if (amount == null || String(amount).trim() === "") return null;
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return null;
    return String(amount);
  }

  private onFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("[CoinbasePoller] poll failed", { message });
    this.setStatus("error", message);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private setStatus(status: CoinbasePollerStatus, detail?: string): void {
    this.emit("status", status, detail);
  }

  on<K extends keyof CoinbaseEventMap>(event: K, listener: CoinbaseEventMap[K]): this {
    return super.on(event, listener);
  }
  emit<K extends keyof CoinbaseEventMap>(event: K, ...args: Parameters<CoinbaseEventMap[K]>): boolean {
    return super.emit(event, ...args);
  }
}
