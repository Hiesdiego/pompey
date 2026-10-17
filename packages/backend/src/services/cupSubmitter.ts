/**
 * Cup submitter — signs and sends backend-authorized CRYPTO PRICE WORLD CUP
 * transactions (mirrors SnapshotSubmitter's reliability pattern for the
 * league):
 *
 * - Owns the backend signer (BACKEND_SIGNER_PRIVATE_KEY) via viem. The
 *   signer must be the CupEngine operator (owner calls
 *   engine.setOperator(signer) once after deployment).
 * - ALL writes go through a serialized TxQueue: concurrent matches never
 *   collide on nonces.
 * - Idempotent by design: pre-checks on-chain state before sending, and
 *   treats "already done" reverts as success.
 * - Late-start recovery: if endPrice is requested but the start snapshot was
 *   never submitted (backend was down over the start window), the start is
 *   submitted late first so the match can still settle.
 * - Retries transient failures (network/RPC hiccups) with backoff; contract
 *   reverts are deterministic and are NOT retried.
 *
 * Writes: CupRegistry.revealKickoff, CupEngine.submitStartPrice,
 * CupEngine.submitEndPrice, CupEngine.settleMatch, DisputeBallot.resolve.
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

// Minimal ABIs — only what the backend calls. Custom errors are included so
// viem can decode revert reasons instead of logging opaque selectors.
const CUP_REGISTRY_ABI = [
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
    name: "revealKickoff",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint16" },
      { name: "kickoffTimestamp", type: "uint64" },
    ],
    outputs: [],
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
  { type: "error", name: "InvalidMatchId", inputs: [{ name: "matchId", type: "uint16" }] },
  { type: "error", name: "DrawNotExecuted", inputs: [] },
  { type: "error", name: "MatchAlreadyRevealed", inputs: [{ name: "matchId", type: "uint16" }] },
  {
    type: "error",
    name: "KickoffTooSoon",
    inputs: [
      { name: "kickoffTimestamp", type: "uint64" },
      { name: "earliestAllowed", type: "uint64" },
    ],
  },
  { type: "error", name: "TeamsNotReady", inputs: [{ name: "matchId", type: "uint16" }] },
] as const;

const CUP_ENGINE_ABI = [
  {
    type: "function",
    name: "submitStartPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint16" },
      { name: "priceA", type: "uint256" },
      { name: "priceB", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submitEndPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint16" },
      { name: "priceA", type: "uint256" },
      { name: "priceB", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleMatch",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "uint16" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getSnapshot",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint16" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "startA", type: "uint256" },
          { name: "startB", type: "uint256" },
          { name: "endA", type: "uint256" },
          { name: "endB", type: "uint256" },
          { name: "startSubmitted", type: "bool" },
          { name: "endSubmitted", type: "bool" },
        ],
      },
    ],
  },
  { type: "error", name: "OnlyOperator", inputs: [] },
  { type: "error", name: "StartAlreadySubmitted", inputs: [{ name: "matchId", type: "uint16" }] },
  { type: "error", name: "EndAlreadySubmitted", inputs: [{ name: "matchId", type: "uint16" }] },
  { type: "error", name: "StartNotSubmitted", inputs: [{ name: "matchId", type: "uint16" }] },
  { type: "error", name: "MatchNotStarted", inputs: [{ name: "matchId", type: "uint16" }] },
  { type: "error", name: "MatchNotEnded", inputs: [{ name: "matchId", type: "uint16" }] },
] as const;

const DISPUTE_BALLOT_ABI = [
  {
    type: "function",
    name: "ballotCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getBallot",
    stateMutability: "view",
    inputs: [{ name: "ballotId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "matchId", type: "uint16" },
          { name: "accusedTeam", type: "uint16" },
          { name: "deadline", type: "uint64" },
          { name: "votesLegitimate", type: "uint32" },
          { name: "votesManipulated", type: "uint32" },
          { name: "resolved", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "nonpayable",
    inputs: [{ name: "ballotId", type: "uint256" }],
    outputs: [],
  },
  { type: "error", name: "InvalidBallot", inputs: [{ name: "ballotId", type: "uint256" }] },
  {
    type: "error",
    name: "BallotAlreadyResolved",
    inputs: [{ name: "ballotId", type: "uint256" }],
  },
  { type: "error", name: "VotingStillOpen", inputs: [{ name: "ballotId", type: "uint256" }] },
] as const;

/** Serialized transaction queue — one in-flight tx at a time per submitter. */
class TxQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => {});
    return run as Promise<T>;
  }
}

export interface CupSubmissionAudit {
  matchId?: number;
  ballotId?: string;
  kind: "revealKickoff" | "startPrice" | "endPrice" | "settleMatch" | "resolveBallot";
  kickoffTimestamp?: bigint;
  priceAScaled?: bigint;
  priceBScaled?: bigint;
  sourceA?: string;
  sourceB?: string;
  txHash?: `0x${string}`;
  skipped?: boolean;
  skipReason?: string;
}

const SEND_RETRIES = 3;
const RETRY_BASE_MS = 2_000;

export class CupSubmitter {
  private readonly chain: Chain;
  private readonly account: PrivateKeyAccount;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
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
    logger.info("[CupSubmitter] initialized", {
      chain: this.chain.name,
      signer: this.account.address,
      registry: config.cup.registry,
      engine: config.cup.engine,
    });
  }

  get signerAddress(): `0x${string}` {
    return this.account.address;
  }

  // ------------------------------------------------------------- reads (for pre-checks)

  async readMatch(matchId: number): Promise<{
    teamA: number;
    teamB: number;
    feederA: number;
    feederB: number;
    kickoffTimestamp: bigint;
    state: number;
  }> {
    const m = (await this.publicClient.readContract({
      address: config.cup.registry,
      abi: CUP_REGISTRY_ABI,
      functionName: "getMatch",
      args: [matchId],
    })) as unknown as {
      teamA: number;
      teamB: number;
      feederA: number;
      feederB: number;
      kickoffTimestamp: bigint;
      state: number;
    };
    return m;
  }

  async readSnapshot(matchId: number): Promise<{ startSubmitted: boolean; endSubmitted: boolean }> {
    const s = (await this.publicClient.readContract({
      address: config.cup.engine,
      abi: CUP_ENGINE_ABI,
      functionName: "getSnapshot",
      args: [matchId],
    })) as unknown as { startSubmitted: boolean; endSubmitted: boolean };
    return { startSubmitted: s.startSubmitted, endSubmitted: s.endSubmitted };
  }

  async drawExecuted(): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: config.cup.registry,
      abi: CUP_REGISTRY_ABI,
      functionName: "drawExecuted",
    })) as boolean;
  }

  async ballotCount(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: config.cup.ballot,
      abi: DISPUTE_BALLOT_ABI,
      functionName: "ballotCount",
    })) as bigint;
  }

  async readBallot(ballotId: bigint): Promise<{
    matchId: number;
    accusedTeam: number;
    deadline: bigint;
    resolved: boolean;
  }> {
    const b = (await this.publicClient.readContract({
      address: config.cup.ballot,
      abi: DISPUTE_BALLOT_ABI,
      functionName: "getBallot",
      args: [ballotId],
    })) as unknown as {
      matchId: number;
      accusedTeam: number;
      deadline: bigint;
      resolved: boolean;
    };
    return b;
  }

  // ------------------------------------------------------------- writes

  async revealKickoff(matchId: number, kickoffTimestamp: bigint): Promise<CupSubmissionAudit> {
    const audit: CupSubmissionAudit = { matchId, kind: "revealKickoff", kickoffTimestamp };
    return this.queue.enqueue(async () => {
      const m = await this.readMatch(matchId);
      if (m.kickoffTimestamp > 0n) {
        audit.skipped = true;
        audit.skipReason = "kickoff already revealed on-chain";
        return audit;
      }
      const txHash = await this.send("revealKickoff", () =>
        this.walletClient.writeContract({
          chain: this.chain,
          account: this.account,
          address: config.cup.registry,
          abi: CUP_REGISTRY_ABI,
          functionName: "revealKickoff",
          args: [matchId, kickoffTimestamp],
        })
      );
      if (txHash === null) {
        audit.skipped = true;
        audit.skipReason = "kickoff revealed concurrently (idempotent revert)";
        return audit;
      }
      audit.txHash = txHash;
      logger.info("[CupSubmitter] kickoff revealed", {
        matchId,
        kickoff: new Date(Number(kickoffTimestamp) * 1000).toISOString(),
        txHash,
      });
      return audit;
    });
  }

  async submitStartPrice(
    matchId: number,
    priceAScaled: bigint,
    priceBScaled: bigint,
    sourceA: string,
    sourceB: string
  ): Promise<CupSubmissionAudit> {
    return this.submitPrice("startPrice", matchId, priceAScaled, priceBScaled, sourceA, sourceB);
  }

  async submitEndPrice(
    matchId: number,
    priceAScaled: bigint,
    priceBScaled: bigint,
    sourceA: string,
    sourceB: string
  ): Promise<CupSubmissionAudit> {
    return this.submitPrice("endPrice", matchId, priceAScaled, priceBScaled, sourceA, sourceB);
  }

  private async submitPrice(
    kind: "startPrice" | "endPrice",
    matchId: number,
    priceAScaled: bigint,
    priceBScaled: bigint,
    sourceA: string,
    sourceB: string
  ): Promise<CupSubmissionAudit> {
    const audit: CupSubmissionAudit = {
      matchId,
      kind,
      priceAScaled,
      priceBScaled,
      sourceA,
      sourceB,
    };
    return this.queue.enqueue(async () => {
      const snap = await this.readSnapshot(matchId);
      if (kind === "startPrice" && snap.startSubmitted) {
        audit.skipped = true;
        audit.skipReason = "startPrice already submitted";
        return audit;
      }
      if (kind === "endPrice") {
        if (snap.endSubmitted) {
          audit.skipped = true;
          audit.skipReason = "endPrice already submitted";
          return audit;
        }
        // Late-start recovery: backend was down over the start window.
        if (!snap.startSubmitted) {
          logger.warn("[CupSubmitter] late-start recovery — submitting startPrice late", {
            matchId,
          });
          const late = await this.send("startPrice", () =>
            this.walletClient.writeContract({
              chain: this.chain,
              account: this.account,
              address: config.cup.engine,
              abi: CUP_ENGINE_ABI,
              functionName: "submitStartPrice",
              args: [matchId, priceAScaled, priceBScaled],
            })
          );
          if (late === null) {
            audit.skipped = true;
            audit.skipReason = "late startPrice reverted";
            return audit;
          }
        }
      }
      const fn = kind === "startPrice" ? "submitStartPrice" : "submitEndPrice";
      const txHash = await this.send(kind, () =>
        this.walletClient.writeContract({
          chain: this.chain,
          account: this.account,
          address: config.cup.engine,
          abi: CUP_ENGINE_ABI,
          functionName: fn,
          args: [matchId, priceAScaled, priceBScaled],
        })
      );
      if (txHash === null) {
        audit.skipped = true;
        audit.skipReason = `${kind} reverted (already submitted or match not in window)`;
        return audit;
      }
      audit.txHash = txHash;
      logger.info("[CupSubmitter] snapshot submitted", {
        matchId,
        kind,
        priceA: scaledToPrice(priceAScaled),
        priceB: scaledToPrice(priceBScaled),
        sourceA,
        sourceB,
        txHash,
      });
      return audit;
    });
  }

  async settleMatch(matchId: number): Promise<CupSubmissionAudit> {
    const audit: CupSubmissionAudit = { matchId, kind: "settleMatch" };
    return this.queue.enqueue(async () => {
      const m = await this.readMatch(matchId);
      // state: 0=Created, 1=Open, 2=Settled, 3=Disputed
      if (m.state === 2) {
        audit.skipped = true;
        audit.skipReason = "match already settled";
        return audit;
      }
      if (m.state === 3) {
        audit.skipped = true;
        audit.skipReason = "match disputed — awaiting DAO ballot";
        return audit;
      }
      const snap = await this.readSnapshot(matchId);
      if (!snap.endSubmitted) {
        audit.skipped = true;
        audit.skipReason = "endPrice not submitted yet";
        return audit;
      }
      const txHash = await this.send("settleMatch", () =>
        this.walletClient.writeContract({
          chain: this.chain,
          account: this.account,
          address: config.cup.engine,
          abi: CUP_ENGINE_ABI,
          functionName: "settleMatch",
          args: [matchId],
        })
      );
      if (txHash === null) {
        audit.skipped = true;
        audit.skipReason = "settleMatch reverted";
        return audit;
      }
      audit.txHash = txHash;
      logger.info("[CupSubmitter] match settled", { matchId, txHash });
      return audit;
    });
  }

  async resolveBallot(ballotId: bigint): Promise<CupSubmissionAudit> {
    const audit: CupSubmissionAudit = {
      ballotId: ballotId.toString(),
      kind: "resolveBallot",
    };
    return this.queue.enqueue(async () => {
      const b = await this.readBallot(ballotId);
      if (b.resolved) {
        audit.skipped = true;
        audit.skipReason = "ballot already resolved";
        return audit;
      }
      if (Date.now() <= Number(b.deadline) * 1000) {
        audit.skipped = true;
        audit.skipReason = "voting still open";
        return audit;
      }
      const txHash = await this.send("resolveBallot", () =>
        this.walletClient.writeContract({
          chain: this.chain,
          account: this.account,
          address: config.cup.ballot,
          abi: DISPUTE_BALLOT_ABI,
          functionName: "resolve",
          args: [ballotId],
        })
      );
      if (txHash === null) {
        audit.skipped = true;
        audit.skipReason = "resolve reverted";
        return audit;
      }
      audit.txHash = txHash;
      logger.info("[CupSubmitter] ballot resolved", {
        ballotId: ballotId.toString(),
        matchId: b.matchId,
        txHash,
      });
      return audit;
    });
  }

  // ------------------------------------------------------------- transport

  /**
   * Send one tx with retries for transient failures. Returns null when the
   * call reverts deterministically (already-done / not-yet-legal) — the
   * caller treats that as a skip, not a failure.
   */
  private async send(
    label: string,
    sendFn: () => Promise<`0x${string}`>
  ): Promise<`0x${string}` | null> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= SEND_RETRIES; attempt++) {
      try {
        return await sendFn();
      } catch (err) {
        lastErr = err;
        const msg = String(err);
        // Deterministic contract reverts are not retried.
        if (
          msg.includes("revert") ||
          msg.includes("reverted") ||
          msg.includes("OnlyOperator") ||
          msg.includes("InvalidMatchId") ||
          msg.includes("KickoffTooSoon") ||
          msg.includes("TeamsNotReady") ||
          msg.includes("MatchAlreadyRevealed") ||
          msg.includes("StartAlreadySubmitted") ||
          msg.includes("EndAlreadySubmitted") ||
          msg.includes("VotingStillOpen")
        ) {
          logger.warn("[CupSubmitter] deterministic revert — skipping", {
            label,
            error: msg.slice(0, 300),
          });
          return null;
        }
        logger.warn("[CupSubmitter] transient send failure, retrying", {
          label,
          attempt,
          error: msg.slice(0, 200),
        });
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * attempt));
      }
    }
    throw lastErr;
  }
}
