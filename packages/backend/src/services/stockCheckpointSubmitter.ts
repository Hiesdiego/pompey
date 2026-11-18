/**
 * Stock checkpoint submitter, hourly oracle checkpoints for the stock league.
 *
 * Intended destination: packages/backend/src/services/stockCheckpointSubmitter.ts.
 * Mirrors the crypto CheckpointSubmitter (hourly slot, submitCheckpoints,
 * dedupe by hour slot in-memory + on-chain getPriceAt verification, batch
 * 20, one tx per batch, gas-bounded) with stock differences only:
 *
 *   - Stock teamIds 0-11 (STOCK_TEAMS, 12 teams), stock PriceOracle, stock season id.
 *   - Prices come from the StockPriceFeed (NAV primary). A team with no
 *     fresh NAV in an hour is SKIPPED for that hour, never checkpointed
 *     with a stale or zero price: a missing checkpoint is a gap the
 *     markets that need it cannot resolve until VOID_WINDOW, by design,
 *     so resolution is never fabricated. NOTE: the feed's 25h pricing
 *     bound means a quiet hour still checkpoints the last NAV; the
 *     last-NAV fallback (stockPriceFeed.ts) is a FULL-TIME rule only and
 *     does not change checkpointing.
 *   - Writes go through the shared fallback transport
 *     (createStockPublicClient / createStockFallbackTransport from
 *     stockSnapshotSubmitter.ts) and the same serialized TxQueue pattern
 *     as the crypto submitter.
 *   - The stock TeamRegistry is read for teamCount instead of trusting
 *     the local roster length, so a registry/roster mismatch is visible
 *     in the logs instead of silently checkpointing the wrong teams.
 */

import {
  createWalletClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { stockConfig } from "../stockConfig.js";
import { logger } from "../lib/logger.js";
import type { StockPriceFeed } from "./stockPriceFeed.js";
import {
  createStockPublicClient,
  createStockFallbackTransport,
  stockChain,
} from "./stockSnapshotSubmitter.js";
import { STOCK_TEAMS } from "./stockTeams.js";
import type { PublicClient } from "viem";

const STOCK_PRICE_ORACLE_CHECKPOINT_ABI = [
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

const STOCK_TEAM_REGISTRY_ABI = [
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
export function stockHourSlotOf(timestampMs: number): number {
  return Math.floor(timestampMs / 3_600_000);
}

export class StockCheckpointSubmitter {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: PrivateKeyAccount;
  private readonly chain: Chain;
  private readonly queue = new TxQueue();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  /** Hour slots already checkpointed this process lifetime (chain is source of truth on restart). */
  private readonly doneSlots = new Set<number>();

  constructor(private readonly feed: StockPriceFeed) {
    if (!stockConfig.backendSignerPrivateKey) {
      throw new Error(
        "[StockCheckpointSubmitter] Missing BACKEND_SIGNER_PRIVATE_KEY (see .env.example)"
      );
    }
    this.chain = stockChain();
    this.publicClient = createStockPublicClient();
    this.account = privateKeyToAccount(stockConfig.backendSignerPrivateKey);
    this.walletClient = createWalletClient({
      chain: this.chain,
      transport: createStockFallbackTransport(),
      account: this.account,
    }) as WalletClient;
  }

  start(): void {
    const intervalMs = stockConfig.checkpoints.intervalMinutes * 60 * 1000;
    logger.info("[StockCheckpointSubmitter] starting", {
      intervalMinutes: stockConfig.checkpoints.intervalMinutes,
      batchSize: stockConfig.checkpoints.batchSize,
      teams: STOCK_TEAMS.length,
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
      logger.error("[StockCheckpointSubmitter] tick failed", { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  private async submitCurrentHour(): Promise<void> {
    const now = Date.now();
    const slot = stockHourSlotOf(now);
    if (this.doneSlots.has(slot)) return;

    // Confirm on-chain: maybe a previous process already checkpointed this hour.
    const teamCount = (await this.publicClient.readContract({
      address: stockConfig.contracts.teamRegistry,
      abi: STOCK_TEAM_REGISTRY_ABI,
      functionName: "teamCount",
    })) as number;
    if (teamCount === 0) {
      logger.warn("[StockCheckpointSubmitter] empty roster, skipping");
      return;
    }
    if (teamCount !== STOCK_TEAMS.length) {
      logger.error("[StockCheckpointSubmitter] roster mismatch: registry has teamCount but local roster differs", {
        registryTeamCount: teamCount,
        localTeamCount: STOCK_TEAMS.length,
      });
    }

    const slotStartSec = BigInt(slot * 3600);
    const [found] = (await this.publicClient.readContract({
      address: stockConfig.contracts.priceOracle,
      abi: STOCK_PRICE_ORACLE_CHECKPOINT_ABI,
      functionName: "getPriceAt",
      args: [0, slotStartSec],
    })) as [boolean, bigint];
    if (found) {
      this.doneSlots.add(slot);
      logger.info("[StockCheckpointSubmitter] hour already checkpointed on-chain", { slot });
      return;
    }

    // Gather validated prices for every stock team from the feed. A team
    // with no fresh NAV is skipped for this hour, never zero-filled.
    const teamIds: number[] = [];
    const prices: bigint[] = [];
    for (let teamId = 0; teamId < teamCount; teamId++) {
      try {
        const quote = this.feed.getValidatedPrice(teamId);
        if (!quote || quote.scaled <= 0n) continue;
        teamIds.push(teamId);
        prices.push(quote.scaled);
      } catch (err) {
        logger.warn("[StockCheckpointSubmitter] no price for stock team", {
          teamId,
          error: String(err),
        });
      }
    }
    if (teamIds.length === 0) {
      logger.error("[StockCheckpointSubmitter] no stock team prices available, skipping hour", { slot });
      return;
    }

    // Batch-submit (gas-bounded, batch 20: 12 teams = 1 tx).
    const batchSize = stockConfig.checkpoints.batchSize;
    await this.queue.enqueue(async () => {
      for (let i = 0; i < teamIds.length; i += batchSize) {
        const ids = teamIds.slice(i, i + batchSize);
        const batch = prices.slice(i, i + batchSize);
        const hash = await this.walletClient.writeContract({
          address: stockConfig.contracts.priceOracle,
          abi: STOCK_PRICE_ORACLE_CHECKPOINT_ABI,
          functionName: "submitCheckpoints",
          args: [ids, batch],
          chain: this.chain,
          account: this.account,
        });
        logger.info("[StockCheckpointSubmitter] checkpoints submitted", {
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
