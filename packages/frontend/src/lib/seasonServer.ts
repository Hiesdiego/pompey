/**
 * Server-only season helper for the social-layer Route Handlers.
 * Reads currentSeasonId() on-chain with a 60s in-memory cache; falls back to
 * NEXT_PUBLIC_SEASON_ID when the registry isn't configured or the RPC fails.
 */

import "server-only";
import { CONTRACTS, SEASON_ID } from "./contracts";
import { getPublicClient } from "../hooks/usePublicClient";

const SEASON_REGISTRY_ABI = [
  {
    type: "function",
    name: "currentSeasonId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

let cached: { seasonId: number; at: number } | null = null;

export async function currentSeasonId(): Promise<number> {
  if (cached && Date.now() - cached.at < 60_000) return cached.seasonId;

  const fallback = Number(SEASON_ID);
  const registry = CONTRACTS.seasonRegistry;
  if (!registry) {
    cached = { seasonId: fallback, at: Date.now() };
    return fallback;
  }

  try {
    const client = getPublicClient();
    const id = await client.readContract({
      address: registry,
      abi: SEASON_REGISTRY_ABI,
      functionName: "currentSeasonId",
    });
    const seasonId = Number(id);
    cached = { seasonId, at: Date.now() };
    return seasonId;
  } catch (e) {
    console.warn(
      "[social] currentSeasonId read failed, using fallback:",
      e instanceof Error ? e.message : e
    );
    cached = { seasonId: fallback, at: Date.now() };
    return fallback;
  }
}
