/**
 * Binance REST poller — second-tier primary price source.
 *
 * If the WebSocket feed can't connect (geo-block, firewall, WS upgrades
 * blocked at the network level), this polls Binance's REST ticker endpoint
 * every 10s so the backend still prices from Binance — not CoinGecko's
 * 5-minute cadence.
 *
 * One call per poll for all 20 symbols:
 *   GET {restBase}/api/v3/ticker/price?symbols=["BTCUSDT",...]
 * Weight 4 per call — negligible against the 6,000/min REST budget.
 *
 * The backend pauses this poller while the WebSocket is healthy and resumes
 * it the moment the WS drops, so the two never fight and rate limit is
 * conserved. Emits the same "price" ticks as the WS feed so PriceFeed treats
 * both as one logical Binance source and always takes the freshest tick.
 */

import { EventEmitter } from "node:events";
import { logger } from "../lib/logger.js";

export interface RestTick {
  symbol: string; // e.g. "BTCUSDT"
  price: string;
  receivedAtMs: number;
}

export type RestPollerStatus = "polling" | "paused" | "error";

interface RestEventMap {
  price: (tick: RestTick) => void;
  status: (status: RestPollerStatus, detail?: string) => void;
}

const MAX_BACKOFF_MS = 60_000;

export class BinanceRestPoller extends EventEmitter {
  private readonly symbols: string[];
  private readonly restBaseUrl: string;
  private readonly pollMs: number;
  private readonly latest = new Map<string, { price: string; receivedAtMs: number }>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private paused = false;
  private backoffMs: number;

  constructor(symbols: string[], restBaseUrl: string, pollMs: number) {
    super();
    if (symbols.length === 0) throw new Error("[BinanceRestPoller] symbols must not be empty");
    this.symbols = symbols;
    this.restBaseUrl = restBaseUrl;
    this.pollMs = pollMs;
    this.backoffMs = pollMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info("[BinanceRestPoller] starting", {
      baseUrl: this.restBaseUrl,
      symbols: this.symbols.length,
      pollMs: this.pollMs,
    });
    this.setStatus(this.paused ? "paused" : "polling");
    if (!this.paused) {
      void this.poll().catch(() => {});
      this.armTimer(this.pollMs);
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Pause polling while the WebSocket feed is healthy. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.setStatus("paused", "websocket healthy");
    logger.info("[BinanceRestPoller] paused — websocket is healthy");
  }

  /** Resume polling when the WebSocket feed drops. Polls immediately. */
  resume(): void {
    if (!this.paused || !this.running) return;
    this.paused = false;
    this.backoffMs = this.pollMs;
    this.setStatus("polling", "websocket down — REST covering");
    logger.info("[BinanceRestPoller] resumed — covering for websocket");
    void this.poll().catch(() => {});
    this.armTimer(this.pollMs);
  }

  getLatest(symbol: string): { price: string; receivedAtMs: number } | undefined {
    return this.latest.get(symbol);
  }

  /**
   * One-shot gap-fill poll for specific symbols (v0.2 SOMI fix).
   *
   * Background: the market-data mirror (data-stream.binance.vision) silently
   * drops WS streams for some newly-listed symbols — the combined stream
   * connects fine but never sends ticks for them (verified: somiusdt@miniTicker
   * = 0 ticks in 12s while btcusdt@miniTicker ticks every second on the same
   * host). The poller stays paused while the WS is healthy overall, so a
   * symbol-specific gap like this never gets covered.
   *
   * pollSymbols() fills exactly those gaps: it fetches the given symbols
   * from REST and emits the same "price" events as the normal poll, so
   * PriceFeed treats them as Binance-source ticks. It never touches the
   * paused/running state — it's safe to call while paused.
   */
  async pollSymbols(symbols: string[]): Promise<void> {
    const targets = [...new Set(symbols.map((s) => s.toUpperCase()))].filter(Boolean);
    if (targets.length === 0) return;
    const symbolsParam = encodeURIComponent(JSON.stringify(targets));
    const url = `${this.restBaseUrl.replace(/\/$/, "")}/api/v3/ticker/price?symbols=${symbolsParam}`;

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      logger.warn("[BinanceRestPoller] gap-fill poll failed", {
        symbols: targets,
        error: String(err),
      });
      return;
    }
    if (!res.ok) {
      logger.warn("[BinanceRestPoller] gap-fill poll failed", {
        symbols: targets,
        status: res.status,
      });
      return;
    }

    let list: Array<{ symbol?: string; price?: string | number }>;
    try {
      list = (await res.json()) as typeof list;
    } catch {
      return;
    }

    const now = Date.now();
    let count = 0;
    for (const entry of list ?? []) {
      const symbol = String(entry?.symbol ?? "").toUpperCase();
      const price = entry?.price != null ? String(entry.price) : "";
      if (!symbol || !price) continue;
      this.latest.set(symbol, { price, receivedAtMs: now });
      this.emit("price", { symbol, price, receivedAtMs: now });
      count++;
    }
    if (count > 0) {
      logger.info("[BinanceRestPoller] gap-fill prices updated", {
        symbols: targets,
        count,
      });
    }
  }

  private armTimer(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll().catch(() => {});
      if (!this.paused) this.armTimer(this.backoffMs);
    }, delayMs);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    if (!this.running || this.paused) return;
    const symbolsParam = encodeURIComponent(JSON.stringify(this.symbols));
    const url = `${this.restBaseUrl.replace(/\/$/, "")}/api/v3/ticker/price?symbols=${symbolsParam}`;

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      this.onFailure(err);
      return;
    }
    if (res.status === 451) {
      this.onFailure(new Error("Binance REST geo-blocked (HTTP 451) on this network"));
      return;
    }
    if (!res.ok) {
      this.onFailure(new Error(`Binance REST ${res.status} ${res.statusText}`));
      return;
    }

    let list: Array<{ symbol?: string; price?: string | number }>;
    try {
      list = (await res.json()) as typeof list;
    } catch (err) {
      this.onFailure(new Error(`unparseable Binance REST body: ${String(err)}`));
      return;
    }

    const now = Date.now();
    let count = 0;
    for (const entry of list ?? []) {
      const symbol = String(entry?.symbol ?? "").toUpperCase();
      const price = entry?.price != null ? String(entry.price) : "";
      if (!symbol || !price) continue;
      this.latest.set(symbol, { price, receivedAtMs: now });
      this.emit("price", { symbol, price, receivedAtMs: now });
      count++;
    }
    if (count === 0) {
      this.onFailure(new Error("Binance REST returned no usable prices"));
      return;
    }
    this.backoffMs = this.pollMs; // healthy poll resets backoff
    this.setStatus("polling");
    logger.debug("[BinanceRestPoller] prices updated", { symbols: count });
  }

  private onFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("[BinanceRestPoller] poll failed", { message });
    this.setStatus("error", message);
    // Back off, but keep trying — the WS may be down for a long time.
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    if (!this.paused) this.armTimer(this.backoffMs);
  }

  private setStatus(status: RestPollerStatus, detail?: string): void {
    this.emit("status", status, detail);
  }

  // Typed EventEmitter overrides
  on<K extends keyof RestEventMap>(event: K, listener: RestEventMap[K]): this {
    return super.on(event, listener);
  }
  emit<K extends keyof RestEventMap>(event: K, ...args: Parameters<RestEventMap[K]>): boolean {
    return super.emit(event, ...args);
  }
}
