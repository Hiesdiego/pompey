/**
 * useCupPool — CupPool reads for the staking UI: match pool totals, the
 * connected wallet's stakes, and outright totals.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { CUP_CONTRACTS, CUP_POOL_ABI, cupConfigured } from "../lib/cup";
import { getPublicClient } from "./usePublicClient";

export interface CupMatchPool {
  totalA: bigint;
  totalB: bigint;
  seed: bigint;
  settled: boolean;
  winner: number;
}

const POLL_MS = 30_000;

export function useCupMatchPool(matchId: number | null, playerAddress: Address | null) {
  const [pool, setPool] = useState<CupMatchPool | null>(null);
  const [myStakeA, setMyStakeA] = useState<bigint | null>(null);
  const [myStakeB, setMyStakeB] = useState<bigint | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!cupConfigured || matchId === null) return;
    try {
      const client = getPublicClient();
      const p = (await client.readContract({
        address: CUP_CONTRACTS.pool as `0x${string}`,
        abi: CUP_POOL_ABI,
        functionName: "getMatchPool",
        args: [matchId],
      })) as unknown as {
        totalA: bigint;
        totalB: bigint;
        seed: bigint;
        settled: boolean;
        winner: number;
      };
      if (!aliveRef.current) return;
      setPool({
        totalA: p.totalA,
        totalB: p.totalB,
        seed: p.seed,
        settled: p.settled,
        winner: p.winner,
      });
      if (playerAddress) {
        const [a, b] = await Promise.all([
          client.readContract({
            address: CUP_CONTRACTS.pool as `0x${string}`,
            abi: CUP_POOL_ABI,
            functionName: "getMatchStake",
            args: [matchId, playerAddress, 0],
          }),
          client.readContract({
            address: CUP_CONTRACTS.pool as `0x${string}`,
            abi: CUP_POOL_ABI,
            functionName: "getMatchStake",
            args: [matchId, playerAddress, 1],
          }),
        ]);
        if (!aliveRef.current) return;
        setMyStakeA(a as bigint);
        setMyStakeB(b as bigint);
      } else {
        setMyStakeA(null);
        setMyStakeB(null);
      }
    } catch {
      // Pool may not exist yet (not seeded) — leave as null.
    }
  }, [matchId, playerAddress]);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(timer);
    };
  }, [load]);

  return { pool, myStakeA, myStakeB, reload: load };
}

/** Outright totals for all 64 teams (chunked reads). */
export function useCupOutrightTotals(enabled = true) {
  const [totals, setTotals] = useState<Record<number, bigint> | null>(null);
  const [settled, setSettled] = useState(false);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!cupConfigured || !enabled) return;
    try {
      const client = getPublicClient();
      const outrightSettled = await client.readContract({
        address: CUP_CONTRACTS.pool as `0x${string}`,
        abi: CUP_POOL_ABI,
        functionName: "outrightSettled",
      });
      const out: Record<number, bigint> = {};
      const CHUNK = 16;
      for (let start = 0; start < 64; start += CHUNK) {
        const ids: number[] = [];
        for (let i = start; i < Math.min(start + CHUNK, 64); i++) ids.push(i);
        const vals = await Promise.all(
          ids.map((id) =>
            client.readContract({
              address: CUP_CONTRACTS.pool as `0x${string}`,
              abi: CUP_POOL_ABI,
              functionName: "getOutrightTotal",
              args: [id],
            })
          )
        );
        ids.forEach((id, j) => {
          out[id] = vals[j] as bigint;
        });
      }
      if (aliveRef.current) {
        setTotals(out);
        setSettled(outrightSettled as boolean);
      }
    } catch {
      // Outright pool may not be seeded yet.
    }
  }, [enabled]);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(timer);
    };
  }, [load]);

  return { totals, settled, reload: load };
}
