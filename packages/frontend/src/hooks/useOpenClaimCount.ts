"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useTickr } from "./useTickr";
import { getPublicClient } from "./usePublicClient";
import { CONTRACTS, globalFixtureId, PREDICTION_POOL_ABI } from "../lib/contracts";
import { api } from "../lib/api";

/** Number of settled match pools with a winning, unclaimed stake. */
export function useOpenClaimCount(): number {
  const { authenticated, playerAddress } = useTickr();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!authenticated || !playerAddress || !CONTRACTS.predictionPool) {
      setCount(0);
      return;
    }
    try {
      const fixtures = (await api.fixtures()).filter((fixture) => fixture.settled && !fixture.voided);
      const client = getPublicClient();
      let open = 0;
      for (let offset = 0; offset < fixtures.length; offset += 25) {
        const chunk = fixtures.slice(offset, offset + 25);
        const calls = chunk.flatMap((fixture) => [
          ...[0, 1, 2].map((outcome) => ({
            address: CONTRACTS.predictionPool as Address,
            abi: PREDICTION_POOL_ABI,
            functionName: "getStake" as const,
            args: [BigInt(fixture.seasonId), BigInt(fixture.fixtureId), playerAddress as Address, outcome] as const,
          })),
          {
            address: CONTRACTS.predictionPool as Address,
            abi: PREDICTION_POOL_ABI,
            functionName: "claimed" as const,
            args: [globalFixtureId(BigInt(fixture.seasonId), BigInt(fixture.fixtureId)), playerAddress as Address] as const,
          },
        ]);
        const results = await client.multicall({ contracts: calls });
        const pending: number[] = [];
        for (let i = 0; i < chunk.length; i++) {
          const base = i * 4;
          const hasStake = [0, 1, 2].some((n) => ((results[base + n].result ?? 0n) as bigint) > 0n);
          const claimed = (results[base + 3].result ?? false) as boolean;
          if (hasStake && !claimed) pending.push(i);
        }
        const pools = await Promise.all(pending.map((i) => api.pool(chunk[i].fixtureId)));
        pools.forEach((pool, index) => {
          const winner = pool.winningOutcome;
          const base = pending[index] * 4;
          if (!pool.voided && winner !== null && ((results[base + winner].result ?? 0n) as bigint) > 0n) open++;
        });
      }
      setCount(open);
    } catch {
      // Keep the last successful count when the RPC or fixture API is briefly unavailable.
    }
  }, [authenticated, playerAddress]);

  useEffect(() => {
    void refresh();
    if (!authenticated || !playerAddress) return;
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, authenticated, playerAddress]);

  return count;
}
