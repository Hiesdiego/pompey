/**
 * Snapshot submitter — signs and sends backend-authorized transactions
 * (spec P2.4, reliability P4.5).
 *
 * - Owns the backend signer (BACKEND_SIGNER_PRIVATE_KEY) via viem.
 * - ALL writes go through a serialized TxQueue: concurrent matches never
 *   collide on nonces, and viem assigns each tx the next pending nonce.
 * - Idempotent by design: pre-checks on-chain state before sending, and
 *   treats "already submitted/revealed" reverts as success.
 * - Late-start recovery: if an endPrice is requested but the start snapshot
 *   was never submitted (backend was down/restarted over the start window),
 *   the start price is submitted late first instead of burning a
 *   StartNotSubmitted revert on every tick. Without this the fixture can
 *   never settle and stakers' funds lock in the pool forever.
 * - Retries transient failures (network, RPC hiccups) with backoff; contract
 *   reverts are deterministic and are NOT retried.
 * - Every submission is audit-logged with the source price data used.
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

// Minimal ABIs — only what the backend calls. The custom errors are included
// so viem can DECODE revert reasons (e.g. StartNotSubmitted(1, 0)) instead of
// logging "unable to decode signature 0xe8e0d9bb".
const PRICE_ORACLE_ABI = [
  {
    type: "function",
    name: "submitStartPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
      { name: "homePrice", type: "uint256" },
      { name: "awayPrice", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submitEndPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
      { name: "homePrice", type: "uint256" },
      { name: "awayPrice", type: "uint256" },
    ],
    outputs: [],
  },
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
  { type: "error", name: "OnlyBackendSigner", inputs: [] },
  { type: "error", name: "ResultEngineAlreadySet", inputs: [] },
  {
    type: "error",
    name: "StartAlreadySubmitted",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "EndAlreadySubmitted",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "StartNotSubmitted",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
  },
  { type: "error", name: "InvalidPrice", inputs: [] },
] as const;

const MATCH_REGISTRY_ABI = [
  {
    type: "function",
    name: "revealKickoff",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fixtureId", type: "uint256" },
      { name: "kickoffTimestamp", type: "uint64" },
    ],
    outputs: [],
  },
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
] as const;

/** Serializes async work so only one tx is in flight per signer — no nonce collisions. */
class TxQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

export interface SubmissionAudit {
  seasonId: bigint;
  fixtureId: bigint;
  kind: "startPrice" | "endPrice" | "revealKickoff";
  homeScaled?: bigint;
  awayScaled?: bigint;
  kickoffTimestamp?: bigint;
  homeSource?: string;
  awaySource?: string;
  txHash?: string;
  skipped?: boolean;
  skipReason?: string;
  /** True when a late startPrice was submitted as recovery before this endPrice. */
  recoveredLateStart?: boolean;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2_000;

/** Contract revert names that mean "already done" — safe to treat as success. */
const IDEMPOTENT_REVERTS = [
  "StartAlreadySubmitted",
  "EndAlreadySubmitted",
  "KickoffAlreadyRevealed",
];

interface SnapshotState {
  startSubmitted: boolean;
  endSubmitted: boolean;
}

export class SnapshotSubmitter {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: PrivateKeyAccount;
  private readonly chain: Chain;
  private readonly queue = new TxQueue();

  constructor() {
    this.chain = config.chainEnv === "mainnet" ? base : baseSepolia;
    const rpcUrl =
      config.chainEnv === "mainnet" ? config.baseMainnetRpcUrl : config.baseSepoliaRpcUrl;

    this.account = privateKeyToAccount(config.backendSignerPrivateKey);
    const transport = http(rpcUrl);

    this.publicClient = createPublicClient({ chain: this.chain, transport });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport,
    });

    logger.info("[SnapshotSubmitter] initialized", {
      chain: this.chain.name,
      signer: this.account.address,
      priceOracle: config.contracts.priceOracle,
      matchRegistry: config.contracts.matchRegistrySeason1,
    });
  }

  get signerAddress(): `0x${string}` {
    return this.account.address;
  }

  // ------------------------------------------------------------- kickoff reveal

  async revealKickoff(fixtureId: bigint, kickoffTimestamp: bigint): Promise<SubmissionAudit> {
    const audit: SubmissionAudit = {
      seasonId: config.seasonId,
      fixtureId,
      kind: "revealKickoff",
      kickoffTimestamp,
    };
    return this.queue.enqueue(async () => {
      // Idempotency pre-check — skip the tx if already revealed.
      const fixture = (await this.publicClient.readContract({
        address: config.contracts.matchRegistrySeason1,
        abi: MATCH_REGISTRY_ABI,
        functionName: "getFixture",
        args: [fixtureId],
      })) as { kickoffRevealed: boolean };
      if (fixture.kickoffRevealed) {
        audit.skipped = true;
        audit.skipReason = "kickoff already revealed on-chain";
        logger.info("[SnapshotSubmitter] revealKickoff skipped (already revealed)", {
          fixtureId: fixtureId.toString(),
        });
        return audit;
      }

      const txHash = await this.sendPriceTx("revealKickoff", fixtureId, kickoffTimestamp);
      if (txHash === null) {
        audit.skipped = true;
        audit.skipReason = "kickoff revealed by a concurrent call (idempotent revert)";
        logger.info("[SnapshotSubmitter] revealKickoff skipped (concurrent reveal)", {
          fixtureId: fixtureId.toString(),
        });
        return audit;
      }
      audit.txHash = txHash;
      logger.info("[SnapshotSubmitter] kickoff revealed", {
        fixtureId: fixtureId.toString(),
        kickoffTimestamp: kickoffTimestamp.toString(),
        txHash,
      });
      return audit;
    });
  }

  // ------------------------------------------------------------- price snapshots

  async submitStartPrice(
    fixtureId: bigint,
    homeScaled: bigint,
    awayScaled: bigint,
    homeSource: string,
    awaySource: string
  ): Promise<SubmissionAudit> {
    return this.submitPrice("startPrice", fixtureId, homeScaled, awayScaled, homeSource, awaySource);
  }

  async submitEndPrice(
    fixtureId: bigint,
    homeScaled: bigint,
    awayScaled: bigint,
    homeSource: string,
    awaySource: string
  ): Promise<SubmissionAudit> {
    return this.submitPrice("endPrice", fixtureId, homeScaled, awayScaled, homeSource, awaySource);
  }

  private async submitPrice(
    kind: "startPrice" | "endPrice",
    fixtureId: bigint,
    homeScaled: bigint,
    awayScaled: bigint,
    homeSource: string,
    awaySource: string
  ): Promise<SubmissionAudit> {
    const audit: SubmissionAudit = {
      seasonId: config.seasonId,
      fixtureId,
      kind,
      homeScaled,
      awayScaled,
      homeSource,
      awaySource,
    };
    return this.queue.enqueue(async () => {
      // Single on-chain read drives all the branching below.
      const snapshot = await this.getSnapshot(fixtureId);

      if (kind === "startPrice") {
        if (snapshot.startSubmitted) {
          audit.skipped = true;
          audit.skipReason = "startPrice already submitted on-chain";
          logger.info("[SnapshotSubmitter] snapshot skipped (already submitted)", {
            kind,
            fixtureId: fixtureId.toString(),
          });
          return audit;
        }
      } else {
        if (snapshot.endSubmitted) {
          audit.skipped = true;
          audit.skipReason = "endPrice already submitted on-chain";
          logger.info("[SnapshotSubmitter] snapshot skipped (already submitted)", {
            kind,
            fixtureId: fixtureId.toString(),
          });
          return audit;
        }
        if (!snapshot.startSubmitted) {
          // ---- LATE-START RECOVERY ----
          // The backend missed this fixture's start window (it was down or
          // restarting when kickoff arrived). Sending endPrice now would
          // revert with StartNotSubmitted — on this tick and every tick
          // after, forever — while stakers' funds sit locked in the pool.
          // Instead, submit the start price late using the current validated
          // prices, then proceed with the end price below. The measured move
          // is ~0 (Draw): deterministic, auditable, and strictly better than
          // locked funds. This path should essentially never trigger in
          // production; when it does it logs at ERROR so ops sees it.
          logger.error("[SnapshotSubmitter] LATE START RECOVERY — start snapshot missing, submitting start price now", {
            seasonId: config.seasonId.toString(),
            fixtureId: fixtureId.toString(),
            home: scaledToPrice(homeScaled),
            away: scaledToPrice(awayScaled),
            homeSource,
            awaySource,
          });
          const recoveryTx = await this.sendPriceTx(
            "submitStartPrice",
            fixtureId,
            undefined,
            homeScaled,
            awayScaled
          );
          if (recoveryTx === null) {
            // Lost a race with a concurrent recovery — the start is now
            // on-chain, so proceed to the end price below.
            logger.info("[SnapshotSubmitter] late startPrice won by a concurrent call, continuing", {
              fixtureId: fixtureId.toString(),
            });
          } else {
            logger.info("[SnapshotSubmitter] late startPrice submitted", {
              fixtureId: fixtureId.toString(),
              txHash: recoveryTx,
            });
          }
          audit.recoveredLateStart = true;
        }
      }

      const txHash = await this.sendPriceTx(
        kind === "startPrice" ? "submitStartPrice" : "submitEndPrice",
        fixtureId,
        undefined,
        homeScaled,
        awayScaled
      );
      if (txHash === null) {
        audit.skipped = true;
        audit.skipReason = `${kind} submitted by a concurrent call (idempotent revert)`;
        logger.info("[SnapshotSubmitter] snapshot skipped (concurrent submit)", {
          kind,
          fixtureId: fixtureId.toString(),
        });
        return audit;
      }
      audit.txHash = txHash;
      logger.info("[SnapshotSubmitter] snapshot submitted", {
        kind,
        seasonId: config.seasonId.toString(),
        fixtureId: fixtureId.toString(),
        home: scaledToPrice(homeScaled),
        away: scaledToPrice(awayScaled),
        homeSource,
        awaySource,
        txHash,
      });
      return audit;
    });
  }

  /**
   * Sends one price-oracle / registry write with retry semantics.
   * @returns the tx hash, or null when an "already done" revert arrived
   * between the pre-check and the send (safe to treat as success).
   * @throws on deterministic contract reverts and exhausted retries.
   */
  private async sendPriceTx(
    fn: "submitStartPrice" | "submitEndPrice" | "revealKickoff",
    fixtureId: bigint,
    kickoffTimestamp?: bigint,
    homeScaled?: bigint,
    awayScaled?: bigint
  ): Promise<`0x${string}` | null> {
    try {
      if (fn === "revealKickoff") {
        return await this.sendWithRetry(() =>
          this.walletClient.writeContract({
            address: config.contracts.matchRegistrySeason1,
            abi: MATCH_REGISTRY_ABI,
            functionName: "revealKickoff",
            args: [fixtureId, kickoffTimestamp as bigint],
            account: this.account,
            chain: this.chain,
          })
        );
      }
      return await this.sendWithRetry(() =>
        this.walletClient.writeContract({
          address: config.contracts.priceOracle,
          abi: PRICE_ORACLE_ABI,
          functionName: fn,
          args: [config.seasonId, fixtureId, homeScaled as bigint, awayScaled as bigint],
          account: this.account,
          chain: this.chain,
        })
      );
    } catch (err) {
      if (err instanceof IdempotentRevert) {
        logger.info("[SnapshotSubmitter] idempotent revert treated as success", {
          fn,
          fixtureId: fixtureId.toString(),
        });
        return null;
      }
      throw err;
    }
  }

  private async getSnapshot(fixtureId: bigint): Promise<SnapshotState> {
    const snapshot = (await this.publicClient.readContract({
      address: config.contracts.priceOracle,
      abi: PRICE_ORACLE_ABI,
      functionName: "getSnapshot",
      args: [config.seasonId, fixtureId],
    })) as { startSubmitted: boolean; endSubmitted: boolean };
    return {
      startSubmitted: snapshot.startSubmitted,
      endSubmitted: snapshot.endSubmitted,
    };
  }

  // ------------------------------------------------------------- resilience

  private async sendWithRetry(send: () => Promise<`0x${string}`>): Promise<`0x${string}`> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await send();
      } catch (err) {
        lastErr = err;
        const message = err instanceof Error ? err.message : String(err);
        // Idempotent reverts (race between pre-check and send) = success.
        // The caller converts this into a skipped audit entry.
        if (IDEMPOTENT_REVERTS.some((name) => message.includes(name))) {
          logger.info("[SnapshotSubmitter] idempotent revert treated as success", { message });
          throw new IdempotentRevert(message);
        }
        // Deterministic contract reverts are never retried.
        if (this.isContractRevert(message)) {
          logger.error("[SnapshotSubmitter] contract revert — NOT retrying", { message });
          throw err;
        }
        logger.warn("[SnapshotSubmitter] transient failure, retrying", {
          attempt,
          maxRetries: MAX_RETRIES,
          message,
        });
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** (attempt - 1)));
      }
    }
    throw lastErr;
  }

  private isContractRevert(message: string): boolean {
    // viem surfaces contract reverts with these markers.
    return (
      message.includes("reverted") ||
      message.includes("execution reverted") ||
      message.includes("ContractFunctionRevertedError") ||
      message.includes("ContractFunctionExecutionError")
    );
  }
}

/** Thrown when an "already done" revert arrives between pre-check and send. */
export class IdempotentRevert extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotentRevert";
  }
}
