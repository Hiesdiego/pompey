"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { qks } from "./keys";
import {
  fetchMarketsDirect,
  proxyGet,
  type MarketSummary,
} from "../chainDirect";
import { toAppError } from "../errors";
import { MARKET_FACTORY_ADDRESS, NEW_MARKET_FACTORY_ADDRESS } from "../marketFactory";

export interface MarketsData {
  markets: MarketSummary[];
  asOfBlock: string;
  refreshedAt?: string;
}

const LIVE_WINDOW_MS = 60_000;

export function useMarkets() {
  const query = useQuery({
    queryKey: qks.markets,
    queryFn: async (): Promise<MarketsData> => {
      let oldMarkets: MarketsData;
      try {
        oldMarkets = await proxyGet<MarketsData>("/api/chain/markets");
      } catch {
        try {
          oldMarkets = { ...await fetchMarketsDirect(), refreshedAt: new Date().toISOString() };
        } catch (e) {
          throw toAppError(e);
        }
      }
      if (!NEW_MARKET_FACTORY_ADDRESS || NEW_MARKET_FACTORY_ADDRESS.toLowerCase() === MARKET_FACTORY_ADDRESS?.toLowerCase()) return oldMarkets;
      const newMarkets = await fetchMarketsDirect(NEW_MARKET_FACTORY_ADDRESS).catch(() => null);
      return { ...oldMarkets, markets: [...(newMarkets?.markets ?? []), ...oldMarkets.markets] };
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });

  const sourceUpdatedAt = query.data?.refreshedAt ? Date.parse(query.data.refreshedAt) : query.dataUpdatedAt;
  const isLive =
    !query.isError &&
    query.data !== undefined &&
    Date.now() - sourceUpdatedAt < LIVE_WINDOW_MS;

  return {
    ...query,
    dataUpdatedAt: sourceUpdatedAt,
    markets: query.data?.markets ?? null,
    asOfBlock: query.data?.asOfBlock ?? null,
    refreshedAt: query.data?.refreshedAt ?? null,
    isLive,
  };
}
