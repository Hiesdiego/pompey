/**
 * Shared chain transport for the whole backend — the single choke point for
 * every eth_call / eth_getLogs the backend makes.
 *
 * Why this exists: the backend previously created SIX independent viem
 * publicClients (matchLifecycle, checkpointSubmitter, factoryKeeper,
 * snapshotSubmitter, api/readClient, lib/socialChain), each a bare
 * `http(rpcUrl)` with zero retry, zero fallback and zero batching — a 429 or
 * a blip on the public RPC just failed the call, and hundreds of concurrent
 * users multiplied the request volume straight through to the provider.
 *
 * What this module gives every consumer:
 * - ONE publicClient shared process-wide (connection reuse, single config).
 * - JSON-RPC batching (`batch: true`) — viem packs concurrent calls into
 *   one HTTP request. Free throughput.
 * - Transport-level retry with exponential backoff (3 attempts).
 * - Optional fallback RPC: set FALLBACK_RPC_URL and viem's `fallback`
 *   transport fails over automatically (ranked by latency).
 * - `withRpcRetry()` for operation-level retries on top of the transport.
 */
import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  ContractFunctionRevertedError,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Transport,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { config } from "../config.js";
import { logger } from "./logger.js";
import { meter } from "./net.js";

export function tickrChain(): Chain {
  return config.chainEnv === "mainnet" ? base : baseSepolia;
}

export function primaryRpcUrl(): string {
  return config.chainEnv === "mainnet" ? config.baseMainnetRpcUrl : config.baseSepoliaRpcUrl;
}

const RPC_TIMEOUT_MS = 20_000;
const RPC_RETRY_COUNT = 3;
/** viem transport delay between retries. */
const RPC_RETRY_DELAY_MS = 250;

let sharedTransport: Transport | null = null;

/** Build (once) the resilient transport every client in the backend shares. */
function getSharedTransport(): Transport {
  if (sharedTransport) return sharedTransport;
  const primary = http(primaryRpcUrl(), {
    batch: true,
    timeout: RPC_TIMEOUT_MS,
    retryCount: RPC_RETRY_COUNT,
    retryDelay: RPC_RETRY_DELAY_MS,
  });
  const fallbackUrl = config.fallbackRpcUrl;
  if (fallbackUrl) {
    const secondary = http(fallbackUrl, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
      retryCount: RPC_RETRY_COUNT,
      retryDelay: RPC_RETRY_DELAY_MS,
    });
    sharedTransport = fallback([primary, secondary], { rank: true });
    logger.info("[rpc] shared transport ready (primary + fallback, ranked)", {
      chain: tickrChain().name,
    });
  } else {
    sharedTransport = primary;
    logger.info("[rpc] shared transport ready (primary only — set FALLBACK_RPC_URL for failover)", {
      chain: tickrChain().name,
    });
  }
  return sharedTransport;
}

/**
 * THE backend publicClient. Import this instead of creating your own —
 * every read in the process shares its batching, retry and fallback.
 */
export const publicClient: PublicClient = createPublicClient({
  chain: tickrChain(),
  transport: getSharedTransport(),
}) as PublicClient;

/**
 * Wallet client for the backend signer, on the same resilient transport.
 * Nonce management still belongs to each service's TxQueue — this only
 * changes the transport underneath.
 */
export function createBackendWalletClient(account: PrivateKeyAccount): WalletClient {
  return createWalletClient({
    account,
    chain: tickrChain(),
    transport: getSharedTransport(),
  }) as WalletClient;
}

/**
 * Best-effort block number — returns null instead of throwing, for health
 * checks and other paths that must never fail the caller.
 */
export async function getBlockNumberSafe(): Promise<bigint | null> {
  try {
    return await publicClient.getBlockNumber();
  } catch (err) {
    logger.warn("[rpc] getBlockNumber failed", { error: String(err) });
    return null;
  }
}

/** A revert with a reason is deterministic — retrying is pointless. */
function isDeterministicRevert(err: unknown): boolean {
  if (err instanceof ContractFunctionRevertedError) return true;
  const msg = String(err);
  return (
    msg.includes("reverted") ||
    msg.includes("execution reverted") ||
    msg.includes("InvalidAddress") ||
    msg.includes("BadFunctionCall")
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Operation-level retry around an RPC-dependent function. The transport
 * already retries individual requests; this covers the operation as a whole
 * (e.g. a multi-chunk log scan) with a wider backoff. Deterministic
 * reverts are never retried.
 */
export async function withRpcRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      meter.count("rpc_calls", 1);
      return result;
    } catch (err) {
      lastError = err;
      if (isDeterministicRevert(err) || attempt === maxAttempts) throw err;
      const delayMs = Math.min(500 * 2 ** (attempt - 1), 8_000) + Math.random() * 250;
      logger.warn("[rpc] transient failure — retrying operation", {
        label,
        attempt,
        nextInMs: Math.round(delayMs),
        error: String(err),
      });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
