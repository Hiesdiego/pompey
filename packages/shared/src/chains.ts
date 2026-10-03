import { defineChain } from "viem";
import { baseSepolia as viemBaseSepolia, base as viemBase } from "viem/chains";

/**
 * TICKR v0.1 runs on Base Sepolia (testnet) first, then Base mainnet.
 * We re-export viem's canonical chain definitions so every package
 * (contracts, backend, frontend) references the exact same chain object.
 */

export const baseSepolia = viemBaseSepolia;
export const baseMainnet = viemBase;

export const ACTIVE_CHAIN_ENV = (process.env.TICKR_CHAIN_ENV ?? "testnet") as
  | "testnet"
  | "mainnet";

export const activeChain = ACTIVE_CHAIN_ENV === "mainnet" ? baseMainnet : baseSepolia;

export const CHAIN_CONFIG = {
  testnet: {
    chain: baseSepolia,
    chainId: baseSepolia.id, // 84532
    name: "Base Sepolia",
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    isTestnet: true,
  },
  mainnet: {
    chain: baseMainnet,
    chainId: baseMainnet.id, // 8453
    name: "Base",
    rpcUrl: process.env.BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    isTestnet: false,
  },
} as const;

export function getChainConfig(env: "testnet" | "mainnet" = ACTIVE_CHAIN_ENV) {
  return CHAIN_CONFIG[env];
}

/**
 * Custom chain definition kept as a fallback in case a project-specific
 * RPC override is needed beyond viem's default (e.g. a private/paid RPC).
 * Not used by default — activeChain above is the source of truth.
 */
export const customBaseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"] },
  },
  blockExplorers: {
    default: { name: "Basescan", url: "https://sepolia.basescan.org" },
  },
  testnet: true,
});
