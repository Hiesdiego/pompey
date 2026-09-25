/**
 * TICKR frontend contract config.
 *
 * Every address comes from a NEXT_PUBLIC_* env var — nothing is hardcoded.
 * An empty string means "not configured yet" (the user fills .env.local).
 */

import { baseSepolia, baseMainnet } from "@tickr/shared/chains";
import type { Address } from "viem";

export type ChainEnv = "testnet" | "mainnet";

export function getChainEnv(): ChainEnv {
  return process.env.NEXT_PUBLIC_TICKR_CHAIN_ENV === "mainnet" ? "mainnet" : "testnet";
}

export const ACTIVE_CHAIN = getChainEnv() === "mainnet" ? baseMainnet : baseSepolia;
export const ACTIVE_CHAIN_ID = ACTIVE_CHAIN.id; // 84532 on testnet
export const ACTIVE_CHAIN_NAME = getChainEnv() === "mainnet" ? "Base" : "Base Sepolia";

export const SEASON_ID: bigint = BigInt(process.env.NEXT_PUBLIC_SEASON_ID ?? "1");

const configuredBackendUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL?.trim();
export const BACKEND_API_URL =
  (configuredBackendUrl || "http://localhost:4000").replace(/\/$/, "");

function envAddress(value: string | undefined): Address | "" {
  const v = (value ?? "").trim();
  return v === "" ? "" : (v as Address);
}

/** Deployed contract addresses. "" = not configured yet. */
export const CONTRACTS = {
  // Keep these references static: Next.js inlines NEXT_PUBLIC_* values only
  // when it can see the property access at build time.
  tickToken: envAddress(process.env.NEXT_PUBLIC_TICK_TOKEN_ADDRESS),
  playerStats: envAddress(process.env.NEXT_PUBLIC_PLAYER_STATS_ADDRESS),
  priceOracle: envAddress(process.env.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS),
  seasonRegistry: envAddress(process.env.NEXT_PUBLIC_SEASON_REGISTRY_ADDRESS),
  teamRegistryS1: envAddress(process.env.NEXT_PUBLIC_TEAM_REGISTRY_S1_ADDRESS),
  matchRegistryS1: envAddress(process.env.NEXT_PUBLIC_MATCH_REGISTRY_S1_ADDRESS),
  predictionPool: envAddress(process.env.NEXT_PUBLIC_PREDICTION_POOL_ADDRESS),
  resultEngine: envAddress(process.env.NEXT_PUBLIC_RESULT_ENGINE_ADDRESS),
} as const;

export const TICK_DECIMALS = 18;
/** PriceOracle stores prices scaled by 1e8 (see backend lib/priceMath.ts). */
export const PRICE_DECIMALS = 8;
/** SeasonMath.FIXTURE_ID_SPACE — composite key for persistent contracts. */
export const FIXTURE_ID_SPACE = 1_000_000n;

export function globalFixtureId(seasonId: bigint, fixtureId: bigint): bigint {
  return seasonId * FIXTURE_ID_SPACE + fixtureId;
}

/** Minimum stake enforced by PredictionPool (also mirrored in UI). */
export const MIN_STAKE_TICK = 10;

// ── Minimal ABIs (copied from the Solidity sources, not invented) ───────────

/** TickToken: ERC-20 bits + testnet faucet. See contracts/TickToken.sol */
export const TICK_TOKEN_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimFaucet",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

/**
 * PredictionPool. See contracts/PredictionPool.sol
 * stake(seasonId, fixtureId, outcome, amount) — outcome is the Outcome enum as uint8
 * (WinHome=0, Draw=1, WinAway=2). claim(seasonId, fixtureId). claimed() is the
 * auto-getter for `mapping(uint256 => mapping(address => bool)) public claimed`
 * keyed by GLOBAL fixture id (see globalFixtureId above).
 */
export const PREDICTION_POOL_ABI = [
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
      { name: "outcome", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "totalHome", type: "uint256" },
          { name: "totalDraw", type: "uint256" },
          { name: "totalAway", type: "uint256" },
          { name: "settled", type: "bool" },
          { name: "winningOutcome", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getStake",
    stateMutability: "view",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
      { name: "player", type: "address" },
      { name: "outcome", type: "uint8" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [
      { name: "globalFixtureId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** PriceOracle.getSnapshot — see contracts/PriceOracle.sol (prices scaled 1e8). */
export const PRICE_ORACLE_ABI = [
  {
    type: "function",
    name: "getSnapshot",
    stateMutability: "view",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "homeStart", type: "uint256" },
          { name: "awayStart", type: "uint256" },
          { name: "homeEnd", type: "uint256" },
          { name: "awayEnd", type: "uint256" },
          { name: "startSubmitted", type: "bool" },
          { name: "endSubmitted", type: "bool" },
        ],
      },
    ],
  },
] as const;

/** MatchRegistry read-only views — see contracts/MatchRegistry.sol */
export const MATCH_REGISTRY_ABI = [
  {
    type: "function",
    name: "getFixture",
    stateMutability: "view",
    inputs: [{ name: "fixtureId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "homeTeamId", type: "uint16" },
          { name: "awayTeamId", type: "uint16" },
          { name: "matchdayIndex", type: "uint8" },
          { name: "windowStart", type: "uint64" },
          { name: "windowEnd", type: "uint64" },
          { name: "kickoffTimestamp", type: "uint64" },
          { name: "kickoffRevealed", type: "bool" },
          { name: "settled", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isBettingOpen",
    stateMutability: "view",
    inputs: [{ name: "fixtureId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
