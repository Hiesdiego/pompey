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

export function useCupLiveMatch(matchId: number, teamA: number | undefined, teamB: number | undefined, phase: "upcoming" | "live" | "awaiting" | "settled" | "disputed") {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const live = phase === "live";
  const { prices, updatedAt } = useSharedPrices(live);

  useEffect(() => {
    const engine = CUP_CONTRACTS.engine;
    if (phase === "upcoming" || !Number.isInteger(matchId) || matchId < 0 || matchId > 62 || !engine) return;
    let active = true;
    const load = async () => {
      try {
        const result = await getPublicClient().readContract({ address: engine, abi: snapshotAbi, functionName: "getSnapshot", args: [matchId] });
        if (active) setSnapshot(result.startSubmitted ? result : null);
      } catch { if (active) setSnapshot(null); }
    };
    void load();
    const timer = phase === "settled" ? undefined : window.setInterval(() => void load(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [phase, matchId]);

  const priceSymbol = (teamId: number | undefined) => {
    const symbol = CUP_TEAMS[teamId ?? -1]?.symbol;
    return symbol === "TRON" ? "TRX" : symbol === "PENGUIN" ? "PENGU" : symbol;
  };
  const symbolA = priceSymbol(teamA);
  const symbolB = priceSymbol(teamB);
  const priceA = symbolA ? prices[symbolA] : undefined;
  const priceB = symbolB ? prices[symbolB] : undefined;
  const fresh = !!symbolA && !!symbolB && Date.now() - (updatedAt[symbolA] ?? 0) < 60_000 && Date.now() - (updatedAt[symbolB] ?? 0) < 60_000;
  const final = snapshot?.endSubmitted === true;
  const valid = snapshot?.startSubmitted && snapshot.startA > 0n && snapshot.startB > 0n && (final || (live && fresh && priceA !== undefined && priceB !== undefined));
  if (!valid) return { snapshot, score: null, moves: null, prices: null, fresh, final };

  const scaledA = final ? snapshot.endA : BigInt(Math.round(priceA! * 10 ** PRICE_DECIMALS));
  const scaledB = final ? snapshot.endB : BigInt(Math.round(priceB! * 10 ** PRICE_DECIMALS));
  const bpsA = ((scaledA - snapshot.startA) * 10_000n) / snapshot.startA;
  const bpsB = ((scaledB - snapshot.startB) * 10_000n) / snapshot.startB;
  const goals = (bps: bigint) => Number((bps >= 0n ? bps + 25n : bps - 25n) / 50n);
  const rawA = goals(bpsA);
  const rawB = goals(bpsB);
  return {
    snapshot,
    score: [Math.max(rawA, 0) + Math.max(-rawB, 0), Math.max(rawB, 0) + Math.max(-rawA, 0)] as [number, number],
    moves: [Number(bpsA) / 100, Number(bpsB) / 100] as [number, number],
    prices: final ? [Number(snapshot.endA) / 10 ** PRICE_DECIMALS, Number(snapshot.endB) / 10 ** PRICE_DECIMALS] as [number, number] : [priceA!, priceB!] as [number, number],
    fresh,
    final,
  };
}
