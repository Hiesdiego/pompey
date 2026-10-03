/**
 * Binance spot WebSocket price feed — TICKR's PRIMARY live price source.
 *
 * Design (from Binance official docs, verified 2026-09-24):
 * - One connection, combined stream: `<host>/stream?streams=btcusdt@miniTicker/...`
 *   `@miniTicker` = 1-second price-only ticks, minimal bandwidth. Price field = `c`.
 * - Default host is the market-data-only mirror `wss://data-stream.binance.vision`
 *   (no geo-block); fails over to `wss://stream.binance.com:9443` on 451/refusal.
 * - Binance kills connections at the 24h mark → we proactively rotate at 23h.
 * - `serverShutdown` events, ping/pong (auto-handled by `ws`), exponential-backoff
 *   reconnect with jitter, and a 65s staleness watchdog (miniTicker ticks every 1s).
 * - All prices stay as strings until `priceMath` scales them — never float64.
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { logger } from "../lib/logger.js";

export interface TickPrice {
  /** Uppercase symbol, e.g. "BTCUSDT". */
  symbol: string;
  /** Decimal price string, e.g. "95320.50". */
  price: string;
  /** Exchange event time (ms). */
  eventTimeMs: number;
  /** Local receipt time (ms). */
  receivedAtMs: number;
}

export type FeedStatus = "connecting" | "connected" | "reconnecting" | "down";

interface FeedEventMap {
  price: (tick: TickPrice) => void;
  status: (status: FeedStatus, detail?: string) => void;
}

const STALE_WATCHDOG_MS = 65_000;
const PROACTIVE_ROTATION_MS = 23 * 60 * 60 * 1000; // rotate before Binance's 24h cut
const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;

export class BinanceWsFeed extends EventEmitter {
  private readonly symbols: string[];
  private readonly primaryHost: string;
  private readonly fallbackHost: string;

  private ws: WebSocket | null = null;
  private latest = new Map<string, { price: string; eventTimeMs: number; receivedAtMs: number }>();
  private backoffMs = INITIAL_BACKOFF_MS;
  private usingFallback = false;
  private intentionalClose = false;
  private watchdog: NodeJS.Timeout | null = null;
  private rotationTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(symbols: string[], primaryHost: string, fallbackHost: string) {
    super();
    if (symbols.length === 0) throw new Error("[BinanceWsFeed] symbols must not be empty");
    this.symbols = symbols.map((s) => s.toUpperCase());
    this.primaryHost = primaryHost.replace(/\/$/, "");
    this.fallbackHost = fallbackHost.replace(/\/$/, "");
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    this.intentionalClose = false;
    this.setStatus("connecting");
    this.connect();
  }

  stop(): void {
    this.intentionalClose = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
    this.setStatus("down", "stopped by backend");
  }

  /** Latest tick per symbol (uppercase symbol → tick). */
  getLatest(symbol: string): TickPrice | undefined {
    const entry = this.latest.get(symbol.toUpperCase());
    if (!entry) return undefined;
    return { symbol: symbol.toUpperCase(), ...entry };
  }

  getAllLatest(): Map<string, TickPrice> {
    const out = new Map<string, TickPrice>();
    for (const [symbol, entry] of this.latest) out.set(symbol, { symbol, ...entry });
    return out;
  }

  get activeHost(): string {
    return this.usingFallback ? this.fallbackHost : this.primaryHost;
  }

  // ------------------------------------------------------------------ connection

  private streamUrl(): string {
    const streams = this.symbols.map((s) => `${s.toLowerCase()}@miniTicker`).join("/");
    const host = this.usingFallback ? this.fallbackHost : this.primaryHost;
    return `${host}/stream?streams=${streams}`;
  }

  private connect(): void {
    if (this.intentionalClose) return;
    const url = this.streamUrl();
    logger.info("[BinanceWsFeed] connecting", { host: this.activeHost, symbols: this.symbols.length });

    let ws: WebSocket;
    try {
      ws = new WebSocket(url, { handshakeTimeout: 15_000 });
    } catch (err) {
      this.onConnectFailure(err, "constructor threw");
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      logger.info("[BinanceWsFeed] connected", { host: this.activeHost });
      this.backoffMs = INITIAL_BACKOFF_MS; // healthy connection resets backoff
      this.setStatus("connected");
      this.armWatchdog();
      this.armRotation();
    });

    ws.on("message", (data: WebSocket.RawData) => this.handleMessage(data));

    ws.on("error", (err: Error) => {
      logger.warn("[BinanceWsFeed] socket error", { message: err.message, host: this.activeHost });
      // 'close' will follow; reconnect is driven from there.
    });

    ws.on("close", (code: number, reason: Buffer) => {
      this.clearTimers();
      if (this.intentionalClose) return;
      logger.warn("[BinanceWsFeed] connection closed", {
        code,
        reason: reason.toString(),
        host: this.activeHost,
      });
      this.setStatus("reconnecting", `close code ${code}`);
      this.scheduleReconnect();
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    this.armWatchdog(); // any traffic proves liveness
    let msg: any;
    try {
      msg = JSON.parse(rawToText(data));
    } catch {
      logger.warn("[BinanceWsFeed] unparseable message, ignoring");
      return;
    }
    const payload = msg.data ?? msg; // combined streams wrap in {stream, data}

    if (payload.e === "serverShutdown") {
      logger.warn("[BinanceWsFeed] serverShutdown received — reconnecting immediately");
      this.reconnectNow();
      return;
    }
    if (payload.e !== "24hrMiniTicker") return; // ignore anything unexpected

    const symbol = String(payload.s ?? "").toUpperCase();
    const price = String(payload.c ?? "");
    if (!symbol || !price) return;

    const tick: TickPrice = {
      symbol,
      price,
      eventTimeMs: Number(payload.E ?? Date.now()),
      receivedAtMs: Date.now(),
    };
    this.latest.set(symbol, {
      price: tick.price,
      eventTimeMs: tick.eventTimeMs,
      receivedAtMs: tick.receivedAtMs,
    });
    this.emit("price", tick);
  }

  // ------------------------------------------------------------------ resilience

  private onConnectFailure(err: unknown, context: string): void {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("[BinanceWsFeed] connect failure", { context, message, host: this.activeHost });
    // Geo-block (451) or refused on primary → try the fallback host once before backing off.
    if (!this.usingFallback && /451|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) {
      this.usingFallback = true;
      logger.warn("[BinanceWsFeed] failing over to fallback host", { host: this.fallbackHost });
      this.setStatus("reconnecting", "host failover");
      this.scheduleReconnect(0);
      return;
    }
    this.setStatus("reconnecting", message);
    this.scheduleReconnect();
  }

  private scheduleReconnect(delayOverride?: number): void {
    if (this.intentionalClose || this.reconnectTimer) return;
    const delay =
      delayOverride ?? Math.min(this.backoffMs + Math.random() * 500, MAX_BACKOFF_MS);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    logger.info("[BinanceWsFeed] reconnecting", { inMs: Math.round(delay) });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private reconnectNow(): void {
    if (this.intentionalClose) return;
    try {
      this.ws?.terminate();
    } catch {
      /* noop */
    }
    this.ws = null;
    this.clearTimers();
    this.backoffMs = INITIAL_BACKOFF_MS;
    this.setStatus("reconnecting", "serverShutdown");
    this.connect();
  }

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      logger.error("[BinanceWsFeed] staleness watchdog fired — no ticks for 65s, forcing reconnect");
      this.reconnectNow();
    }, STALE_WATCHDOG_MS);
    this.watchdog.unref?.();
  }

  private armRotation(): void {
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    this.rotationTimer = setTimeout(() => {
      logger.info("[BinanceWsFeed] proactive 23h rotation — redialing before Binance's 24h cut");
      this.reconnectNow();
    }, PROACTIVE_ROTATION_MS);
    this.rotationTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.watchdog = this.rotationTimer = this.reconnectTimer = null;
  }

  private setStatus(status: FeedStatus, detail?: string): void {
    this.emit("status", status, detail);
    logger.debug("[BinanceWsFeed] status", { status, detail });
  }

  // Typed EventEmitter overrides
  on<K extends keyof FeedEventMap>(event: K, listener: FeedEventMap[K]): this {
    return super.on(event, listener);
  }
  emit<K extends keyof FeedEventMap>(event: K, ...args: Parameters<FeedEventMap[K]>): boolean {
    return super.emit(event, ...args);
  }
}

/** Safely decode ws RawData (Buffer | ArrayBuffer | Buffer[]) to text. */
function rawToText(data: WebSocket.RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
