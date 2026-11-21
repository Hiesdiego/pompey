"use client";

/**
 * Arena query hooks.
 *
 * Target location in the repo:
 *   packages/frontend/src/lib/query/useArena.ts
 *
 * Mirrors lib/query/useStockMarkets.ts: every hook is enabled only when
 * the factory address is set, so the boards stay quiet before deploy.
 * Clash lists poll every 15 seconds like the stock markets. The detail
 * hook polls on the same interval while a clash is live. Registry,
 * rankings and cup hooks poll more slowly, they move on backend cycles.
 *
 * Query keys come from lib/query/keys.ts. See keys-arena-addition.md in
 * this delivery for the exact lines to add to qks before these hooks
 * compile in the repo.
 */

import { useQuery } from "@tanstack/react-query";
import { qks } from "./keys";
import { ARENA_CLASH_FACTORY_ADDRESS, arenaApi } from "../arenaContracts";

export function useArenaClashes() {
  return useQuery({
    queryKey: qks.arenaClashes,
    queryFn: async () => {
      const result = await arenaApi.clashes();
      return {
        clashes: result.clashes,
        asOfBlock: result.asOfBlock,
        refreshedAt: result.refreshedAt ?? new Date().toISOString(),
      };
    },
    enabled: Boolean(ARENA_CLASH_FACTORY_ADDRESS),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useArenaClash(id: string | number | bigint | null, address?: string | null) {
  return useQuery({
    queryKey: qks.arenaClash(id ?? ""),
    queryFn: async () => arenaApi.clash(id as string | number | bigint, address ?? null),
    enabled: Boolean(ARENA_CLASH_FACTORY_ADDRESS) && id !== null && id !== "",
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useArenaRegistry() {
  return useQuery({
    queryKey: qks.arenaRegistry,
    queryFn: async () => ({ memes: await arenaApi.registry(), refreshedAt: new Date().toISOString() }),
    enabled: Boolean(ARENA_CLASH_FACTORY_ADDRESS),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useArenaRankings() {
  return useQuery({
    queryKey: qks.arenaRankings,
    queryFn: async () => arenaApi.rankings(),
    enabled: Boolean(ARENA_CLASH_FACTORY_ADDRESS),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useArenaCups() {
  return useQuery({
    queryKey: qks.arenaCups,
    queryFn: async () => ({ cups: await arenaApi.cups() }),
    enabled: Boolean(ARENA_CLASH_FACTORY_ADDRESS),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useCurrentCup() {
  return useQuery({
    queryKey: qks.arenaCurrentCup,
    queryFn: async () => ({ cup: await arenaApi.currentCup() }),
    enabled: Boolean(ARENA_CLASH_FACTORY_ADDRESS),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
