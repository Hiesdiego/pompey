/**
 * TICKR Stock Meme Arena, backend configuration (ARENA_* env).
 *
 * Intended destination: packages/backend/src/arenaConfig.ts (new file,
 * alongside stockConfig.ts and stockMarketConfig.ts). It deliberately
 * does NOT edit or extend either of those files: the Arena is step 3
 * of the STOCK BUILD, a separate product surface from the stock league
 * (step 1) and the stock price target markets (step 2), with its own
 * factory contract and its own env names, so an Arena misconfiguration
 * must never be masked by league or market defaults, and an Arena
 * misconfiguration must never take the league or the markets down.
 *
 * What this file DOES reuse from the stock stack, by import, exactly
 * like stockMarketConfig.ts does:
 *   - stockConfig.backendSignerPrivateKey: the same
 *     BACKEND_SIGNER_PRIVATE_KEY signs the keeper's createClash,
 *     resolve, resolveCupTie and voidClash transactions. Read from
 *     stockConfig (never re-read from process.env here) so the stacks
 *     can never disagree about which signer is configured. The key is
 *     only REQUIRED when a writing service is constructed; read-only
 *     services boot without it, exactly like the league stack.
 *   - The stock RPC transport: createArenaPublicClient() below is a
 *     thin re-export of the stock stack's fallback transport factory
 *     (createStockPublicClient in services/stockSnapshotSubmitter.ts,
 *     primary RPC plus STOCK_RPC_FALLBACK_URLS, never a single-endpoint
 *     client). This is the stock stack's pattern; the crypto lib/rpc.ts
 *     transport is NOT used by any Arena service.
 *
 * GATING (locked): everything in the Arena stack (registry service,
 * reader, routes, keeper, cup service, commentary) mounts and starts
 * ONLY when ARENA_CLASH_FACTORY_ADDRESS is set. arenaConfigured() is
 * the single gate, mirroring stockMarketConfigured() in
 * stockMarketConfig.ts. Contract addresses are OPTIONAL with empty
 * defaults: the services stay idle until the MemeClashFactory is
 * deployed.
 *
 * LOCKED ARENA RULES mirrored here so the API, the keeper, the cup
 * service and the docs all agree (the MemeClashFactory contract is the
 * authority; these constants are display and decision aids):
 *   - A clash window starts 1 hour after creation (the staking window)
 *     and runs 24 hours (standard) or 1 hour (blitz).
 *   - Yes wins only on a strictly greater percent move; an exact tie
 *     is No for open clashes and reverts for cup ties (the keeper then
 *     applies the cup tiebreak and calls resolveCupTie).
 *   - A raw move of |30 percent| or more on either side inside the
 *     window trips the breaker and voids the clash on-chain.
 *   - Fees mirror the stock market factory: treasury 300 bps, creator
 *     200 bps, resolver 100 bps, applied to staked volume only; the
 *     250 TICK seed is added whole to the winners' pool.
 *   - Creation requires liquidity at or above the floor (default
 *     5,000 USD) and a live price, enforced off-chain by the registry
 *     service (creationEnabled) and by the keeper's debut loop.
 */

import { stockConfig } from "./stockConfig.js";
import {
  createStockPublicClient,
  stockChain,
} from "./services/stockSnapshotSubmitter.js";
import type { PublicClient } from "viem";
import type { Chain } from "viem";

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = optional(name, String(fallback));
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`[arenaConfig] Env var ${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = optional(name, String(fallback));
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`[arenaConfig] Env var ${name} must be a non-negative number, got: ${raw}`);
  }
  return n;
}

function optionalBigInt(name: string, fallback: string): bigint {
  const raw = optional(name, fallback);
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`[arenaConfig] Env var ${name} must be an integer, got: ${raw}`);
  }
}

function optionalAddress(name: string): `0x${string}` {
  const v = optional(name, "");
  if (v === "") return "" as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`[arenaConfig] Env var ${name} must be a 0x address, got: ${v}`);
  }
  return v as `0x${string}`;
}

export const arenaConfig = {
  /** MemeClashFactory address. Empty until the factory is deployed;
   *  arenaConfigured() gates the whole stack on this one value. */
  factoryAddress: optionalAddress("ARENA_CLASH_FACTORY_ADDRESS"),

  /** First block the MemeClashFactory exists at. Anchors any future
   *  event scan (the reader is multicall-based today, like the stock
   *  market reader). 0 = unset. */
  factoryDeployBlock: optionalBigInt("ARENA_CLASH_FACTORY_DEPLOY_BLOCK", "0"),

  basestonk: {
    /** BaseStonk REST API base. Open, free, no key (verified live
     *  2026-11-20). The machine surface lives under /api/v1; the
     *  registry service appends /api/v1/launchpad/tokens and
     *  /api/v1/launchpad/pair-identity/{chain}/{address}. */
    baseUrl: optional("ARENA_BASESTONK_API_URL", "https://api.basestonk.io"),
    /** Chain slug the launchpad is polled for. BaseStonk launches are
     *  Base-only today; the parameter exists so a second chain never
     *  needs a code change. */
    chain: optional("ARENA_BASESTONK_CHAIN", "base"),
  },

  registry: {
    /** Registry poll cadence in minutes (default 15). One poll is
     *  three small list requests (newest, volume, trending) against a
     *  shared lane rated at 1,500 units per 5 minutes, so 15 minutes
     *  is far inside the limit and inside the 1 GB/month bandwidth
     *  hard cap. */
    pollMinutes: optionalInt("ARENA_REGISTRY_POLL_MINUTES", 15),
    /** Tokens fetched per registry page. The newest page doubles as
     *  the launch detector, so it must be wide enough that a burst of
     *  launches between polls is never missed. */
    pageSize: 50,
    /** A token created within this long before boot is treated as NEW
     *  at boot (not marked seen), so a restart inside the launch
     *  window still gives the token its debut clash. */
    bootNewWindowMs: 2 * 60 * 60_000,
  },

  creation: {
    /** Liquidity floor in USD (default 5,000). A meme below the floor
     *  cannot be clashed: the registry marks it creationEnabled false
     *  and the keeper's debut loop skips it. */
    minLiquidityUsd: optionalNumber("ARENA_MIN_LIQUIDITY_USD", 5_000),
  },

  keeper: {
    /** Mirrors STOCK_MARKET_KEEPER_ENABLED: disable when resolutions
     *  are reliably covered another way. */
    enabled: optional("ARENA_KEEPER_ENABLED", "true") === "true",
    /** Mirrors STOCK_MARKET_KEEPER_INTERVAL_MINUTES (default 15). */
    intervalMinutes: optionalInt("ARENA_KEEPER_INTERVAL_MINUTES", 15),
    /** Max clashes to attempt per keeper pass (gas-bounded), mirrors
     *  STOCK_MARKET_KEEPER_MAX_PER_PASS (default 10). */
    maxPerPass: optionalInt("ARENA_KEEPER_MAX_PER_PASS", 10),
  },

  cache: {
    /** Reader TTLs, mirroring stockMarketConfig.cache EXACTLY (which
     *  copies services/chainCache.ts): 10 min full list, 10s single
     *  clash. The frontend arena pages poll on these horizons. */
    clashesTtlMs: 10 * 60_000,
    clashTtlMs: 10_000,
  },

  /** Locked clash timing (seconds). The factory enforces these; the
   *  constants exist so the API, the keeper and the docs agree. */
  windows: {
    /** Window starts this long after creation; staking closes at the
     *  window start. */
    leadSeconds: 3_600,
    /** Standard clash duration (24h). */
    standardSeconds: 86_400,
    /** Blitz clash duration (1h). */
    blitzSeconds: 3_600,
  },

  /** Breaker bound (percent): a raw move at or beyond this on either
   *  side voids the clash on-chain. Mirrored for the keeper's local
   *  precompute and for display. */
  breakerPct: 30,

  /** MemeClashFactory fee defaults (bps of staked volume), mirrored
   *  for the API and docs. The contract is the authority; if its
   *  setFees() values ever change, these constants are display-only
   *  and the payout math on-chain is unaffected. */
  fees: {
    treasuryBps: 300,
    creatorBps: 200,
    resolverBps: 100,
  },

  /** Factory seed per clash (TICK wei), mirrored for multiplier math
   *  in the reader. The contract is the authority. */
  seedAmount: 250n * 10n ** 18n,
} as const;

export type ArenaConfig = typeof arenaConfig;

/** True only when the MemeClashFactory address is configured. Until
 *  then every Arena service stays idle, exactly like
 *  stockMarketConfigured() gates the stock market stack. */
export function arenaConfigured(): boolean {
  // Empty-string default is falsy; a configured address is truthy.
  return Boolean(arenaConfig.factoryAddress);
}

/**
 * RPC client reuse, following the stock stack's pattern: the fallback
 * transport factory from services/stockSnapshotSubmitter.ts (primary
 * RPC plus STOCK_RPC_FALLBACK_URLS). Every Arena read goes through
 * this client; never construct a single-endpoint client.
 */
export function createArenaPublicClient(): PublicClient {
  return createStockPublicClient();
}

/** The chain the Arena contracts live on (stock stack's chain helper). */
export function arenaChain(): Chain {
  return stockChain();
}

/** Backend signer key, re-exported from the stock config so the keeper
 *  and the cup service fail fast on the same value the league
 *  submitters use. Only access this when constructing a writer. */
export function arenaSignerPrivateKey(): `0x${string}` {
  return stockConfig.backendSignerPrivateKey;
}
