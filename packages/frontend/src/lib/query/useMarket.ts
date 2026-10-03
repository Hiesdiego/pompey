/**
 * Single-market query for the detail page. Primary source: the backend
 * chain-cache proxy (GET /api/chain/markets/:id). Fallback: direct on-chain
 * reads.
 *
 * The backend summary does not carry the void-lifecycle fields, so after a
 * backend-primary fetch the hook enriches with ONE multicall
 * (marketInfo -> voidAfter, voidInitiatedAt) — the Settle panel's challenge
 * countdown needs live values. A failed enrichment degrades to "0"s rather
 * than failing the whole query (and tolerates the pre-two-step-void
 * factory, which has no voidInitiatedAt getter).
 */

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getPublicClient } from "../../hooks/usePublicClient";
import {
  MARKET_FACTORY_ABI,
  MARKET_FACTORY_ADDRESS,
  normalizeMarketInfo,
} from "../marketFactory";
import { qks } from "./keys";
import {
  fetchMarketDirect,
  proxyGet,
  type MarketSummary,
} from "../chainDirect";
import { toAppError } from "../errors";

export interface MarketWithVoid extends MarketSummary {
  voidAfter: string;
  voidInitiatedAt: string;
}

const ZERO_VOID = { voidAfter: "0", voidInitiatedAt: "0" };

async function enrichVoidFields(
  summary: MarketSummary,
  numId: number
): Promise<MarketWithVoid> {
  if (!MARKET_FACTORY_ADDRESS) return { ...summary, ...ZERO_VOID };
  try {
    const client = getPublicClient();
    const [infoRaw, voidInitiated] = await Promise.all([
      client.readContract({
        address: MARKET_FACTORY_ADDRESS,
        abi: MARKET_FACTORY_ABI,
        functionName: "marketInfo",
        args: [BigInt(numId)],
      }),
      client
        .readContract({
          address: MARKET_FACTORY_ADDRESS,
          abi: MARKET_FACTORY_ABI,
          functionName: "voidInitiatedAt",
          args: [BigInt(numId)],
        })
        .catch(() => 0n),
    ]);
    const info = normalizeMarketInfo(infoRaw);
    return {
      ...summary,
      voidAfter: info.voidAfter.toString(),
      voidInitiatedAt: (voidInitiated as bigint).toString(),
    };
  } catch {
    return { ...summary, ...ZERO_VOID };
  }
}

export function useMarket(id: number | string | bigint | null | undefined) {
  const idStr = id === null || id === undefined ? null : id.toString();
  const query = useQuery({
    queryKey: qks.market(idStr ?? "pending"),
    queryFn: async (): Promise<MarketWithVoid> => {
      const numId = Number(idStr);
      try {
        const data = await proxyGet<{ market: MarketSummary }>(
          `/api/chain/markets/${numId}`
        );
        return await enrichVoidFields(data.market, numId);
      } catch {
        try {
          const direct = await fetchMarketDirect(numId);
          return {
            ...direct,
            voidAfter: direct.voidAfter ?? "0",
            voidInitiatedAt: direct.voidInitiatedAt ?? "0",
          };
        } catch (e) {
          throw toAppError(e);
        }
      }
    },
    enabled: idStr !== null,
    staleTime: 10_000,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    market: query.data ?? null,
  };
}
