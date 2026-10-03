/**
 * Shared React Query client for the TICKR frontend.
 *
 * Tuning rationale:
 * - staleTime 10s: chain data changes on human timescales (stakes,
 *   resolutions); 10s keeps the board fresh without hammering the proxy/RPC.
 * - gcTime 5min: navigating market list -> detail -> back reuses warm caches.
 * - retry: two retries with exponential backoff (1s, 2s). The hooks throw
 *   AppError only after the direct-chain fallback is exhausted, so a retry
 *   here covers transient proxy/RPC blips, not permanent failures.
 * - refetchOnWindowFocus / refetchOnReconnect: a returning user never stares
 *   at a stale board; background refresh is automatic and silent.
 */

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount) => failureCount < 2,
      retryDelay: (attemptIndex) =>
        Math.min(1_000 * 2 ** attemptIndex, 15_000),
    },
  },
});
