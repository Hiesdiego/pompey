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
const RPC_RETRY_DELAY_MS = 250;

let sharedTransport: Transport | null = null;

function getSharedTransport(): Transport {
  if (sharedTransport) return sharedTransport;
  const urls = [...new Set([primaryRpcUrl(), ...config.fallbackRpcUrls,
    config.chainEnv === "mainnet" ? "https://base-rpc.publicnode.com" : "https://base-sepolia-rpc.publicnode.com"])]
    .filter((url) => config.chainEnv === "mainnet" || new URL(url).hostname !== "sepolia.base.org");
  const transports = urls.map((url) => http(url, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
      retryCount: RPC_RETRY_COUNT,
      retryDelay: RPC_RETRY_DELAY_MS,
    }));
  if (transports.length > 1) {
    sharedTransport = fallback(transports);
    logger.info("[rpc] shared transport ready", {
      chain: tickrChain().name,
      endpoints: transports.length,
    });
  } else {
    sharedTransport = transports[0];
    logger.info("[rpc] shared transport ready (primary only — set FALLBACK_RPC_URL for failover)", {
      chain: tickrChain().name,
    });
  }
  return sharedTransport;
}

export const publicClient: PublicClient = createPublicClient({
  chain: tickrChain(),
  transport: getSharedTransport(),
}) as PublicClient;

export function createBackendWalletClient(account: PrivateKeyAccount): WalletClient {
  return createWalletClient({
    account,
    chain: tickrChain(),
    transport: getSharedTransport(),
  }) as WalletClient;
}

export async function getBlockNumberSafe(): Promise<bigint | null> {
  try {
    return await publicClient.getBlockNumber();
  } catch (err) {
    logger.warn("[rpc] getBlockNumber failed", { error: String(err) });
    return null;
  }
}

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
