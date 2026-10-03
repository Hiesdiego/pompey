/**
 * The market board query. Primary source: the backend chain-cache proxy
 * (GET /api/chain/markets). Fallback: direct on-chain reads
 * (fetchMarketsDirect — 4 RPC calls total, never 2N+1).
 *
 * `isLive` is true when the last successful fetch is under 60s old and no
 * error is present — pages render a live/catching-up dot from it instead of
 * ever showing "backend disconnected".
 */

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { qks } from "./keys";
import {
  fetchMarketsDirect,
  proxyGet,
  type MarketSummary,
} from "../chainDirect";
import { toAppError } from "../errors";

export interface MarketsData {
  markets: MarketSummary[];
  asOfBlock: string;
}

const LIVE_WINDOW_MS = 60_000;

export function useMarkets() {
  const query = useQuery({
    queryKey: qks.markets,
    queryFn: async (): Promise<MarketsData> => {
      try {
        return await proxyGet<MarketsData>("/api/chain/markets");
      } catch {
        try {
          return await fetchMarketsDirect();
        } catch (e) {
          throw toAppError(e);
        }
      }
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });

  const isLive =
    !query.isError &&
    query.data !== undefined &&
    Date.now() - query.dataUpdatedAt < LIVE_WINDOW_MS;

  return {
    ...query,
    markets: query.data?.markets ?? null,
    asOfBlock: query.data?.asOfBlock ?? null,
    isLive,
  };
}
