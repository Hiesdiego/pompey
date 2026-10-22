/**
 * CRYPTO PRICE WORLD CUP — frontend config, ABIs, and static data.
 *
 * Addresses come from NEXT_PUBLIC_CUP_* env vars (see .env.example).
 * ABIs are copied from the deployed Solidity sources (10-field CupMatch).
 */

import type { Address } from "viem";
import { TICK_TOKEN_ABI } from "./contracts";

function envAddress(value: string | undefined): Address | "" {
  const v = (value ?? "").trim();
  return v === "" ? "" : (v as Address);
}

export const CUP_CONTRACTS = {
  tickToken: envAddress(process.env.NEXT_PUBLIC_CUP_TICK_TOKEN_ADDRESS),
  registry: envAddress(process.env.NEXT_PUBLIC_CUP_REGISTRY_ADDRESS),
  engine: envAddress(process.env.NEXT_PUBLIC_CUP_ENGINE_ADDRESS),
  ballot: envAddress(process.env.NEXT_PUBLIC_CUP_BALLOT_ADDRESS),
  pool: envAddress(process.env.NEXT_PUBLIC_CUP_POOL_ADDRESS),
} as const;

/** The 2026 Crypto Price World Cup runs Nov 1 through Nov 15 (UTC). */
export const CUP_FAVORITE_START = Date.parse("2026-11-01T00:00:00Z");
export const CUP_FAVORITE_END = Date.parse("2026-11-16T00:00:00Z");
export const CUP_TOURNAMENT_START = CUP_FAVORITE_START + 10 * 60 * 60 * 1000;

/** Published R64 slots; a revealed on-chain kickoff always takes precedence. */
export function cupScheduledKickoff(matchId: number): number | null {
  if (matchId < 0 || matchId >= 32) return null;
  const day = matchId < 12 ? Math.floor(matchId / 6) : 2 + Math.floor((matchId - 12) / 5);
  const first = day < 2 ? day * 6 : 12 + (day - 2) * 5;
  return CUP_FAVORITE_START + day * 86_400_000 + (10 + (matchId - first) * 2) * 3_600_000;
}

export const cupConfigured =
  CUP_CONTRACTS.registry !== "" &&
  CUP_CONTRACTS.pool !== "" &&
  CUP_CONTRACTS.tickToken !== "";

/** On-chain TBD sentinel. */
export const CUP_TBD = 65535;

/** Match states: 0=Created, 1=Open, 2=Settled, 3=Disputed. */
export const CUP_STATE = { Created: 0, Open: 1, Settled: 2, Disputed: 3 } as const;

export const CUP_MIN_STAKE_TICK = 10;
export const CUP_FEE_BPS = 700;
export const CUP_MATCH_DURATION_MS = 60 * 60 * 1000;

export interface CupRound {
  name: string;
  short: string;
  start: number;
  end: number;
}

export const CUP_ROUNDS: CupRound[] = [
  { name: "Round of 64", short: "R64", start: 0, end: 31 },
  { name: "Round of 32", short: "R32", start: 32, end: 47 },
  { name: "Round of 16", short: "R16", start: 48, end: 55 },
  { name: "Quarterfinals", short: "QF", start: 56, end: 59 },
  { name: "Semifinals", short: "SF", start: 60, end: 61 },
  { name: "Final", short: "Final", start: 62, end: 62 },
];

export function cupRoundOf(matchId: number): number {
  if (matchId < 32) return 0;
  if (matchId < 48) return 1;
  if (matchId < 56) return 2;
  if (matchId < 60) return 3;
  if (matchId < 62) return 4;
  return 5;
}

/** The 64-team field in on-chain registration order (pots 1→4). */
export const CUP_TEAMS: { teamId: number; symbol: string; pot: number }[] = [
  { teamId: 0, symbol: "BTC", pot: 1 },
  { teamId: 1, symbol: "ETH", pot: 1 },
  { teamId: 2, symbol: "BNB", pot: 1 },
  { teamId: 3, symbol: "XRP", pot: 1 },
  { teamId: 4, symbol: "SOL", pot: 1 },
  { teamId: 5, symbol: "TRON", pot: 1 },
  { teamId: 6, symbol: "HYPE", pot: 1 },
  { teamId: 7, symbol: "ZEC", pot: 1 },
  { teamId: 8, symbol: "DOGE", pot: 1 },
  { teamId: 9, symbol: "LINK", pot: 1 },
  { teamId: 10, symbol: "ADA", pot: 1 },
  { teamId: 11, symbol: "NEAR", pot: 1 },
  { teamId: 12, symbol: "LTC", pot: 1 },
  { teamId: 13, symbol: "AVAX", pot: 1 },
  { teamId: 14, symbol: "SHIB", pot: 1 },
  { teamId: 15, symbol: "TRUMP", pot: 1 },
  { teamId: 16, symbol: "XLM", pot: 2 },
  { teamId: 17, symbol: "UNI", pot: 2 },
  { teamId: 18, symbol: "BCH", pot: 2 },
  { teamId: 19, symbol: "WAL", pot: 2 },
  { teamId: 20, symbol: "HBAR", pot: 2 },
  { teamId: 21, symbol: "SUI", pot: 2 },
  { teamId: 22, symbol: "GRAM", pot: 2 },
  { teamId: 23, symbol: "TAO", pot: 2 },
  { teamId: 24, symbol: "XAUT", pot: 2 },
  { teamId: 25, symbol: "PUMP", pot: 2 },
  { teamId: 26, symbol: "WLD", pot: 2 },
  { teamId: 27, symbol: "ENA", pot: 2 },
  { teamId: 28, symbol: "QNT", pot: 2 },
  { teamId: 29, symbol: "AAVE", pot: 2 },
  { teamId: 30, symbol: "ONDO", pot: 2 },
  { teamId: 31, symbol: "DOT", pot: 2 },
  { teamId: 32, symbol: "ASTER", pot: 3 },
  { teamId: 33, symbol: "WLFI", pot: 3 },
  { teamId: 34, symbol: "ARB", pot: 3 },
  { teamId: 35, symbol: "ICP", pot: 3 },
  { teamId: 36, symbol: "PEPE", pot: 3 },
  { teamId: 37, symbol: "SKY", pot: 3 },
  { teamId: 38, symbol: "ORE", pot: 3 },
  { teamId: 39, symbol: "FIL", pot: 3 },
  { teamId: 40, symbol: "ETC", pot: 3 },
  { teamId: 41, symbol: "JST", pot: 3 },
  { teamId: 42, symbol: "JUP", pot: 3 },
  { teamId: 43, symbol: "ALGO", pot: 3 },
  { teamId: 44, symbol: "RAY", pot: 3 },
  { teamId: 45, symbol: "POL", pot: 3 },
  { teamId: 46, symbol: "RENDER", pot: 3 },
  { teamId: 47, symbol: "ATOM", pot: 3 },
  { teamId: 48, symbol: "INJ", pot: 4 },
  { teamId: 49, symbol: "TOSHI", pot: 4 },
  { teamId: 50, symbol: "NIGHT", pot: 4 },
  { teamId: 51, symbol: "CAKE", pot: 4 },
  { teamId: 52, symbol: "VIRTUAL", pot: 4 },
  { teamId: 53, symbol: "PYTH", pot: 4 },
  { teamId: 54, symbol: "DASH", pot: 4 },
  { teamId: 55, symbol: "CRV", pot: 4 },
  { teamId: 56, symbol: "OP", pot: 4 },
  { teamId: 57, symbol: "TIA", pot: 4 },
  { teamId: 58, symbol: "VET", pot: 4 },
  { teamId: 59, symbol: "STRK", pot: 4 },
  { teamId: 60, symbol: "PENGUIN", pot: 4 },
  { teamId: 61, symbol: "SEI", pot: 4 },
  { teamId: 62, symbol: "AXS", pot: 4 },
  { teamId: 63, symbol: "IMX", pot: 4 },
];

export const CUP_TEAM_SYMBOLS: Record<number, string> = Object.fromEntries(
  CUP_TEAMS.map((t) => [t.teamId, t.symbol])
);

const CUP_TEAM_NAMES = [
  "Bitcoin", "Ethereum", "BNB", "XRP", "Solana", "TRON", "Hyperliquid", "Zcash", "Dogecoin", "Chainlink", "Cardano", "NEAR Protocol", "Litecoin", "Avalanche", "Shiba Inu", "Official Trump",
  "Stellar", "Uniswap", "Bitcoin Cash", "Walrus", "Hedera", "Sui", "Toncoin", "Bittensor", "Tether Gold", "Pump.fun", "Worldcoin", "Ethena", "Quant", "Aave", "Ondo Finance", "Polkadot",
  "Aster", "World Liberty Financial", "Arbitrum", "Internet Computer", "Pepe", "Sky", "Ore", "Filecoin", "Ethereum Classic", "JUST", "Jupiter", "Algorand", "Raydium", "Polygon", "Render", "Cosmos",
  "Injective", "Toshi", "Midnight", "PancakeSwap", "Virtuals Protocol", "Pyth Network", "Dash", "Curve DAO Token", "Optimism", "Celestia", "VeChain", "Starknet", "Pudgy Penguins", "Sei", "Axie Infinity", "Immutable",
];

export function cupTeamName(teamId: number): string {
  return CUP_TEAM_NAMES[teamId] ?? "TBA";
}

/** TradingView spot pairs. Exceptions follow the Cup oracle's actual asset mapping. */
export function cupChartSymbol(teamId: number): string | null {
  const symbol = CUP_TEAM_SYMBOLS[teamId];
  if (!symbol) return null;
  if (teamId === 38) return "WEEX:OREUSDT";
  if (teamId === 49) return "COINBASE:TOSHIUSD";
  const base = { TRON: "TRX", PENGUIN: "PENGU" }[symbol] ?? symbol;
  return `BINANCE:${base}USDT`;
}

export function cupOutrightOpen(matches: { kickoffMs: number }[] | null, tournamentComplete: boolean): boolean {
  if (!matches || tournamentComplete) return false;
  const kickoff = matches[62]?.kickoffMs ?? 0;
  return kickoff === 0 || Date.now() < kickoff;
}

/** "Winner Match 3" style label for a TBD slot (1-indexed for humans). */
export function roadToLabel(feederMatchId: number): string {
  return `Winner Match ${feederMatchId + 1}`;
}

// ── ABIs (from the deployed sources) ─────────────────────────────────────────

/** CupRegistry reads. CupMatch is the 10-field struct. */
export const CUP_REGISTRY_ABI = [
  {
    type: "function",
    name: "getMatch",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint16" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "teamA", type: "uint16" },
          { name: "teamB", type: "uint16" },
          { name: "feederA", type: "uint16" },
          { name: "feederB", type: "uint16" },
          { name: "winner", type: "uint16" },
          { name: "kickoffTimestamp", type: "uint64" },
          { name: "endTimestamp", type: "uint64" },
          { name: "state", type: "uint8" },
          { name: "goalsA", type: "int16" },
          { name: "goalsB", type: "int16" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "drawExecuted",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "tournamentComplete",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "champion",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
] as const;

/** CupPool reads + writes used by the UI. */
export const CUP_POOL_ABI = [
  {
    type: "function",
    name: "getMatchPool",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint16" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "totalA", type: "uint256" },
          { name: "totalB", type: "uint256" },
          { name: "seed", type: "uint256" },
          { name: "settled", type: "bool" },
          { name: "winner", type: "uint16" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getMatchStake",
    stateMutability: "view",
    inputs: [
      { name: "matchId", type: "uint16" },
      { name: "player", type: "address" },
      { name: "side", type: "uint8" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getOutrightTotal",
    stateMutability: "view",
    inputs: [{ name: "teamId", type: "uint16" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "outrightSettled",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getSpreadsByMatch",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint16" }],
    outputs: [{ name: "uint256[]", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getSpread",
    stateMutability: "view",
    inputs: [{ name: "spreadId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "matchId", type: "uint16" },
          { name: "favorite", type: "uint16" },
          { name: "points", type: "int16" },
          { name: "totalCover", type: "uint256" },
          { name: "totalNotCover", type: "uint256" },
          { name: "seed", type: "uint256" },
          { name: "settled", type: "bool" },
          { name: "covered", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "stakeMatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint16" },
      { name: "side", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "stakeOutright",
    stateMutability: "nonpayable",
    inputs: [
      { name: "teamId", type: "uint16" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "stakeSpread",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spreadId", type: "uint256" },
      { name: "side", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimMatch",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "uint16" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimOutright",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "claimSpread",
    stateMutability: "nonpayable",
    inputs: [{ name: "spreadId", type: "uint256" }],
    outputs: [],
  },
] as const;

export { TICK_TOKEN_ABI };
