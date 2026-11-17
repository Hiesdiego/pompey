"use client";

import { useEffect, useState } from "react";
import type { LiveFixtureUpdate } from "../components/FixtureCard";
import { stockApi, type StockApiPrice } from "../lib/stockContracts";

/** Stock ids and prices use their own namespace, separate from crypto ids. */
export function useStockLiveFeed(enabled = true) {
  const [fixtureUpdates, setFixtureUpdates] = useState<Record<string, LiveFixtureUpdate>>({});
  const [prices, setPrices] = useState<Record<number, StockApiPrice>>({});

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const [fixtures, priceRows] = await Promise.all([stockApi.fixtures(), stockApi.prices()]);
        if (!active) return;
        const nextFixtures: Record<string, LiveFixtureUpdate> = {};
        for (const fixture of fixtures) {
          nextFixtures[fixture.fixtureId] = {
            settled: fixture.settled,
            kickoffRevealed: fixture.kickoffRevealed,
            kickoffMs: fixture.kickoff ? Date.parse(fixture.kickoff) : null,
          };
        }
        const nextPrices: Record<number, StockApiPrice> = {};
        for (const price of priceRows) nextPrices[price.teamId] = price;
        setFixtureUpdates(nextFixtures);
        setPrices(nextPrices);
      } catch {
        // Keep the last good stock snapshot while the API recovers.
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return { fixtureUpdates, prices };
}
