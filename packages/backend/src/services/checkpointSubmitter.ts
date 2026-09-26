/**
 * Checkpoint submitter — v0.2 hourly oracle checkpoints (spec addendum).
 *
 * Every CHECKPOINT_INTERVAL_MINUTES (default 60), submits one checkpoint
 * per team to PriceOracle.submitCheckpoints: the current validated price
 * for every team in the current season's roster. These checkpoints are the
 * resolution data for MarketFactory templates (TOP_GAINER, H2H, TARGET)
 * and power the transparency views ("how this resolves" panels).
 *
 * Idempotency: submitCheckpoints is idempotent within the hour on-chain
 * (re-submitting the same hour-slot is a no-op), and this service skips
 * hours already checkpointed (tracked in-memory + verified on-chain via
 * getPriceAt). A backend restart re-derives state from chain — no double
 * work, no missed hours beyond the restart gap (which the next tick fills
 * only for the current hour; historical gaps stay gaps, and markets that
 * need those checkpoints simply can't resolve until VOID_WINDOW — by
 * design, so resolution is never fabricated).
 *
 * Gas: one tx per tick, batching up to CHECKPOINT_BATCH_SIZE teams.
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
import { scaledToPrice } from "../lib/priceMath.js";
import type { PriceFeed } from "./priceFeed.js";

const PRICE_ORACLE_CHECKPOINT_ABI = [
  {
    type: "function",
    name: "submitCheckpoints",
    stateMutability: "nonpayable",
    inputs: [
      { name: "teamIds", type: "uint16[]" },
      { name: "prices", type: "uint256[]" },
    ],
    outputs: [],
  },
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
  { type: "error", name: "OnlyBackendSigner", inputs: [] },
  { type: "error", name: "ArrayLengthMismatch", inputs: [] },
  { type: "error", name: "InvalidPrice", inputs: [] },
] as const;

const SEASON_REGISTRY_ABI = [
  {
    type: "function",
    name: "currentSeasonId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTeamRegistry",
    stateMutability: "view",
    inputs: [{ name: "seasonId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

const TEAM_REGISTRY_ABI = [
  {
    type: "function",
    name: "teamCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
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

/** Floor a timestamp to its hour slot (the checkpoint slot id). */
export function hourSlotOf(timestampMs: number): number {
  return Math.floor(timestampMs / 3_600_000);
}

export class CheckpointSubmitter {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: PrivateKeyAccount;
  private readonly chain: Chain;
  private readonly queue = new TxQueue();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  /** Hour slots already checkpointed this process lifetime (chain is source of truth on restart). */
  private readonly doneSlots = new Set<number>();

  constructor(private readonly feed: PriceFeed) {
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
    const intervalMs = config.checkpoints.intervalMinutes * 60 * 1000;
    logger.info("[CheckpointSubmitter] starting", {
      intervalMinutes: config.checkpoints.intervalMinutes,
      batchSize: config.checkpoints.batchSize,
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
      await this.submitCurrentHour();
    } catch (err) {
      logger.error("[CheckpointSubmitter] tick failed", { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  private async submitCurrentHour(): Promise<void> {
    const now = Date.now();
    const slot = hourSlotOf(now);
    if (this.doneSlots.has(slot)) return;

    // Confirm on-chain: maybe a previous process already checkpointed this hour.
    const seasonId = (await this.publicClient.readContract({
      address: config.contracts.seasonRegistry,
      abi: SEASON_REGISTRY_ABI,
      functionName: "currentSeasonId",
    })) as bigint;
    if (seasonId === 0n) {
      logger.warn("[CheckpointSubmitter] no live season — skipping");
      return;
    }
    const teamRegistry = (await this.publicClient.readContract({
      address: config.contracts.seasonRegistry,
      abi: SEASON_REGISTRY_ABI,
      functionName: "getTeamRegistry",
      args: [seasonId],
    })) as `0x${string}`;
    const teamCount = (await this.publicClient.readContract({
      address: teamRegistry,
      abi: TEAM_REGISTRY_ABI,
      functionName: "teamCount",
    })) as number;
    if (teamCount === 0) {
      logger.warn("[CheckpointSubmitter] empty roster — skipping");
      return;
    }

    const slotStartSec = BigInt(slot * 3600);
    const [found] = (await this.publicClient.readContract({
      address: config.contracts.priceOracle,
      abi: PRICE_ORACLE_CHECKPOINT_ABI,
      functionName: "getPriceAt",
      args: [0, slotStartSec],
    })) as [boolean, bigint];
    if (found) {
      this.doneSlots.add(slot);
      logger.info("[CheckpointSubmitter] hour already checkpointed on-chain", { slot });
      return;
    }

    // Gather validated prices for every team from the feed.
    const teamIds: number[] = [];
    const prices: bigint[] = [];
    for (let teamId = 0; teamId < teamCount; teamId++) {
      try {
        const quote = await this.feed.getPrice(teamId);
        if (!quote || !quote.price) continue;
        const scaled = scaledToPrice(quote.price);
        if (scaled <= 0n) continue;
        teamIds.push(teamId);
        prices.push(scaled);
      } catch (err) {
        logger.warn("[CheckpointSubmitter] no price for team", {
          teamId,
          error: String(err),
        });
      }
    }
    if (teamIds.length === 0) {
      logger.error("[CheckpointSubmitter] no team prices available — skipping hour", { slot });
      return;
    }

    // Batch-submit (gas-bounded).
    const batchSize = config.checkpoints.batchSize;
    await this.queue.enqueue(async () => {
      for (let i = 0; i < teamIds.length; i += batchSize) {
        const ids = teamIds.slice(i, i + batchSize);
        const batch = prices.slice(i, i + batchSize);
        const hash = await this.walletClient.writeContract({
          address: config.contracts.priceOracle,
          abi: PRICE_ORACLE_CHECKPOINT_ABI,
          functionName: "submitCheckpoints",
          args: [ids, batch],
          chain: this.chain,
          account: this.account,
        });
        logger.info("[CheckpointSubmitter] checkpoints submitted", {
          slot,
          teams: ids.length,
          txHash: hash,
        });
      }
    });

    this.doneSlots.add(slot);
    // Bound memory: keep only the last 48 slots.
    if (this.doneSlots.size > 48) {
      const sorted = [...this.doneSlots].sort((a, b) => a - b);
      for (const s of sorted.slice(0, sorted.length - 48)) this.doneSlots.delete(s);
    }
  }
}
