/**
 * Stock snapshot submitter, signs and sends backend-authorized stock
 * transactions.
 *
 * Intended destination: packages/backend/src/services/stockSnapshotSubmitter.ts.
 * Mirrors the crypto SnapshotSubmitter (serialized TxQueue, idempotency
 * pre-checks, late-start recovery, retry only transient failures, audit
 * logs) with three stock differences:
 *
 *   1. FALLBACK TRANSPORT. The repo has no shared lib/rpc.ts fallback
 *      transport, so the factory lives here and is exported for reuse by
 *      stockReadClient.ts and stockCheckpointSubmitter.ts: viem
 *      fallback() over the primary RPC plus STOCK_RPC_FALLBACK_URLS.
 *      Never a single-endpoint client for stock writes or reads.
 *   2. FORFEIT. recordForfeit() calls the stock ResultEngine's
 *      recordForfeit(seasonId, fixtureId, forfeitingTeamId). A forfeit is
 *      NEVER recorded as a normal 3-0 via submitEndPrice: the scoreline,
 *      the table, and the pool settlement must all know it was a forfeit.
 *      The lifecycle decides the forfeit; this file only executes it,
 *      with the same idempotency pre-checks as every other write.
 *   3. VOID. voidFixture() calls recordVoid(seasonId, fixtureId) when
 *      BOTH teams had no performance: the fixture is void and stakes are
 *      refunded 1:1 by the pool (treasury rule does not apply to a void).
 *
 * The ResultEngine ABI below matches the stock contract source (verified
 * against packages/contracts/contracts/StockResultEngine.sol on the
 * tickr-stock branch: recordForfeit / recordVoid, ResultAlreadyRecorded,
 * OnlyBackend). Reverts for a previously recorded result are treated
 * idempotently; all other failures remain visible and the fixture is
 * flagged for manual review.
 *
 * 12-TEAM REVISION (2026-11-18): the old 22-team StockMatchRegistry
 * (fixtureCount 231) cannot be reused. These ABIs are used only against
 * the FRESH stock contracts whose addresses come from STOCK_* env vars
 * (see stockConfig.ts). The MatchRegistry getFixture ABI includes voided,
 * matching stockMatchLifecycle.ts (Nov 17 fix).
 *
 * Late-start recovery: if an endPrice is requested but the start
 * snapshot was never submitted (backend was down over the start window),
 * the start price is submitted late first, exactly like crypto. This
 * path must NOT be used to paper over a forfeit: the lifecycle checks
 * forfeit BEFORE calling submitEndPrice, so by the time this file sees
 * an endPrice both teams have performed.
 */

import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Transport,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { stockConfig } from "../stockConfig.js";
import { logger } from "../lib/logger.js";
import { scaledToPrice } from "../lib/priceMath.js";

// Minimal ABIs, only what the backend calls. Custom errors are included
// so viem can DECODE revert reasons instead of logging raw selectors.
const STOCK_PRICE_ORACLE_ABI = [
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

const STOCK_MATCH_REGISTRY_ABI = [
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
          { name: "voided", type: "bool" },
          { name: "matchEndTimestamp", type: "uint64" },
        ],
      },
    ],
  },
] as const;

/**
 * Stock ResultEngine forfeit and void entry points.
 */
const STOCK_RESULT_ENGINE_ABI = [
  {
    type: "function",
    name: "recordForfeit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
      { name: "forfeitingTeamId", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "recordVoid",
    stateMutability: "nonpayable",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "error",
    name: "ResultAlreadyRecorded",
    inputs: [
      { name: "seasonId", type: "uint256" },
      { name: "fixtureId", type: "uint256" },
    ],
  },
  { type: "error", name: "OnlyBackend", inputs: [] },
] as const;

/** Serializes async work so only one tx is in flight per signer, no nonce collisions. */
class TxQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

export interface StockSubmissionAudit {
  seasonId: bigint;
  fixtureId: bigint;
  kind: "startPrice" | "endPrice" | "revealKickoff" | "forfeit" | "void";
  homeScaled?: bigint;
  awayScaled?: bigint;
  kickoffTimestamp?: bigint;
  forfeitingTeamId?: number;
  homeSource?: string;
  awaySource?: string;
  txHash?: string;
  skipped?: boolean;
  skipReason?: string;
  /** True when a late startPrice was submitted as recovery before this endPrice. */
  recoveredLateStart?: boolean;
  /** True per side when the end price came from the last-NAV fallback
   *  (healthy feed, quiet window, last NAV within 24h). Surfaced in the
   *  submit log so a fallback settlement is auditable on-chain and off. */
  lastNavFallback?: { home: boolean; away: boolean };
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2_000;

/** Contract revert names that mean "already done", safe to treat as success. */
const IDEMPOTENT_REVERTS = [
  "StartAlreadySubmitted",
  "EndAlreadySubmitted",
  "KickoffAlreadyRevealed",
  "ResultAlreadyRecorded",
];

interface SnapshotState {
  startSubmitted: boolean;
  endSubmitted: boolean;
}

/**
 * Fallback RPC transport for ALL stock backend clients (writes and
 * reads). Primary RPC first, then STOCK_RPC_FALLBACK_URLS in order.
 * viem's fallback() tries the next transport only on failure, so the
 * happy path costs exactly one RPC call. Exported for reuse: the repo
 * has no shared lib/rpc.ts, so this is the stock stack's single
 * transport factory until the repo gains one.
 */
export function createStockFallbackTransport(): Transport {
  const primary =
    stockConfig.chainEnv === "mainnet"
      ? stockConfig.baseMainnetRpcUrl
      : stockConfig.baseSepoliaRpcUrl;
  const urls = [primary, ...stockConfig.rpcFallbackUrls];
  return fallback(urls.map((url) => http(url)));
}

export function stockChain(): Chain {
  return stockConfig.chainEnv === "mainnet" ? base : baseSepolia;
}

export function createStockPublicClient(): PublicClient {
  return createPublicClient({
    chain: stockChain(),
    transport: createStockFallbackTransport(),
  }) as PublicClient;
}

export class StockSnapshotSubmitter {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: PrivateKeyAccount;
  private readonly chain: Chain;
  private readonly queue = new TxQueue();

  constructor() {
    if (!stockConfig.backendSignerPrivateKey) {
      throw new Error(
        "[StockSnapshotSubmitter] Missing BACKEND_SIGNER_PRIVATE_KEY (see .env.example)"
      );
    }
    this.chain = stockChain();
    const transport = createStockFallbackTransport();
    this.account = privateKeyToAccount(stockConfig.backendSignerPrivateKey);
    this.publicClient = createPublicClient({ chain: this.chain, transport });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport,
    });

    logger.info("[StockSnapshotSubmitter] initialized", {
      chain: this.chain.name,
      signer: this.account.address,
      priceOracle: stockConfig.contracts.priceOracle,
      matchRegistry: stockConfig.contracts.matchRegistry,
      resultEngine: stockConfig.contracts.resultEngine,
    });
  }

  get signerAddress(): `0x${string}` {
    return this.account.address;
  }

  // ------------------------------------------------------------- kickoff reveal

  async revealKickoff(fixtureId: bigint, kickoffTimestamp: bigint): Promise<StockSubmissionAudit> {
    const audit: StockSubmissionAudit = {
      seasonId: stockConfig.seasonId,
      fixtureId,
      kind: "revealKickoff",
      kickoffTimestamp,
    };
    return this.queue.enqueue(async () => {
      const fixture = (await this.publicClient.readContract({
        address: stockConfig.contracts.matchRegistry,
        abi: STOCK_MATCH_REGISTRY_ABI,
        functionName: "getFixture",
        args: [fixtureId],
      })) as { kickoffRevealed: boolean };
      if (fixture.kickoffRevealed) {
        audit.skipped = true;
        audit.skipReason = "kickoff already revealed on-chain";
        logger.info("[StockSnapshotSubmitter] revealKickoff skipped (already revealed)", {
          fixtureId: fixtureId.toString(),
        });
        return audit;
      }

      const txHash = await this.sendTx("revealKickoff", fixtureId, kickoffTimestamp);
      if (txHash === null) {
        audit.skipped = true;
        audit.skipReason = "kickoff revealed by a concurrent call (idempotent revert)";
        return audit;
      }
      audit.txHash = txHash;
      logger.info("[StockSnapshotSubmitter] kickoff revealed", {
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
  ): Promise<StockSubmissionAudit> {
    return this.submitPrice("startPrice", fixtureId, homeScaled, awayScaled, homeSource, awaySource);
  }

  async submitEndPrice(
    fixtureId: bigint,
    homeScaled: bigint,
    awayScaled: bigint,
    homeSource: string,
    awaySource: string,
    opts: { lastNavFallback?: { home: boolean; away: boolean } } = {}
  ): Promise<StockSubmissionAudit> {
    return this.submitPrice("endPrice", fixtureId, homeScaled, awayScaled, homeSource, awaySource, opts.lastNavFallback);
  }

  private async submitPrice(
    kind: "startPrice" | "endPrice",
    fixtureId: bigint,
    homeScaled: bigint,
    awayScaled: bigint,
    homeSource: string,
    awaySource: string,
    lastNavFallback?: { home: boolean; away: boolean }
  ): Promise<StockSubmissionAudit> {
    const audit: StockSubmissionAudit = {
      seasonId: stockConfig.seasonId,
      fixtureId,
      kind,
      homeScaled,
      awayScaled,
      homeSource,
      awaySource,
      lastNavFallback,
    };
    return this.queue.enqueue(async () => {
      const snapshot = await this.getSnapshot(fixtureId);

      if (kind === "startPrice") {
        if (snapshot.startSubmitted) {
          audit.skipped = true;
          audit.skipReason = "startPrice already submitted on-chain";
          logger.info("[StockSnapshotSubmitter] snapshot skipped (already submitted)", {
            kind,
            fixtureId: fixtureId.toString(),
          });
          return audit;
        }
      } else {
        if (snapshot.endSubmitted) {
          audit.skipped = true;
          audit.skipReason = "endPrice already submitted on-chain";
          logger.info("[StockSnapshotSubmitter] snapshot skipped (already submitted)", {
            kind,
            fixtureId: fixtureId.toString(),
          });
          return audit;
        }
        if (!snapshot.startSubmitted) {
          // LATE-START RECOVERY (same as crypto). The backend missed the
          // start window. Submitting the start price late with the current
          // validated prices measures a ~0 move (Draw): deterministic,
          // auditable, and strictly better than locked funds. This runs
          // ONLY when the lifecycle has already ruled out a forfeit.
          logger.error("[StockSnapshotSubmitter] LATE START RECOVERY, start snapshot missing, submitting start price now", {
            seasonId: stockConfig.seasonId.toString(),
            fixtureId: fixtureId.toString(),
            home: scaledToPrice(homeScaled),
            away: scaledToPrice(awayScaled),
            homeSource,
            awaySource,
          });
          const recoveryTx = await this.sendTx(
            "submitStartPrice",
            fixtureId,
            undefined,
            homeScaled,
            awayScaled
          );
          if (recoveryTx === null) {
            logger.info("[StockSnapshotSubmitter] late startPrice won by a concurrent call, continuing", {
              fixtureId: fixtureId.toString(),
            });
          } else {
            logger.info("[StockSnapshotSubmitter] late startPrice submitted", {
              fixtureId: fixtureId.toString(),
              txHash: recoveryTx,
            });
          }
          audit.recoveredLateStart = true;
        }
      }

      const txHash = await this.sendTx(
        kind === "startPrice" ? "submitStartPrice" : "submitEndPrice",
        fixtureId,
        undefined,
        homeScaled,
        awayScaled
      );
      if (txHash === null) {
        audit.skipped = true;
        audit.skipReason = `${kind} submitted by a concurrent call (idempotent revert)`;
        logger.info("[StockSnapshotSubmitter] snapshot skipped (concurrent submit)", {
          kind,
          fixtureId: fixtureId.toString(),
        });
        return audit;
      }
      audit.txHash = txHash;
      logger.info("[StockSnapshotSubmitter] snapshot submitted", {
        kind,
        seasonId: stockConfig.seasonId.toString(),
        fixtureId: fixtureId.toString(),
        home: scaledToPrice(homeScaled),
        away: scaledToPrice(awayScaled),
        homeSource,
        awaySource,
        lastNavFallback: lastNavFallback ?? null,
        txHash,
      });
      return audit;
    });
  }

  // ------------------------------------------------------------- forfeit / void

  /**
   * Record a forfeit: `forfeitingTeamId` had no performance for the match
   * period, so the opponent wins 3-0 and the result is marked FORFEIT.
   * This is the ONLY way a 3-0 forfeit reaches the chain: never via
   * submitEndPrice, which would hide the forfeit as a normal result.
   * Idempotency pre-check: a settled fixture is skipped (the forfeit, or
   * a normal result, is already on-chain).
   */
  async recordForfeit(fixtureId: bigint, forfeitingTeamId: number): Promise<StockSubmissionAudit> {
    const audit: StockSubmissionAudit = {
      seasonId: stockConfig.seasonId,
      fixtureId,
      kind: "forfeit",
      forfeitingTeamId,
    };
    return this.queue.enqueue(async () => {
      const fixture = (await this.publicClient.readContract({
        address: stockConfig.contracts.matchRegistry,
        abi: STOCK_MATCH_REGISTRY_ABI,
        functionName: "getFixture",
        args: [fixtureId],
      })) as { settled: boolean };
      if (fixture.settled) {
        audit.skipped = true;
        audit.skipReason = "fixture already settled on-chain";
        logger.info("[StockSnapshotSubmitter] forfeit skipped (already settled)", {
          fixtureId: fixtureId.toString(),
        });
        return audit;
      }
      const txHash = await this.sendTx("recordForfeit", fixtureId, undefined, undefined, undefined, forfeitingTeamId);
      if (txHash === null) {
        audit.skipped = true;
        audit.skipReason = "forfeit recorded by a concurrent call (idempotent revert)";
        return audit;
      }
      audit.txHash = txHash;
      logger.info("[StockSnapshotSubmitter] FORFEIT recorded (0-3)", {
        fixtureId: fixtureId.toString(),
        forfeitingTeamId,
        txHash,
      });
      return audit;
    });
  }

  /**
   * Void a fixture: BOTH teams had no performance, so there is no result
   * and stakes are refunded 1:1 by the pool. The treasury rule does not
   * apply to a void. Same idempotency pre-check as recordForfeit.
   */
  async voidFixture(fixtureId: bigint): Promise<StockSubmissionAudit> {
    const audit: StockSubmissionAudit = {
      seasonId: stockConfig.seasonId,
      fixtureId,
      kind: "void",
    };
    return this.queue.enqueue(async () => {
      const fixture = (await this.publicClient.readContract({
        address: stockConfig.contracts.matchRegistry,
        abi: STOCK_MATCH_REGISTRY_ABI,
        functionName: "getFixture",
        args: [fixtureId],
      })) as { settled: boolean };
      if (fixture.settled) {
        audit.skipped = true;
        audit.skipReason = "fixture already settled on-chain";
        logger.info("[StockSnapshotSubmitter] void skipped (already settled)", {
          fixtureId: fixtureId.toString(),
        });
        return audit;
      }
      const txHash = await this.sendTx("recordVoid", fixtureId);
      if (txHash === null) {
        audit.skipped = true;
        audit.skipReason = "void recorded by a concurrent call (idempotent revert)";
        return audit;
      }
      audit.txHash = txHash;
      logger.info("[StockSnapshotSubmitter] fixture VOIDED (stakes refunded 1:1)", {
        fixtureId: fixtureId.toString(),
        txHash,
      });
      return audit;
    });
  }

  /**
   * Sends one stock write with retry semantics.
   * @returns the tx hash, or null when an "already done" revert arrived
   * between the pre-check and the send (safe to treat as success).
   * @throws on deterministic contract reverts and exhausted retries.
   */
  private async sendTx(
    fn: "submitStartPrice" | "submitEndPrice" | "revealKickoff" | "recordForfeit" | "recordVoid",
    fixtureId: bigint,
    kickoffTimestamp?: bigint,
    homeScaled?: bigint,
    awayScaled?: bigint,
    forfeitingTeamId?: number
  ): Promise<`0x${string}` | null> {
    try {
      if (fn === "revealKickoff") {
        return await this.sendWithRetry(() =>
          this.walletClient.writeContract({
            address: stockConfig.contracts.matchRegistry,
            abi: STOCK_MATCH_REGISTRY_ABI,
            functionName: "revealKickoff",
            args: [fixtureId, kickoffTimestamp as bigint],
            account: this.account,
            chain: this.chain,
          })
        );
      }
      if (fn === "recordForfeit") {
        return await this.sendWithRetry(() =>
          this.walletClient.writeContract({
            address: stockConfig.contracts.resultEngine,
            abi: STOCK_RESULT_ENGINE_ABI,
            functionName: "recordForfeit",
            args: [stockConfig.seasonId, fixtureId, forfeitingTeamId as number],
            account: this.account,
            chain: this.chain,
          })
        );
      }
      if (fn === "recordVoid") {
        return await this.sendWithRetry(() =>
          this.walletClient.writeContract({
            address: stockConfig.contracts.resultEngine,
            abi: STOCK_RESULT_ENGINE_ABI,
            functionName: "recordVoid",
            args: [stockConfig.seasonId, fixtureId],
            account: this.account,
            chain: this.chain,
          })
        );
      }
      return await this.sendWithRetry(() =>
        this.walletClient.writeContract({
          address: stockConfig.contracts.priceOracle,
          abi: STOCK_PRICE_ORACLE_ABI,
          functionName: fn,
          args: [stockConfig.seasonId, fixtureId, homeScaled as bigint, awayScaled as bigint],
          account: this.account,
          chain: this.chain,
        })
      );
    } catch (err) {
      if (err instanceof IdempotentRevert) {
        logger.info("[StockSnapshotSubmitter] idempotent revert treated as success", {
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
      address: stockConfig.contracts.priceOracle,
      abi: STOCK_PRICE_ORACLE_ABI,
      functionName: "getSnapshot",
      args: [stockConfig.seasonId, fixtureId],
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
        if (IDEMPOTENT_REVERTS.some((name) => message.includes(name))) {
          logger.info("[StockSnapshotSubmitter] idempotent revert treated as success", { message });
          throw new IdempotentRevert(message);
        }
        // Deterministic contract reverts are never retried.
        if (this.isContractRevert(message)) {
          logger.error("[StockSnapshotSubmitter] contract revert, NOT retrying", { message });
          throw err;
        }
        logger.warn("[StockSnapshotSubmitter] transient failure, retrying", {
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
