/**
 * PriceHeartbeat — the backend's lightweight Binance price source.
 *
 * This REPLACES the always-on Binance WebSocket stream + 10s REST poller
 * for backend needs. The 24/7 WS stream moved ~20 miniTicker messages/sec
 * (~8–13 GB/month) just so the backend could price snapshots — but the
 * backend only needs a price at the moments it actually submits:
 * kickoff reveals, start/end snapshots, checkpoint submissions. Live
 * per-second streaming is now the FRONTEND's job (each client streams
 * Binance directly; see the frontend's usePriceFeed).
 *
 * Behavior:
 * - Idle cadence: one REST `ticker/price?symbols=[20]` call every 60s.
 *   Weight 4 per call — ~5.8k calls/day, ~86 MB/month at ~1.5 KB/response.
 * - Hot cadence: every 15s while `isHotWindow()` is true (any fixture
 *   within 10 min of kickoff or settlement — wired to MatchLifecycle).
 * - Backoff 30s → 5min on failure; never throws out of the loop.
 * - Implements PriceFeed's `PrimaryPriceSource` (getLatest), so it drops
 *   into the existing validation pipeline unchanged: CoinGecko still
 *   cross-validates / falls back exactly as before.
 *
 * The old BinanceWsFeed / BinanceRestPoller modules are kept in the tree
 * but no longer started by index.ts (documented there).
 */
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

  /**
   * @param isHotWindow — true when any fixture is within ~10 min of kickoff
   *   or settlement; the heartbeat polls every 15s instead of 60s.
   */
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

  /** PriceFeed.PrimaryPriceSource — freshest tick wins. */
  getLatest(symbol: string): { price: string; receivedAtMs: number } | undefined {
    return this.latest.get(symbol.toUpperCase());
  }

  /** Seconds since the last successful poll (null = never). For /health. */
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
      // Next cadence depends on the CURRENT hot-window state.
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
    meter.count("egress_bytes", text.length);
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
    this.backoffMs = BACKOFF_MIN_MS; // healthy poll resets backoff
    logger.debug("[PriceHeartbeat] prices updated", { symbols: count });
  }

  private onFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("[PriceHeartbeat] poll failed — backing off", {
      message,
      nextInMs: this.backoffMs,
    });
    // Back off, but keep trying — snapshots depend on this feed.
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.armTimer(this.backoffMs);
  }
}
