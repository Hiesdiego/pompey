/**
 * ONE shared MarketFactory event subscription for the whole app.
 *
 * A module-level refcount keeps exactly one watchContractEvent alive no
 * matter how many components mount useFactoryEvents(). On every log batch
 * it invalidates the query keys (never hand-patches state):
 * - any factory log            -> qks.markets (the board refetches)
 * - log with args.marketId = N -> qks.market(N), qks.oddsHistory(N)
 *
 * Watching without an eventName filter covers MarketCreated, MarketStaked,
 * MarketResolved, MarketVoided AND the void-lifecycle events
 * (VoidInitiated, VoidCancelled) — the detail page's challenge countdown
 * stays correct through the same invalidation path.
 *
 * This REPLACES the three ad-hoc watchContractEvent usages:
 * - src/app/page.tsx            (live board patching)
 * - src/app/markets/page.tsx    (live board patching)
 * - src/app/markets/[id]/page.tsx (stake/settlement patching)
 * See MIGRATION_frontend-data.md for the swap instructions.
 */

"use client";

import { useEffect } from "react";
import { getPublicClient } from "../../hooks/usePublicClient";
import { MARKET_FACTORY_ABI, MARKET_FACTORY_ADDRESS } from "../marketFactory";
import { qks } from "./keys";
import { queryClient } from "./queryClient";

let consumers = 0;
let unwatch: (() => void) | null = null;

function ensureSubscribed(): void {
  if (unwatch || !MARKET_FACTORY_ADDRESS) return;
  unwatch = getPublicClient().watchContractEvent({
    address: MARKET_FACTORY_ADDRESS,
    abi: MARKET_FACTORY_ABI,
    pollingInterval: 4_000,
    onLogs: (logs) => {
      queryClient.invalidateQueries({ queryKey: qks.markets });
      const ids = new Set<string>();
      for (const log of logs) {
        const marketId = (log as unknown as { args?: { marketId?: unknown } })
          .args?.marketId;
        if (typeof marketId === "bigint") ids.add(marketId.toString());
      }
      for (const id of ids) {
        queryClient.invalidateQueries({ queryKey: qks.market(id) });
        queryClient.invalidateQueries({ queryKey: qks.oddsHistory(id) });
      }
    },
  });
}

function release(): void {
  consumers -= 1;
  if (consumers <= 0) {
    consumers = 0;
    if (unwatch) {
      unwatch();
      unwatch = null;
    }
  }
}

/**
 * Mount in any component that renders market data. The first consumer opens
 * the single subscription; the last one to unmount closes it.
 */
export function useFactoryEvents(): void {
  useEffect(() => {
    consumers += 1;
    ensureSubscribed();
    return () => {
      release();
    };
  }, []);
}
