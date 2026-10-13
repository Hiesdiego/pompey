























import { logger } from "../lib/logger.js";
import { meter } from "../lib/net.js";
import type { PrimaryPriceSource } from "./priceFeed.js";

const IDLE_MS = 60_000;
const HOT_MS = 15_000;
const BACKOFF_MIN_MS = 30_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export class PriceHeartbeat implements PrimaryPriceSource {
  private readonly symbols: string[];
  private readonly restBaseUrl: string;
  private readonly latest = new Map<string, { price: string; receivedAtMs: number }>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private backoffMs = BACKOFF_MIN_MS;
  private lastTickAtMs: number | null = null;





  constructor(
    symbols: string[],
    restBaseUrl: string,
    private readonly isHotWindow: () => boolean = () => false
  ) {
    if (symbols.length === 0) throw new Error("[PriceHeartbeat] symbols must not be empty");
    this.symbols = symbols.map((s) => s.toUpperCase());
    this.restBaseUrl = restBaseUrl.replace(/\/$/, "");
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info("[PriceHeartbeat] starting", {
      symbols: this.symbols.length,
      idleMs: IDLE_MS,
      hotMs: HOT_MS,
    });
    void this.poll().catch(() => {});
    this.armTimer(IDLE_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }


  getLatest(symbol: string): { price: string; receivedAtMs: number } | undefined {
    return this.latest.get(symbol.toUpperCase());
  }


  stalenessSec(): number | null {
    if (this.lastTickAtMs === null) return null;
    return Math.round((Date.now() - this.lastTickAtMs) / 1000);
  }

  private armTimer(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll().catch(() => {});

      this.armTimer(this.isHotWindow() ? HOT_MS : IDLE_MS);
    }, delayMs);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    const symbolsParam = encodeURIComponent(JSON.stringify(this.symbols));
    const url = `${this.restBaseUrl}/api/v3/ticker/price?symbols=${symbolsParam}`;

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      this.onFailure(err);
      return;
    }
    if (!res.ok) {
      this.onFailure(new Error(`Binance REST ${res.status} ${res.statusText}`));
      return;
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      this.onFailure(err);
      return;
    }
    meter.count("inbound_bytes:binance", Buffer.byteLength(text));
    meter.count("price_heartbeat_polls", 1);

    let list: Array<{ symbol?: string; price?: string | number }>;
    try {
      list = JSON.parse(text) as typeof list;
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
      count++;
    }
    if (count === 0) {
      this.onFailure(new Error("Binance REST returned no usable prices"));
      return;
    }
    this.lastTickAtMs = now;
    this.backoffMs = BACKOFF_MIN_MS;
    logger.debug("[PriceHeartbeat] prices updated", { symbols: count });
  }

  private onFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("[PriceHeartbeat] poll failed — backing off", {
      message,
      nextInMs: this.backoffMs,
    });

    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.armTimer(this.backoffMs);
  }
}
