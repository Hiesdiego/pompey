"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { qks } from "./keys";
import {
  STOCK_MARKET_FACTORY_ADDRESS,
  stockMarketApi,
  type StockMarketDetail,
} from "../stockMarketContracts";

export function useStockMarket(id: bigint | null | undefined) {
  const query = useQuery({
    queryKey: qks.stockMarket(id ?? "pending"),
    queryFn: async (): Promise<StockMarketDetail> => {
      if (id === null || id === undefined) throw new Error("Invalid stock market ID.");
      return stockMarketApi.market(id);
    },
    enabled: id !== null && id !== undefined && Boolean(STOCK_MARKET_FACTORY_ADDRESS),
    staleTime: 10_000,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    market: query.data ?? null,
  };
}
