"use client";

import { useEffect, useState } from "react";
import { parseAbi } from "viem";
import { getPublicClient } from "./usePublicClient";

export interface SettledScoreline {
  homeGoals: number;
  awayGoals: number;
  outcome: 0 | 1 | 2; // WinHome | Draw | WinAway
  homePrice: bigint;
  awayPrice: bigint;
}

const PRICE_ORACLE_ABI = parseAbi([
  "event EndPriceSubmitted(uint256 indexed seasonId, uint256 indexed fixtureId, uint256 homePrice, uint256 awayPrice, int16 homeGoals, int16 awayGoals, uint8 outcome)",
]);

// PriceOracle deploy block for season 2 (adjust if redeployed)
const PRICE_ORACLE_DEPLOY_BLOCK = BigInt(
  process.env.NEXT_PUBLIC_PRICE_ORACLE_DEPLOY_BLOCK?.trim() || "0"
);

/**
 * Fetch the settled scoreline from the PriceOracle's EndPriceSubmitted event.
 * This is the SINGLE SOURCE OF TRUTH — the exact goals the contract computed,
 * not a frontend recomputation. Ensures the displayed scoreline always matches
 * the on-chain settlement, table, and payouts.
 *
 * Returns null while loading or if the fixture is not settled.
 */
export function useSettledScoreline(
  fixtureId: string | null,
  settled: boolean
): { scoreline: SettledScoreline | null; loading: boolean } {
  const [scoreline, setScoreline] = useState<SettledScoreline | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fixtureId || !settled) {
      setScoreline(null);
      return;
    }

    const oracle = process.env.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS as
      | `0x${string}`
      | undefined;
    if (!oracle) return;

    let alive = true;
    setLoading(true);

    (async () => {
      try {
        const client = getPublicClient();
        const seasonId = BigInt(
          process.env.NEXT_PUBLIC_SEASON_ID?.trim() || "2"
        );

        const logs = await client.getContractEvents({
          address: oracle,
          abi: PRICE_ORACLE_ABI,
          eventName: "EndPriceSubmitted",
          args: { seasonId, fixtureId: BigInt(fixtureId) },
          fromBlock: PRICE_ORACLE_DEPLOY_BLOCK,
          toBlock: "latest",
        });

        if (!alive) return;
        const latest = logs[logs.length - 1];
        if (latest) {
          const a = latest.args as any;
          setScoreline({
            homeGoals: Number(a.homeGoals),
            awayGoals: Number(a.awayGoals),
            outcome: Number(a.outcome) as 0 | 1 | 2,
            homePrice: a.homePrice as bigint,
            awayPrice: a.awayPrice as bigint,
          });
        }
      } catch {
        // Event fetch failed — caller falls back to recomputation
        if (alive) setScoreline(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [fixtureId, settled]);

  return { scoreline, loading };
}
