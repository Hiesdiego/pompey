"use client";

import { useEffect } from "react";
import { useMarkets } from "../lib/query/useMarkets";
import { usePriceFeed } from "../lib/price/usePriceFeed";
import { useWatchlist, saveWatchNotice, saveWatchlist } from "../lib/watchlist";
import { decodeTargetTerms } from "../lib/targetMarket";
import { TEMPLATES } from "../lib/marketFactory";
import { TICKR_TEAMS } from "@tickr/shared/teams";

export function WatchAlertMonitor() {
  const { wallet, entries } = useWatchlist();
  const { markets } = useMarkets();
  const { prices, status, updatedAt } = usePriceFeed(entries.length > 0);

  useEffect(() => {
    if (!wallet || !markets?.length || !entries.length) return;
    const now = Date.now();
    const finished: string[] = [];
    for (const entry of entries) {
      const market = markets.find((m) => m.id === Number(entry.marketId));
      if (!market) continue;
      const notify = (type: string, message: string) => {
        const key = `${entry.marketId}:${type}`;
        if (!saveWatchNotice(wallet, { key, marketId: entry.marketId, message, at: now })) return;
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try { new Notification("TICKR market update", { body: message, tag: key }); } catch { /* In-app update is already saved. */ }
        }
      };
      if (market.state !== 0) {
        if (entry.settled) notify("settled", `Market #${entry.marketId} has ${market.state === 1 ? "resolved" : "voided"}. View the result and your position.`);
        finished.push(entry.marketId);
        continue;
      }
      const closeMs = market.bettingCloseTime * 1000;
      if (entry.closing && closeMs > now && closeMs - now <= 60 * 60_000) notify("closing", `Market #${entry.marketId} closes within an hour.`);
      if (entry.nearTarget && status !== "stale" && market.templateId === TEMPLATES.TARGET && now < closeMs) {
        const terms = decodeTargetTerms(market.params as `0x${string}`);
        const symbol = TICKR_TEAMS.find((t) => t.teamId === terms?.teamId)?.symbol;
        const price = symbol ? prices[symbol] : undefined;
        if (terms && price && Date.now() - (updatedAt[symbol!] ?? 0) < 60_000 && Math.abs(price - terms.target) / terms.target <= 0.01) {
          notify("near-target", `${symbol} is within 1% of the target in market #${entry.marketId}.`);
        }
      }
    }
    if (finished.length) saveWatchlist(wallet, entries.filter((entry) => !finished.includes(entry.marketId)));
  }, [wallet, entries, markets, prices, status, updatedAt]);
  return null;
}
