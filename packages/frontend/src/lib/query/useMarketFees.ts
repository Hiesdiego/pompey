"use client";

import { useQuery } from "@tanstack/react-query";
import { getPublicClient } from "../../hooks/usePublicClient";
import { MARKET_FACTORY_ADDRESS } from "../marketFactory";

const feeAbi = (["treasuryFeeBps", "creatorFeeBps", "resolverFeeBps"] as const).map((name) => ({
  type: "function" as const, name, stateMutability: "view" as const, inputs: [], outputs: [{ type: "uint16" as const }],
}));

export function useMarketFees() {
  const query = useQuery({
    queryKey: ["marketFactoryFees", MARKET_FACTORY_ADDRESS],
    enabled: Boolean(MARKET_FACTORY_ADDRESS),
    queryFn: async (): Promise<readonly [number, number, number]> => {
      if (!MARKET_FACTORY_ADDRESS) throw new Error("Market factory unavailable");
      const client = getPublicClient();
      const [treasury, creator, resolver] = await Promise.all(feeAbi.map((item) => client.readContract({
        address: MARKET_FACTORY_ADDRESS, abi: [item], functionName: item.name,
      })));
      return [Number(treasury), Number(creator), Number(resolver)];
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const fresh = query.dataUpdatedAt > 0 && Date.now() - query.dataUpdatedAt < 90_000 && !query.isError;
  return { feesBps: fresh ? query.data ?? null : null, feesUpdatedAt: query.dataUpdatedAt, feesError: query.isError };
}
