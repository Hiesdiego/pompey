
import { baseSepolia, baseMainnet } from "@tickr/shared/chains";
import type { Address } from "viem";

export type ChainEnv = "testnet" | "mainnet";

export function getChainEnv(): ChainEnv {
  return process.env.NEXT_PUBLIC_TICKR_CHAIN_ENV === "mainnet" ? "mainnet" : "testnet";
}

export const ACTIVE_CHAIN = getChainEnv() === "mainnet" ? baseMainnet : baseSepolia;
export const ACTIVE_CHAIN_ID = ACTIVE_CHAIN.id;
export const ACTIVE_CHAIN_NAME = getChainEnv() === "mainnet" ? "Base" : "Base Sepolia";

export const SEASON_ID: bigint = BigInt(process.env.NEXT_PUBLIC_SEASON_ID ?? "1");

export const SEASON_DISPLAY_NAME: string =
  process.env.NEXT_PUBLIC_SEASON_NAME?.trim() || "CTF Season 1";

export const BACKEND_API_URL = "/backend-api";

function envAddress(value: string | undefined): Address | "" {
  const v = (value ?? "").trim();
  return v === "" ? "" : (v as Address);
}

export const CONTRACTS = {

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

export const PRICE_DECIMALS = 8;

export const FIXTURE_ID_SPACE = 1_000_000n;

export function globalFixtureId(seasonId: bigint, fixtureId: bigint): bigint {
  return seasonId * FIXTURE_ID_SPACE + fixtureId;
}

export const MIN_STAKE_TICK = 10;

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
    name: "lastFaucetClaim",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "faucetCooldown",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const PREDICTION_POOL_ABI = [
  {
    type: "function",
    name: "platformFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
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
    name: "claimVoid",

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
          { name: "seed", type: "uint256" },
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
