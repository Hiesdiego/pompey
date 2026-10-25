"use client";

import { useEffect, useState } from "react";
import { TICKR_TEAMS } from "@tickr/shared/teams";
import { BACKEND_API_URL } from "../contracts";

export type PriceFeedStatus = "live" | "polling" | "stale";

export interface PriceFeed {
  prices: Record<string, number>;
  status: PriceFeedStatus;
  lastUpdated: number;
  updatedAt: Record<string, number>;
}

interface PriceRow {
  symbol?: string;
  price?: string | number | null;
  ok?: boolean;
}

const TEAM_SYMBOLS = new Set(TICKR_TEAMS.map((team) => team.symbol));
const POLL_MS = 15_000;
const STALE_AFTER_MS = 180_000;

export function usePriceFeed(enabled = true): PriceFeed {
  const [feed, setFeed] = useState<PriceFeed>({
    prices: {},
    status: "polling",
    lastUpdated: 0,
    updatedAt: {},
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let inFlight = false;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`${BACKEND_API_URL}/api/prices`, {
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Price API ${response.status}`);
        const rows: unknown = await response.json();
        if (!active || !Array.isArray(rows)) return;
        const now = Date.now();
        setFeed((previous) => {
          const prices = { ...previous.prices };
          const updatedAt = { ...previous.updatedAt };
          let count = 0;
          for (const row of rows as PriceRow[]) {
            if (!row || row.ok === false || !row.symbol || !TEAM_SYMBOLS.has(row.symbol)) continue;
            const price = Number(row.price);
            if (!Number.isFinite(price) || price <= 0) continue;
            prices[row.symbol] = price;
            updatedAt[row.symbol] = now;
            count++;
          }
          if (count === 0) return previous;
          return { prices, updatedAt, lastUpdated: now, status: "live" };
        });
      } catch {
        if (active) setFeed((previous) => ({
          ...previous,
          status: previous.lastUpdated && Date.now() - previous.lastUpdated < STALE_AFTER_MS ? "polling" : "stale",
        }));
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const pollTimer = window.setInterval(() => void poll(), POLL_MS);
    const staleTimer = window.setInterval(() => {
      setFeed((previous) => previous.lastUpdated && Date.now() - previous.lastUpdated < STALE_AFTER_MS
        ? previous
        : { ...previous, status: "stale" });
    }, 5_000);
    return () => {
      active = false;
      window.clearInterval(pollTimer);
      window.clearInterval(staleTimer);
    };
  }, [enabled]);

  return feed;
}
