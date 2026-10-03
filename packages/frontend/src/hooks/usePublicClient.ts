/**
 * Shared viem public client for chain reads (no wallet needed).
 * RPC: NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL (testnet) / sepolia.base.org fallback.
 */

import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { ACTIVE_CHAIN, getChainEnv } from "../lib/contracts";

let singleton: PublicClient | null = null;

export function getPublicClient(): PublicClient {
  if (singleton) return singleton;
  const env = getChainEnv();
  const rpcUrl =
    env === "mainnet"
      ? process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org"
      : process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
  singleton = createPublicClient({
    // @tickr/shared and the frontend may resolve separate viem patch versions;
    // the runtime chain shape is identical.
    chain: ACTIVE_CHAIN as unknown as Chain,
    transport: http(rpcUrl, {
      // The public Base endpoint can occasionally stall on read-heavy pages.
      // Give individual reads enough time to recover without hanging the UI.
      timeout: 20_000,
      retryCount: 2,
      retryDelay: 500,
    }),
  }) as PublicClient;
  return singleton;
}

export function usePublicClient(): PublicClient {
  return getPublicClient();
}
