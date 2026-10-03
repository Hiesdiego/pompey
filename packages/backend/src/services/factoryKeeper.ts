/**
 * Factory keeper — v0.2 MarketFactory resolution backstop (spec addendum).
 *
 * MarketFactory.resolve() is permissionless: anyone may call it once a
 * market's endTime has passed and its resolution data is available, earning
 * the resolver fee (1% of staked volume). In a healthy market, bounty
 * hunters do this on their own. The keeper exists so markets NEVER get
 * stuck: every FACTORY_KEEPER_INTERVAL_MINUTES (default 15) it resolves
 * open markets past their endTime whose data is available.
 *
 * The keeper is deliberately conservative:
 * - It never calls resolve() before endTime.
 * - It never calls voidMarket() — voiding is a user/bounty-hunter action
 *   after the 7-day void window; the keeper only resolves.
 * - Failed resolutions (data not yet available) are skipped silently and
 *   retried next pass — the contract reverts NotResolvableYet, which is
 *   expected, not an error.
 * - Gas-bounded: at most FACTORY_KEEPER_MAX_PER_PASS markets per pass.
 *
 * Disable with FACTORY_KEEPER_ENABLED=false if bounty hunters are reliably
 * covering resolutions (the keeper would just be spending gas to compete
 * with them).
 *
 * Optimization pass changes:
 * - Candidates come from the Supabase `markets` index (state=open AND
 *   end_time passed) instead of scanning ALL markets on-chain newest-first
 *   (2 RPC calls per market, unbounded as the market count grows). Falls
 *   back to a bounded on-chain scan of the newest 50 markets when Supabase
 *   is not configured.
 * - Reads/writes go through the shared resilient transport (lib/rpc.ts).
 * - The pass runs on lib/loop.ts (non-overlapping, backoff on failure).
 */

import {
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { publicClient, createBackendWalletClient, withRpcRetry, tickrChain } from "../lib/rpc.js";
import {
  normalizeMarketInfoResult,
  normalizeMarketSettlementResult,
} from "./chainCache.js";
import { runLoop, type LoopHandle } from "../lib/loop.js";
import { getSocialChainId } from "../lib/socialChain.js";

const FACTORY_ABI = [
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
    name: "resolve",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
  { type: "error", name: "AlreadySettled", inputs: [{ name: "marketId", type: "uint256" }] },
  { type: "error", name: "NotResolvableYet", inputs: [{ name: "marketId", type: "uint256" }] },
] as const;

/** Serializes async work so only one tx is in flight per signer. */
class TxQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

/** Max markets the on-chain fallback scan inspects per pass (bounded). */
const FALLBACK_SCAN_LIMIT = 50n;

export class FactoryKeeper {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: PrivateKeyAccount;
  private readonly chain: Chain;
  private readonly queue = new TxQueue();
  private loop: LoopHandle | null = null;

  constructor(private readonly db: SupabaseClient | null) {
    this.chain = tickrChain();
    this.publicClient = publicClient;
    this.account = privateKeyToAccount(config.backendSignerPrivateKey as `0x${string}`);
    this.walletClient = createBackendWalletClient(this.account);
  }

  start(): void {
    if (!config.factoryKeeper.enabled) {
      logger.info("[FactoryKeeper] disabled via FACTORY_KEEPER_ENABLED=false");
      return;
    }
    const intervalMs = config.factoryKeeper.intervalMinutes * 60 * 1000;
    logger.info("[FactoryKeeper] starting", {
      intervalMinutes: config.factoryKeeper.intervalMinutes,
      maxPerPass: config.factoryKeeper.maxPerPass,
      candidateSource: this.db ? "supabase" : "on-chain-fallback",
    });
    this.loop = runLoop("factory-keeper", intervalMs, () => this.resolveDueMarkets());
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }

  private async resolveDueMarkets(): Promise<void> {
    const factory = config.contracts.marketFactory as `0x${string}` | undefined;
    if (!factory) {
      logger.warn("[FactoryKeeper] no marketFactory address configured — skipping");
      return;
    }

    // Candidate market ids: prefer the Supabase index (cheap), fall back to
    // a bounded on-chain scan of the newest markets.
    const candidates = this.db
      ? await this.candidatesFromIndex()
      : await this.candidatesFromChain(factory);
    if (candidates.length === 0) return;

    const nowSec = Math.floor(Date.now() / 1000);
    let attempted = 0;
    let resolved = 0;

    for (const id of candidates) {
      if (attempted >= config.factoryKeeper.maxPerPass) break;
      const m = await this.readMarketState(factory, id);
      if (!m) continue;
      if (m.state !== 0) continue; // already resolved/voided
      if (m.endTime > nowSec) continue; // not yet resolvable by time
      // SPREAD markets resolve off the fixture's endPrice, which lands before
      // the window-based endTime — the time gate above already passed, so
      // they're eligible; the contract enforces data availability.

      attempted++;
      try {
        const hash = await this.queue.enqueue(() =>
          this.walletClient.writeContract({
            address: factory,
            abi: FACTORY_ABI,
            functionName: "resolve",
            args: [id],
            chain: this.chain,
            account: this.account,
          })
        );
        resolved++;
        logger.info("[FactoryKeeper] market resolved", {
          marketId: id.toString(),
          templateId: m.templateId,
          txHash: hash,
        });
      } catch (err) {
        // NotResolvableYet = data not on-chain yet; expected, retry next pass.
        const msg = String(err);
        if (!msg.includes("NotResolvableYet")) {
          logger.error("[FactoryKeeper] resolve failed", {
            marketId: id.toString(),
            error: msg,
          });
        }
      }
    }

    if (attempted > 0) {
      logger.info("[FactoryKeeper] pass complete", { attempted, resolved });
    }
  }

  /**
   * Candidates from the Supabase `markets` index the social indexer
   * maintains: open markets whose end_time has passed. One cheap DB query
   * instead of 2 RPC calls per market.
   */
  private async candidatesFromIndex(): Promise<bigint[]> {
    const { data, error } = await this.db!
      .from("markets")
      .select("market_id")
      .eq("chain_id", getSocialChainId())
      .eq("state", "open")
      .lt("end_time", new Date().toISOString())
      .order("end_time", { ascending: true })
      .limit(config.factoryKeeper.maxPerPass * 2);
    if (error) {
      logger.warn("[FactoryKeeper] index query failed — falling back to on-chain scan", {
        error: error.message,
      });
      return this.candidatesFromChain(config.contracts.marketFactory);
    }
    return ((data ?? []) as Array<{ market_id: string }>).map((r) => BigInt(r.market_id));
  }

  /**
   * Bounded on-chain fallback: the newest FALLBACK_SCAN_LIMIT markets.
   * Used only when Supabase is not configured (or its query failed).
   */
  private async candidatesFromChain(factory: `0x${string}`): Promise<bigint[]> {
    const count = (await withRpcRetry("keeper:marketCount", () =>
      this.publicClient.readContract({
        address: factory,
        abi: FACTORY_ABI,
        functionName: "marketCount",
      })
    )) as bigint;
    if (count === 0n) return [];
    const start = count > FALLBACK_SCAN_LIMIT ? count - FALLBACK_SCAN_LIMIT : 0n;
    const ids: bigint[] = [];
    for (let id = count - 1n; id >= start; id--) ids.push(id); // newest-first
    return ids;
  }

  /** One multicall for marketInfo + marketSettlement (was 2 calls). */
  private async readMarketState(
    factory: `0x${string}`,
    id: bigint
  ): Promise<{ endTime: number; state: number; templateId: number } | null> {
    try {
      const [infoRaw, settlementRaw] = (await withRpcRetry(`keeper:readMarket(${id})`, () =>
        this.publicClient.multicall({
          contracts: [
            { address: factory, abi: FACTORY_ABI, functionName: "marketInfo", args: [id] },
            { address: factory, abi: FACTORY_ABI, functionName: "marketSettlement", args: [id] },
          ],
          allowFailure: false,
        })
      )) as unknown as [unknown, unknown];
      const info = normalizeMarketInfoResult(infoRaw);
      const settlement = normalizeMarketSettlementResult(settlementRaw);
      return {
        endTime: Number(info.endTime),
        state: Number(settlement.state),
        templateId: Number(info.templateId),
      };
    } catch (err) {
      logger.warn("[FactoryKeeper] market read failed", {
        marketId: id.toString(),
        error: String(err),
      });
      return null;
    }
  }
}
