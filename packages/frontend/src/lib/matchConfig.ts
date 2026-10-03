/**
 * Match duration — single source of truth.
 *
 * The frontend previously hardcoded 45 minutes (TICKR_V01_CONFIG.MATCH_DURATION_SECONDS)
 * while the MatchRegistry contract has its own `matchDurationSeconds` (default 1 hour).
 * The mismatch made the UI flip matches from "live" to "awaiting" too early and broke
 * staking eligibility windows.
 *
 * This module reads the on-chain value once at app startup and caches it.
 * `getMatchDurationMs()` falls back to the shared config until the on-chain
 * value loads (or if the read fails), so the app never blocks on it.
 */

import { TICKR_V01_CONFIG } from "@tickr/shared/constants";

let matchDurationMs: number | null = null;
let initPromise: Promise<void> | null = null;

export function getMatchDurationMs(): number {
  return matchDurationMs ?? TICKR_V01_CONFIG.MATCH_DURATION_SECONDS * 1000;
}

export function setMatchDurationMs(ms: number): void {
  if (Number.isFinite(ms) && ms > 0) matchDurationMs = ms;
}

/**
 * Fetch `matchDurationSeconds` from the MatchRegistry. Idempotent — safe to
 * call from multiple places; only the first call hits the chain.
 * Never throws; falls back to the shared config on any failure.
 */
export function initMatchDuration(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const { createPublicClient, http, parseAbi } = await import("viem");
      const { baseSepolia } = await import("viem/chains");
      const address = process.env.NEXT_PUBLIC_MATCH_REGISTRY_ADDRESS as
        | `0x${string}`
        | undefined;
      if (!address) return;
      const client = createPublicClient({
        chain: baseSepolia,
        transport: http("https://sepolia.base.org"),
      });
      const secs = await client.readContract({
        address,
        abi: parseAbi([
          "function matchDurationSeconds() external view returns (uint64)",
        ]),
        functionName: "matchDurationSeconds",
      });
      setMatchDurationMs(Number(secs) * 1000);
    } catch {
      // Fallback (shared config) stays in place.
    }
  })();
  return initPromise;
}
