"use client";

import { useEffect, useState } from "react";
import { parseAbi } from "viem";
import { CONTRACTS, SEASON_ID } from "../lib/contracts";
import { getPublicClient } from "./usePublicClient";

export interface SettledScoreline {
  homeGoals: number;
  awayGoals: number;
  outcome: 0 | 1 | 2;
  homePrice: bigint;
  awayPrice: bigint;
  transactionHash: `0x${string}`;
}

const PRICE_ORACLE_ABI = parseAbi([
  "event EndPriceSubmitted(uint256 indexed seasonId, uint256 indexed fixtureId, uint256 homePrice, uint256 awayPrice, int16 homeGoals, int16 awayGoals, uint8 outcome)",
]);

const PRICE_ORACLE_DEPLOY_BLOCK = BigInt(
  process.env.NEXT_PUBLIC_PRICE_ORACLE_DEPLOY_BLOCK?.trim() || "0"
);

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

    const oracle = CONTRACTS.priceOracle;
    if (!oracle) return;

    let alive = true;
    setLoading(true);

    (async () => {
      try {
        const client = getPublicClient();
        const logs = await client.getContractEvents({
          address: oracle,
          abi: PRICE_ORACLE_ABI,
          eventName: "EndPriceSubmitted",
          args: { seasonId: SEASON_ID, fixtureId: BigInt(fixtureId) },
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
            transactionHash: latest.transactionHash,
          });
        } else {
          setScoreline(null);
        }
      } catch {

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
