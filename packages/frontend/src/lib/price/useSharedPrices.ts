"use client";

import { useEffect, useState } from "react";
import { api } from "../api";

export function useSharedPrices(enabled = true) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [updatedAt, setUpdatedAt] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => void api.prices().then((rows) => {
      if (!alive) return;
      const receivedAt = Date.now();
      const nextPrices: Record<string, number> = {};
      const nextTimes: Record<string, number> = {};
      for (const row of rows) {
        const price = Number(row.price);
        if (row.ok && Number.isFinite(price) && price > 0) {
          nextPrices[row.symbol] = price;
          nextTimes[row.symbol] = receivedAt;
        }
      }
      setPrices(nextPrices);
      setUpdatedAt(nextTimes);
      setNow(receivedAt);
    }).catch(() => { if (alive) setNow(Date.now()); });
    load();
    const timer = window.setInterval(load, 15_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [enabled]);

  const fresh = Object.values(updatedAt).some((at) => now - at < 60_000);
  return { prices, updatedAt, status: fresh ? "live" as const : "stale" as const };
}
