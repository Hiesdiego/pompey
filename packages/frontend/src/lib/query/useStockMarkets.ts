"use client";

import { useQuery } from "@tanstack/react-query";
import { qks } from "./keys";
import { STOCK_MARKET_FACTORY_ADDRESS, stockMarketApi } from "../stockMarketContracts";

export function useStockMarkets() {
  return useQuery({
    queryKey: qks.stockMarkets,
    queryFn: async () => ({ markets: await stockMarketApi.markets(), refreshedAt: new Date().toISOString() }),
    enabled: Boolean(STOCK_MARKET_FACTORY_ADDRESS),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}
