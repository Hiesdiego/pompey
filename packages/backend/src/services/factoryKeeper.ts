/**
 * Factory keeper — v0.2 MarketFactory resolution backstop (spec addendum).
 *
 * MarketFactory.resolve() is permissionless: anyone may call it once a
 * market's endTime has passed and its resolution data is available, earning
 * the resolver fee (1% of staked volume). In a healthy market, bounty
 * hunters do this on their own. The keeper exists so markets NEVER get
 * stuck: every FACTORY_KEEPER_INTERVAL_MINUTES (default 15) it scans open
 * markets past their endTime and calls resolve() on any whose data is
 * available.
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
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

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

export class FactoryKeeper {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: PrivateKeyAccount;
  private readonly chain: Chain;
  private readonly queue = new TxQueue();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor() {
    this.chain = config.chainEnv === "mainnet" ? base : baseSepolia;
    const rpcUrl =
      config.chainEnv === "mainnet" ? config.baseMainnetRpcUrl : config.baseSepoliaRpcUrl;
    this.publicClient = createPublicClient({ chain: this.chain, transport: http(rpcUrl) }) as PublicClient;
    this.account = privateKeyToAccount(config.backendSignerPrivateKey as `0x${string}`);
    this.walletClient = createWalletClient({
      chain: this.chain,
      transport: http(rpcUrl),
      account: this.account,
    }) as WalletClient;
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
    });
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.resolveDueMarkets();
    } catch (err) {
      logger.error("[FactoryKeeper] tick failed", { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  private async resolveDueMarkets(): Promise<void> {
    const factory = config.contracts.marketFactory as `0x${string}` | undefined;
    if (!factory) {
      logger.warn("[FactoryKeeper] no marketFactory address configured — skipping");
      return;
    }

    const count = (await this.publicClient.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "marketCount",
    })) as bigint;
    if (count === 0n) return;

    const nowSec = Math.floor(Date.now() / 1000);
    let attempted = 0;
    let resolved = 0;

    // Scan newest-first: recent markets are the most likely to need resolution.
    for (let id = count - 1n; id >= 0n && attempted < config.factoryKeeper.maxPerPass; id--) {
      const [info, settlement] = await Promise.all([
        this.publicClient.readContract({
          address: factory,
          abi: FACTORY_ABI,
          functionName: "marketInfo",
          args: [id],
        }),
        this.publicClient.readContract({
          address: factory,
          abi: FACTORY_ABI,
          functionName: "marketSettlement",
          args: [id],
        }),
      ]) as [
        { endTime: bigint; templateId: number },
        { state: number }
      ];
      const m = { endTime: info.endTime, state: settlement.state, templateId: info.templateId };

      if (m.state !== 0) continue; // already resolved/voided
      if (Number(m.endTime) > nowSec) continue; // not yet resolvable by time
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
}
