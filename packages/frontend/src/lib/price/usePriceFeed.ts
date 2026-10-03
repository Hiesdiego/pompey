/**
 * usePriceFeed — live team prices.
 *
 * Source chain (first healthy source wins, checked top-down):
 *  1. Binance WS miniTicker stream (browser-direct, sub-second ticks)
 *  2. Binance REST ticker/price (browser-direct, 15s poll, while WS is down)
 *  3. TICKR backend /api/prices (15s poll) — for regions where Binance is
 *     geo-blocked (api.binance.com returns 451 / WS fails). The backend
 *     runs its own Binance feed server-side, so it stays reachable.
 *  4. "stale" — nothing has delivered a price in 60s.
 *
 * Freshest tick wins (compared by Binance event time E per symbol).
 * Reconnect: exponential backoff 1s → 30s cap, jittered, infinite
 * retries — it never "gives up" the way a fixed retry cap did.
 *
 * Shape: { prices: Record<teamSymbol, number>, status, lastUpdated }.
 * `prices` is keyed by team symbol ("BTC"), values are plain numbers.
 * `status`: "live" (WS streaming) | "polling" (REST fallback) | "stale"
 * (no successful update for > 60s).
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { TICKR_TEAMS } from "@tickr/shared/teams";
import { BACKEND_API_URL } from "../contracts";

export type PriceFeedStatus = "live" | "polling" | "stale";

export interface PriceFeed {
  /** Latest price per team symbol, e.g. { BTC: 63412.5 }. */
  prices: Record<string, number>;
  status: PriceFeedStatus;
  /** ms epoch of the last successful price update, 0 if never. */
  lastUpdated: number;
}

/** binanceSymbol (BTCUSDT) → team symbol (BTC). */
const SYMBOL_BY_BINANCE: Record<string, string> = Object.fromEntries(
  TICKR_TEAMS.map((t) => [t.binanceSymbol, t.symbol])
);
/** team symbol ("BTC") → team symbol, for backend-shaped rows. */
const TEAM_SYMBOL_SET: Set<string> = new Set(TICKR_TEAMS.map((t) => t.symbol));

const WS_URL = `wss://stream.binance.com:9443/stream?streams=${TICKR_TEAMS.map(
  (t) => `${t.binanceSymbol.toLowerCase()}@miniTicker`
).join("/")}`;

const REST_URL = `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(
  JSON.stringify(TICKR_TEAMS.map((t) => t.binanceSymbol))
)}`;

const BACKEND_PRICES_URL = `${BACKEND_API_URL}/api/prices`;

const REST_POLL_MS = 15_000;
const BACKEND_POLL_MS = 15_000;
const STALE_AFTER_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
/** Consecutive Binance failures before the backend fallback kicks in. */
const BINANCE_DEAD_AFTER = 3;

interface MiniTicker {
  s?: string; // symbol, e.g. BTCUSDT
  c?: string; // close price
  E?: number; // event time
}

function parseTick(raw: string): MiniTicker | null {
  try {
    const msg = JSON.parse(raw) as { data?: MiniTicker } & MiniTicker;
    const d = (msg.data ?? msg) as MiniTicker;
    if (typeof d.s === "string" && typeof d.c === "string") return d;
    return null;
  } catch {
    return null;
  }
}

export function usePriceFeed(enabled = true): PriceFeed {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<PriceFeedStatus>("polling");
  const [lastUpdated, setLastUpdated] = useState(0);

  const pricesRef = useRef<Record<string, number>>({});
  const eventTimeRef = useRef<Record<string, number>>({});
  const lastUpdatedRef = useRef(0);
  const statusRef = useRef<PriceFeedStatus>("polling");
  const wsOpenRef = useRef(false);
  const retryRef = useRef(0);
  const binanceFailRef = useRef(0);
  const binanceDeadRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let socket: WebSocket | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let restTimer: ReturnType<typeof setInterval> | null = null;
    let backendTimer: ReturnType<typeof setInterval> | null = null;
    let staleTimer: ReturnType<typeof setInterval> | null = null;

    const setStatusBoth = (s: PriceFeedStatus) => {
      statusRef.current = s;
      setStatus(s);
    };

    /** Binance is considered dead after N consecutive failures (geo-block). */
    const noteBinanceFailure = () => {
      binanceFailRef.current += 1;
      if (!binanceDeadRef.current && binanceFailRef.current >= BINANCE_DEAD_AFTER) {
        binanceDeadRef.current = true;
      }
    };
    const noteBinanceSuccess = () => {
      binanceFailRef.current = 0;
      binanceDeadRef.current = false;
    };

    /** Apply one tick if it is fresher than what we have. */
    const applyTick = (binanceSymbol: string, price: number, eventTime: number) => {
      const symbol = SYMBOL_BY_BINANCE[binanceSymbol];
      if (!symbol || !Number.isFinite(price)) return;
      const prevEvent = eventTimeRef.current[symbol] ?? -1;
      if (eventTime <= prevEvent) return; // stale/out-of-order tick — drop it
      eventTimeRef.current[symbol] = eventTime;
      pricesRef.current = { ...pricesRef.current, [symbol]: price };
      setPrices(pricesRef.current);
      const now = Date.now();
      lastUpdatedRef.current = now;
      setLastUpdated(now);
      noteBinanceSuccess();
      if (statusRef.current === "stale") {
        setStatusBoth(wsOpenRef.current ? "live" : "polling");
      }
    };

    /** Write a batch of prices (REST-shaped rows) into the feed. */
    const applyBatch = (
      rows: Array<{ symbol?: string; price?: string | null; ok?: boolean }>,
      markBinanceOk: boolean
    ) => {
      const now = Date.now();
      let touched = false;
      const next = { ...pricesRef.current };
      for (const row of rows) {
        if (row.ok === false) continue;
        // Accept Binance-shaped rows ("BTCUSDT") and backend-shaped rows ("BTC").
        const key =
          (row.symbol && SYMBOL_BY_BINANCE[row.symbol]) ||
          (row.symbol && TEAM_SYMBOL_SET.has(row.symbol) ? row.symbol : undefined);
        const price = Number(row.price);
        if (key && Number.isFinite(price)) {
          next[key] = price;
          touched = true;
        }
      }
      if (touched) {
        pricesRef.current = next;
        setPrices(next);
        lastUpdatedRef.current = now;
        setLastUpdated(now);
        if (markBinanceOk) noteBinanceSuccess();
        if (!wsOpenRef.current && statusRef.current !== "polling") {
          setStatusBoth("polling");
        }
      }
    };

    const restPoll = async (force = false) => {
      if (closed || (!force && wsOpenRef.current)) return; // WS owns the feed while open
      try {
        const res = await fetch(REST_URL, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) {
          noteBinanceFailure();
          return;
        }
        const rows = (await res.json()) as Array<{ symbol?: string; price?: string }>;
        if (!Array.isArray(rows)) {
          noteBinanceFailure();
          return;
        }
        applyBatch(rows, true);
      } catch {
        noteBinanceFailure();
        /* transient — the stale checker + next poll handle it */
      }
    };

    /**
     * Backend fallback for Binance geo-blocked regions (451 / WS blocked).
     * Only runs while Binance is considered dead; stops itself as soon as
     * Binance recovers.
     */
    const backendPoll = async () => {
      if (closed || !binanceDeadRef.current) return;
      try {
        const res = await fetch(BACKEND_PRICES_URL, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return;
        const rows = (await res.json()) as Array<{
          symbol?: string;
          price?: string | null;
          ok?: boolean;
        }>;
        if (!Array.isArray(rows)) return;
        // Backend rows use team symbols ("BTC") — normalize to the batch shape.
        applyBatch(
          rows.map((r) => ({
            symbol: r.symbol,
            price: r.price,
            ok: r.ok,
          })),
          false
        );
      } catch {
        /* backend unreachable too — stale checker reports it */
      }
    };

    const scheduleReconnect = () => {
      if (closed) return;
      retryRef.current += 1;
      const backoff = Math.min(
        INITIAL_BACKOFF_MS * 2 ** (retryRef.current - 1),
        MAX_BACKOFF_MS
      );
      const jitter = Math.random() * 500;
      retryTimer = setTimeout(connect, backoff + jitter);
    };

    const connect = () => {
      if (closed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        noteBinanceFailure();
        scheduleReconnect();
        return;
      }
      socket = ws;

      ws.onopen = () => {
        if (closed) {
          ws.close();
          return;
        }
        retryRef.current = 0;
        wsOpenRef.current = true;
        noteBinanceSuccess();
        setStatusBoth("live");
        // Immediate REST snapshot so the board isn't empty while ticks arrive.
        void restPoll(true);
      };

      ws.onmessage = (ev: MessageEvent) => {
        const tick = parseTick(String(ev.data));
        if (!tick || !tick.s || !tick.c) return;
        applyTick(tick.s, Number(tick.c), tick.E ?? 0);
      };

      const onDown = () => {
        wsOpenRef.current = false;
        noteBinanceFailure();
        if (!closed) {
          if (statusRef.current === "live") setStatusBoth("polling");
          scheduleReconnect();
        }
      };
      ws.onerror = () => {
        /* onclose follows and drives the retry */
      };
      ws.onclose = onDown;
    };

    connect();
    restTimer = setInterval(restPoll, REST_POLL_MS);
    backendTimer = setInterval(backendPoll, BACKEND_POLL_MS);
    staleTimer = setInterval(() => {
      if (!closed && Date.now() - lastUpdatedRef.current > STALE_AFTER_MS) {
        setStatusBoth("stale");
      }
    }, 5_000);

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (restTimer) clearInterval(restTimer);
      if (backendTimer) clearInterval(backendTimer);
      if (staleTimer) clearInterval(staleTimer);
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      wsOpenRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { prices, status, lastUpdated };
}
