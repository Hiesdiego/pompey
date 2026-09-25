/**
 * Live feed hook — connects to the backend WebSocket at /ws (spec P2.7).
 *
 * Server broadcasts every 5s:
 *   { type: "prices",   prices: [{ teamId, symbol, price, source, ok }] }
 *   { type: "fixtures", fixtures: [{ fixtureId, kickoffRevealed, kickoffMs, settled, matchdayIndex }] }
 * Full snapshot on connect, fixture deltas only when the set changes.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { BACKEND_API_URL } from "../lib/contracts";

export interface LivePrice {
  teamId: number;
  symbol: string;
  price: string | null; // decimal string
  source: string | null;
  ok: boolean;
}

export interface LiveFixtureUpdate {
  fixtureId: string;
  kickoffRevealed: boolean;
  kickoffMs: number;
  settled: boolean;
  matchdayIndex: number;
}

export type FeedStatus = "connecting" | "live" | "reconnecting" | "failed";

function wsUrl(): string {
  const base = BACKEND_API_URL.replace(/\/$/, "");
  return `${base.replace(/^http/, "ws")}/ws`;
}

export function useLiveFeed(enabled = true) {
  const [prices, setPrices] = useState<Record<number, LivePrice>>({});
  const [fixtureUpdates, setFixtureUpdates] = useState<Record<string, LiveFixtureUpdate>>({});
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let closed = false;

    const connect = () => {
      setStatus(retryRef.current === 0 ? "connecting" : "reconnecting");
      try {
        socket = new WebSocket(wsUrl());
      } catch {
        scheduleRetry();
        return;
      }
      socket.onopen = () => {
        retryRef.current = 0;
        setStatus("live");
      };
      socket.onmessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.type === "prices" && Array.isArray(msg.prices)) {
            const next: Record<number, LivePrice> = {};
            for (const p of msg.prices) next[p.teamId] = p as LivePrice;
            setPrices(next);
          } else if (msg.type === "fixtures" && Array.isArray(msg.fixtures)) {
            const next: Record<string, LiveFixtureUpdate> = {};
            for (const f of msg.fixtures) next[f.fixtureId] = f as LiveFixtureUpdate;
            setFixtureUpdates(next);
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onerror = () => {
        /* onclose handles the retry */
      };
      socket.onclose = () => {
        if (!closed) scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (closed) return;
      retryRef.current += 1;
      if (retryRef.current > 8) {
        setStatus("failed");
        return;
      }
      setStatus("reconnecting");
      const delay = Math.min(2000 * retryRef.current, 15000);
      timerRef.current = setTimeout(connect, delay);
    };

    connect();
    return () => {
      closed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { prices, fixtureUpdates, status };
}
