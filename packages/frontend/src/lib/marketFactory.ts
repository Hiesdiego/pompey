/**
 * TICKR v0.2 — MarketFactory contract config + updated Fixture ABI.
 *
 * MarketFactory is the permissionless outright-markets engine: anyone can
 * create a market from 5 templates (TOP_GAINER, CHAMPION, H2H, TARGET,
 * SPREAD) for a 250-TICK creation fee that becomes unallocated seed
 * liquidity. Resolution is permissionless and fully on-chain-data-driven.
 *
 * Also exports the v0.2 Fixture tuple (with matchEndTimestamp) for pages
 * that need the in-play betting window.
 */

import type { Address } from "viem";

function envAddress(value: string | undefined): Address | "" {
  const v = (value ?? "").trim();
  return v === "" ? "" : (v as Address);
}

/** v0.2: MarketFactory address. "" = not configured yet (fill after redeploy). */
export const MARKET_FACTORY_ADDRESS = envAddress(
  process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS
) as Address;

/** v0.2: creation fee / seed liquidity (250 TICK, 18 decimals). */
export const CREATION_SEED_TICK = 250;
/** v0.2: minimum stake on factory markets (mirrors PredictionPool). */
export const FACTORY_MIN_STAKE_TICK = 10;
/** v0.2: in-play betting closes 5 min before the match end (on-chain rule). */
export const INPLAY_CLOSE_BUFFER_SECONDS = 300;

/** Template ids — must match MarketFactory.sol constants. */
export const TEMPLATES = {
  TOP_GAINER: 0,
  CHAMPION: 1,
  H2H: 2,
  TARGET: 3,
  SPREAD: 4,
} as const;

export const TEMPLATE_NAMES: Record<number, string> = {
  [TEMPLATES.TOP_GAINER]: "Matchday Top Gainer",
  [TEMPLATES.CHAMPION]: "Season Champion",
  [TEMPLATES.H2H]: "Head-to-Head",
  [TEMPLATES.TARGET]: "Price Target",
  [TEMPLATES.SPREAD]: "Fixture Spread",
};

export const TEMPLATE_DESCRIPTIONS: Record<number, string> = {
  [TEMPLATES.TOP_GAINER]:
    "Which team gains the most over a matchday window. Prices come from the on-chain oracle checkpoints at the window edges — the UI shows the live table so you can verify the winner yourself.",
  [TEMPLATES.CHAMPION]:
    "Which team wins the season (most points, then goal difference). Resolves only when every fixture of the season has settled.",
  [TEMPLATES.H2H]:
    "Which of two teams gains more over a custom time window (up to 30 days). An exact tie splits the pool between both outcomes.",
  [TEMPLATES.TARGET]:
    "Will a team's price be above (or below) a target at a specific time? Yes/No. Resolves from the oracle checkpoint at that time.",
  [TEMPLATES.SPREAD]:
    "Does the home team beat the away team by more than the spread (in rounded % points)? Resolves from the fixture's on-chain end prices.",
};

/** MarketFactory minimal ABI — only what the frontend calls. */
export const MARKET_FACTORY_ABI = [
  {
    type: "function",
    name: "marketCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "marketInfo",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "templateId", type: "uint8" },
      { name: "creator", type: "address" },
      { name: "creatorName", type: "string" },
      { name: "createdAt", type: "uint64" },
      { name: "bettingCloseTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "voidAfter", type: "uint64" },
      { name: "params", type: "bytes" },
      { name: "outcomeCount", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "marketSettlement",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "seedAmount", type: "uint256" },
      { name: "totalStaked", type: "uint256" },
      { name: "state", type: "uint8" },
      { name: "winnerBitmap", type: "uint256" },
      { name: "payoutPerShare", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "createMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "templateId", type: "uint8" },
      { name: "params", type: "bytes" },
      { name: "creatorName", type: "string" },
    ],
    outputs: [{ name: "marketId", type: "uint256" }],
  },
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcome", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "voidMarket",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "outcomeTotals",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcome", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "stakes",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user", type: "address" },
      { name: "outcome", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getTopGainerTable",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "teams", type: "uint16[]" },
      { name: "priceStart", type: "uint256[]" },
      { name: "priceEnd", type: "uint256[]" },
      { name: "gainBps", type: "int256[]" },
      { name: "valid", type: "bool[]" },
    ],
  },
  {
    type: "function",
    name: "CREATION_SEED",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  { type: "error", name: "UnknownTemplate", inputs: [{ name: "templateId", type: "uint8" }] },
  { type: "error", name: "InvalidParams", inputs: [] },
  { type: "error", name: "BettingClosed", inputs: [{ name: "marketId", type: "uint256" }] },
  { type: "error", name: "NotResolvableYet", inputs: [{ name: "marketId", type: "uint256" }] },
  { type: "error", name: "NotVoidable", inputs: [{ name: "marketId", type: "uint256" }] },
  { type: "error", name: "AlreadySettled", inputs: [{ name: "marketId", type: "uint256" }] },
  { type: "error", name: "NothingToClaim", inputs: [
    { name: "marketId", type: "uint256" },
    { name: "user", type: "address" },
  ] },
] as const;

/** v0.2 Fixture tuple — adds matchEndTimestamp (pinned at kickoff reveal). */
export const MATCH_REGISTRY_V2_ABI = [
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
          { name: "matchEndTimestamp", type: "uint64" },
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
  {
    type: "function",
    name: "matchDurationSeconds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

/** PriceOracle checkpoint reads for the transparency views. */
export const PRICE_ORACLE_V2_ABI = [
  {
    type: "function",
    name: "getPriceAt",
    stateMutability: "view",
    inputs: [
      { name: "teamId", type: "uint16" },
      { name: "timestamp", type: "uint64" },
    ],
    outputs: [
      { name: "found", type: "bool" },
      { name: "price", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getFixtureEndPrices",
    stateMutability: "view",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
    outputs: [
      { name: "endSubmitted", type: "bool" },
      { name: "homeStart", type: "uint256" },
      { name: "awayStart", type: "uint256" },
      { name: "homeEnd", type: "uint256" },
      { name: "awayEnd", type: "uint256" },
    ],
  },
] as const;

export type MarketState = 0 | 1 | 2; // Open | Resolved | Voided
export const MARKET_STATE_NAMES: Record<number, string> = {
  0: "Open",
  1: "Resolved",
  2: "Voided",
};
