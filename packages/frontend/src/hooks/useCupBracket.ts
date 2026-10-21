/**
 * useCupBracket — loads the full 63-match cup bracket from CupRegistry.
 *
 * Polls every 30s so kickoff reveals, live states, and results flow in
 * without a reload. Reads are chunked to stay kind to public RPCs.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CUP_CONTRACTS, CUP_REGISTRY_ABI, CUP_TBD, cupConfigured } from "../lib/cup";
import { getPublicClient } from "./usePublicClient";

export interface CupMatch {
  matchId: number;
  teamA: number;
  teamB: number;
  feederA: number;
  feederB: number;
  winner: number;
  kickoffMs: number;
  endMs: number;
  state: number; // 0=Created, 1=Open, 2=Settled, 3=Disputed
  goalsA: number;
  goalsB: number;
}

export interface CupStatus {
  drawExecuted: boolean;
  tournamentComplete: boolean;
  champion: number | null;
}

const POLL_MS = 30_000;
const CHUNK = 16;

async function readMatch(matchId: number): Promise<CupMatch> {
  const m = (await getPublicClient().readContract({
    address: CUP_CONTRACTS.registry as `0x${string}`,
    abi: CUP_REGISTRY_ABI,
    functionName: "getMatch",
    args: [matchId],
  })) as unknown as {
    teamA: number;
    teamB: number;
    feederA: number;
    feederB: number;
    winner: number;
    kickoffTimestamp: bigint;
    endTimestamp: bigint;
    state: number;
    goalsA: number;
    goalsB: number;
  };
  return {
    matchId,
    teamA: m.teamA,
    teamB: m.teamB,
    feederA: m.feederA,
    feederB: m.feederB,
    winner: m.winner,
    kickoffMs: Number(m.kickoffTimestamp) * 1000,
    endMs: Number(m.endTimestamp) * 1000,
    state: m.state,
    goalsA: m.goalsA,
    goalsB: m.goalsB,
  };
}

export function useCupBracket(enabled = true) {
  const [matches, setMatches] = useState<CupMatch[] | null>(null);
  const [status, setStatus] = useState<CupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!cupConfigured || !enabled) return;
    try {
      const client = getPublicClient();
      const [drawExecuted, tournamentComplete] = await Promise.all([
        client.readContract({
          address: CUP_CONTRACTS.registry as `0x${string}`,
          abi: CUP_REGISTRY_ABI,
          functionName: "drawExecuted",
        }),
        client.readContract({
          address: CUP_CONTRACTS.registry as `0x${string}`,
          abi: CUP_REGISTRY_ABI,
          functionName: "tournamentComplete",
        }),
      ]);
      let champion: number | null = null;
      if (tournamentComplete as boolean) {
        champion = (await client.readContract({
          address: CUP_CONTRACTS.registry as `0x${string}`,
          abi: CUP_REGISTRY_ABI,
          functionName: "champion",
        })) as number;
      }
      const all: CupMatch[] = [];
      for (let start = 0; start < 63; start += CHUNK) {
        const end = Math.min(start + CHUNK, 63);
        const ids: number[] = [];
        for (let i = start; i < end; i++) ids.push(i);
        const chunk = await Promise.all(ids.map(readMatch));
        all.push(...chunk);
      }
      if (!aliveRef.current) return;
      all.sort((a, b) => a.matchId - b.matchId);
      // Solidity's empty mapping slots decode as team 0 (BTC) before the draw.
      // No participant is known until the registry has populated the bracket.
      setMatches(drawExecuted ? all : all.map((match) => ({ ...match, teamA: CUP_TBD, teamB: CUP_TBD, winner: CUP_TBD })));
      setStatus({
        drawExecuted: drawExecuted as boolean,
        tournamentComplete: tournamentComplete as boolean,
        champion,
      });
      setError(null);
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e));
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

  return { matches, status, error, reload: load, cupConfigured, TBD: CUP_TBD };
}
