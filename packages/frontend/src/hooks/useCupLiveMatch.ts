"use client";

import { useEffect, useState } from "react";
import { CUP_CONTRACTS, CUP_TEAMS } from "../lib/cup";
import { PRICE_DECIMALS } from "../lib/contracts";
import { useSharedPrices } from "../lib/price/useSharedPrices";
import { getPublicClient } from "./usePublicClient";

type Snapshot = { startA: bigint; startB: bigint; endA: bigint; endB: bigint; startSubmitted: boolean; endSubmitted: boolean };

const snapshotAbi = [{ type: "function", name: "getSnapshot", stateMutability: "view", inputs: [{ name: "matchId", type: "uint16" }], outputs: [{ type: "tuple", components: [
  { name: "startA", type: "uint256" }, { name: "startB", type: "uint256" }, { name: "endA", type: "uint256" }, { name: "endB", type: "uint256" }, { name: "startSubmitted", type: "bool" }, { name: "endSubmitted", type: "bool" },
] }] }] as const;

export function useCupLiveMatch(matchId: number, teamA: number | undefined, teamB: number | undefined, live: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const { prices, updatedAt } = useSharedPrices(live);

  useEffect(() => {
    const engine = CUP_CONTRACTS.engine;
    if (!live || !Number.isInteger(matchId) || matchId < 0 || matchId > 62 || !engine) return;
    let active = true;
    const load = async () => {
      try {
        const result = await getPublicClient().readContract({ address: engine, abi: snapshotAbi, functionName: "getSnapshot", args: [matchId] });
        if (active) setSnapshot(result.startSubmitted ? result : null);
      } catch { if (active) setSnapshot(null); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [live, matchId]);

  const priceSymbol = (teamId: number | undefined) => {
    const symbol = CUP_TEAMS[teamId ?? -1]?.symbol;
    return symbol === "TRON" ? "TRX" : symbol === "PENGUIN" ? "PENGU" : symbol;
  };
  const symbolA = priceSymbol(teamA);
  const symbolB = priceSymbol(teamB);
  const priceA = symbolA ? prices[symbolA] : undefined;
  const priceB = symbolB ? prices[symbolB] : undefined;
  const fresh = !!symbolA && !!symbolB && Date.now() - (updatedAt[symbolA] ?? 0) < 60_000 && Date.now() - (updatedAt[symbolB] ?? 0) < 60_000;
  const valid = live && snapshot?.startSubmitted && fresh && priceA !== undefined && priceB !== undefined && snapshot.startA > 0n && snapshot.startB > 0n;
  if (!valid) return { snapshot, score: null, moves: null, prices: null, fresh };

  const scaledA = BigInt(Math.round(priceA * 10 ** PRICE_DECIMALS));
  const scaledB = BigInt(Math.round(priceB * 10 ** PRICE_DECIMALS));
  const bpsA = ((scaledA - snapshot.startA) * 10_000n) / snapshot.startA;
  const bpsB = ((scaledB - snapshot.startB) * 10_000n) / snapshot.startB;
  const goals = (bps: bigint) => Number((bps >= 0n ? bps + 25n : bps - 25n) / 50n);
  const rawA = goals(bpsA);
  const rawB = goals(bpsB);
  return {
    snapshot,
    score: [Math.max(rawA, 0) + Math.max(-rawB, 0), Math.max(rawB, 0) + Math.max(-rawA, 0)] as [number, number],
    moves: [Number(bpsA) / 100, Number(bpsB) / 100] as [number, number],
    prices: [priceA, priceB] as [number, number],
    fresh,
  };
}
