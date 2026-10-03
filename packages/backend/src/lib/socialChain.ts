/**
 * Chain access for the TICKR social layer — mirrors the transport choices of
 * src/api/readClient.ts (viem, HTTP transport, chain picked by TICKR_CHAIN_ENV).
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { base, baseSepolia } from "viem/chains";
import { config } from "../config.js";
import { logger } from "./logger.js";

const SEASON_REGISTRY_ABI = [
  {
    type: "function",
    name: "currentSeasonId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export function getSocialChainId(): number {
  return config.chainEnv === "mainnet" ? base.id : baseSepolia.id;
}

export function createSocialPublicClient(): PublicClient {
  const chain = config.chainEnv === "mainnet" ? base : baseSepolia;
  const rpcUrl =
    config.chainEnv === "mainnet" ? config.baseMainnetRpcUrl : config.baseSepoliaRpcUrl;
  return createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;
}

/**
 * Cached currentSeasonId() reader. Refreshes at most every 60s; falls back
 * to the SEASON_ID env on RPC failure so a hiccup never breaks the API.
 */
export function createSeasonIdCache(client: PublicClient): { get(): Promise<number> } {
  let cached: { value: number; at: number } | null = null;
  const fallback = Number(config.seasonId);
  return {
    async get(): Promise<number> {
      const now = Date.now();
      if (cached && now - cached.at < 60_000) return cached.value;
      try {
        const id = await client.readContract({
          address: config.contracts.seasonRegistry,
          abi: SEASON_REGISTRY_ABI,
          functionName: "currentSeasonId",
        });
        cached = { value: Number(id), at: now };
        return cached.value;
      } catch (err) {
        logger.warn("[social] currentSeasonId read failed, using fallback", {
          error: String(err),
        });
        return cached?.value ?? fallback;
      }
    },
  };
}
