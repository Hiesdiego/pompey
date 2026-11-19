/**
 * TICKR Stock Price Target Markets, backend configuration
 * (STOCK_MARKET_* env).
 *
 * Intended destination: packages/backend/src/stockMarketConfig.ts (new
 * file, alongside stockConfig.ts). It deliberately does NOT edit or
 * extend stockConfig.ts: the stock price target markets are step 2 of
 * the STOCK BUILD, a separate product surface from the stock league
 * (step 1), with their own factory contract and their own env names, so
 * a market-only misconfiguration must never be masked by league
 * defaults, and a league misconfiguration must never take the markets
 * down with it.
 *
 * What this file DOES reuse from the stock stack, by import:
 *   - stockConfig.backendSignerPrivateKey: the same BACKEND_SIGNER_PRIVATE_KEY
 *     signs the keeper's resolve/void transactions. Read from stockConfig
 *     (never re-read from process.env here) so the two stacks can never
 *     disagree about which signer is configured. The key is only
 *     REQUIRED when the keeper is constructed; read-only services boot
 *     without it, exactly like the league stack.
 *   - stockConfig.nav.*: the Coinbase tokenized stocks API base URL and
 *     the NAV poll cadences. The dynamic stock list and the league NAV
 *     poller read the SAME endpoint, so the list poll cadence is aligned
 *     with the NAV poller cadence by construction (hot 60s, idle 15 min),
 *     not by a second pair of env vars that could drift apart.
 *   - stockConfig.nav.lastNavFallbackMaxAgeMs / feedHealthyWithinMs /
 *     staleAfterMs: the keeper's resolve/void decision uses the league's
 *     LAST_NAV_FALLBACK bounds verbatim (see stockListService.ts,
 *     decideResolutionNav). One set of bounds, two consumers.
 *   - The stock RPC transport: createStockPublicClient() below is a thin
 *     re-export of the stock stack's fallback transport factory
 *     (createStockPublicClient in services/stockSnapshotSubmitter.ts,
 *     primary RPC plus STOCK_RPC_FALLBACK_URLS, never a single-endpoint
 *     client). This is the stock stack's pattern; the crypto lib/rpc.ts
 *     transport is NOT used by any stock market service.
 *
 * GATING (locked): everything in the stock market stack (list service,
 * reader, routes, keeper) mounts and starts ONLY when
 * STOCK_MARKET_FACTORY_ADDRESS is set. stockMarketConfigured() is the
 * single gate, mirroring stockConfigured() in stockConfig.ts. Contract
 * addresses are OPTIONAL with empty defaults: the services stay idle
 * until the StockMarketFactory is deployed.
 *
 * ASSUMED FACTORY SURFACE (the StockMarketFactory contract is being
 * built in parallel; see stockMarketReader.ts for the full ABI and the
 * flagged assumptions): fees mirror the crypto MarketFactory defaults
 * (treasury 300 bps, creator 200 bps, resolver 100 bps, applied to
 * staked volume only, seed added whole to the winners' pool). The
 * constants below exist so the API, the keeper and the docs all agree;
 * the contract is the authority and the frontend reads the same values
 * it uses for crypto markets.
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
    throw new Error(`[stockMarketConfig] Env var ${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

function optionalBigInt(name: string, fallback: string): bigint {
  const raw = optional(name, fallback);
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`[stockMarketConfig] Env var ${name} must be an integer, got: ${raw}`);
  }
}

function optionalAddress(name: string): `0x${string}` {
  const v = optional(name, "");
  if (v === "") return "" as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`[stockMarketConfig] Env var ${name} must be a 0x address, got: ${v}`);
  }
  return v as `0x${string}`;
}

export const stockMarketConfig = {
  /** StockMarketFactory address. Empty until the factory is deployed;
   *  stockMarketConfigured() gates the whole stack on this one value. */
  factoryAddress: optionalAddress("STOCK_MARKET_FACTORY_ADDRESS"),

  /** First block the StockMarketFactory exists at. Anchors any future
   *  event scan (the reader is multicall-based today, like the crypto
   *  ChainCache list read; the keeper's bounded on-chain fallback scan
   *  does not need it). 0 = unset. */
  factoryDeployBlock: optionalBigInt("STOCK_MARKET_FACTORY_DEPLOY_BLOCK", "0"),

  keeper: {
    /** Mirrors FACTORY_KEEPER_ENABLED: the keeper is a backstop, and
     *  bounty hunters who resolve for the 1% resolver fee compete with
     *  it. Disable when they are reliably covering resolutions. */
    enabled: optional("STOCK_MARKET_KEEPER_ENABLED", "true") === "true",
    /** Mirrors FACTORY_KEEPER_INTERVAL_MINUTES (default 15). */
    intervalMinutes: optionalInt("STOCK_MARKET_KEEPER_INTERVAL_MINUTES", 15),
    /** Max markets to attempt per keeper pass (gas-bounded), mirrors
     *  FACTORY_KEEPER_MAX_PER_PASS (default 10). */
    maxPerPass: optionalInt("STOCK_MARKET_KEEPER_MAX_PER_PASS", 10),
  },

  list: {
    /** Coinbase tokenized stocks API. The SAME endpoint the league NAV
     *  poller reads (stockConfig.nav.baseUrl); overridable separately
     *  only for testing, never in production. */
    baseUrl: optional("STOCK_MARKET_LIST_API_URL", stockConfig.nav.baseUrl),
    /** Tokens fetched per list page. The API caps page_size at 500 and
     *  the live list is 90 tokens (verified 2026-11-19), so one poll is
     *  normally a single request covering every stock. */
    pageSize: 500,
    /** Hot cadence, aligned with the NAV poller by construction: the
     *  same stockConfig values, so the list can never be polled faster
     *  than the league polls NAV. */
    hotPollMs: stockConfig.nav.hotPollMs,
    /** Idle cadence, aligned with the NAV poller (15 min). At idle
     *  cadence the list costs about 96 calls/day; the 1 GB/month
     *  bandwidth hard cap is never at risk from this service. */
    idlePollMs: stockConfig.nav.idlePollMs,
  },

  cache: {
    /** Reader TTLs, mirroring services/chainCache.ts EXACTLY:
     *  MARKETS_TTL_MS (10 min full list) and MARKET_TTL_MS (10s single
     *  market). The frontend market pages poll on these horizons. */
    marketsTtlMs: 10 * 60_000,
    marketTtlMs: 10_000,
  },

  /** MarketFactory fee defaults (bps of staked volume), mirrored for
   *  the API and docs. The StockMarketFactory contract is the
   *  authority; if its setFees() values ever change, these constants
   *  are display-only and the payout math on-chain is unaffected. */
  fees: {
    treasuryBps: 300,
    creatorBps: 200,
    resolverBps: 100,
  },
} as const;

export type StockMarketConfig = typeof stockMarketConfig;

/** True only when the StockMarketFactory address is configured. Until
 *  then every stock market service stays idle, exactly like
 *  stockConfigured() gates the league stack. */
export function stockMarketConfigured(): boolean {
  // Empty-string default is falsy; a configured address is truthy.
  return Boolean(stockMarketConfig.factoryAddress);
}

/**
 * RPC client reuse, following the stock stack's pattern: the fallback
 * transport factory from services/stockSnapshotSubmitter.ts (primary
 * RPC plus STOCK_RPC_FALLBACK_URLS). Every stock market read goes
 * through this client; never construct a single-endpoint client.
 */
export function createStockMarketPublicClient(): PublicClient {
  return createStockPublicClient();
}

/** The chain the stock contracts live on (stock stack's chain helper). */
export function stockMarketChain(): Chain {
  return stockChain();
}

/** Backend signer key, re-exported from the stock config so the keeper
 *  fails fast on the same value the league submitters use. Only access
 *  this when constructing the keeper. */
export function stockMarketSignerPrivateKey(): `0x${string}` {
  return stockConfig.backendSignerPrivateKey;
}
