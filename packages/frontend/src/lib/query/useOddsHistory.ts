/**
 * Per-market odds-history (sparkline) queries.
 *
 * Primary source: the backend chain-cache proxy
 * (GET /api/chain/odds-history/:id), which is incremental server-side, so
 * the queryFn passes no cursor — the backend returns the full series plus
 * `latestBlock`, and points are converted to the board's { ts, pcts } shape.
 *
 * Fallback: direct on-chain reads. The cached `latestBlock` becomes the
 * INCLUSIVE fromBlock cursor and the last cached point's raw totals seed the
 * accumulation; fresh points are merged behind the cached series and thinned.
 * The cursor never regresses: if the backend ever reports an older
 * latestBlock than the cache, the cache wins.
 *
 * useOddsHistory(id)  — one market (detail page, MarketRow).
 * useOddsHistories(ids) — many markets at once (home board sparklines).
 *   Order of the returned array matches the order of `ids`.
 */

"use client";

import { useMemo } from "react";
import {
  keepPreviousData,
  useQueries,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { qks } from "./keys";
import { queryClient } from "./queryClient";
import {
  fetchOddsHistoryDirect,
  proxyGet,
  thinPoints,
  type OddsHistoryData,
  type OddsPoint,
} from "../chainDirect";
import { toAppError } from "../errors";

interface BackendOddsPoint {
  block: number;
  ts: number;
  totals: string[];
}

function pctsFromTotals(totals: string[]): number[] {
  const vals = totals.map((t) => BigInt(t));
  const sum = vals.reduce((s, v) => s + v, 0n);
  if (sum === 0n) return vals.map(() => 0);
  return vals.map((v) => Number((v * 10_000n) / sum) / 100);
}

function fromBackendPoints(points: BackendOddsPoint[]): OddsPoint[] {
  return points.map((p) => ({
    block: p.block,
    ts: p.ts,
    totals: p.totals,
    pcts: pctsFromTotals(p.totals),
  }));
}

function oddsHistoryQueryOptions(
  idStr: string
): UseQueryOptions<OddsHistoryData, Error> {
  return {
    queryKey: qks.oddsHistory(idStr),
    queryFn: async (): Promise<OddsHistoryData> => {
      const key = qks.oddsHistory(idStr);
      const cached = queryClient.getQueryData<OddsHistoryData>(key);
      try {
        const data = await proxyGet<{
          points: BackendOddsPoint[];
          latestBlock: number;
        }>(`/api/chain/odds-history/${idStr}`);
        // Never regress the cursor: a stale backend must not wipe fresher
        // direct-fallback data already in the cache.
        if (
          cached &&
          cached.points.length > 0 &&
          data.latestBlock < cached.latestBlock
        ) {
          return cached;
        }
        return {
          points: thinPoints(fromBackendPoints(data.points)),
          latestBlock: data.latestBlock,
        };
      } catch {
        try {
          const fromBlock = cached ? BigInt(cached.latestBlock) : 0n;
          const seedTotals =
            cached && cached.points.length > 0
              ? cached.points[cached.points.length - 1].totals
              : undefined;
          const fresh = await fetchOddsHistoryDirect(Number(idStr), {
            fromBlock,
            seedTotals,
          });
          return {
            points: thinPoints([...(cached?.points ?? []), ...fresh.points]),
            latestBlock: fresh.latestBlock,
          };
        } catch (e) {
          // Serve the last good series instead of erroring when we have one.
          if (cached && cached.points.length > 0) return cached;
          throw toAppError(e);
        }
      }
    },
    staleTime: 30_000,
    refetchInterval: 20_000,
    placeholderData: keepPreviousData,
  };
}

export function useOddsHistory(
  marketId: number | string | bigint | null | undefined
) {
  const idStr =
    marketId === null || marketId === undefined ? null : marketId.toString();
  return useQuery({
    ...oddsHistoryQueryOptions(idStr ?? "pending"),
    enabled: idStr !== null,
  });
}

/** Bulk sparklines for boards. Results array order matches `ids` order. */
export function useOddsHistories(ids: (number | string | bigint)[]) {
  return useQueries({
    queries: ids.map((id) => oddsHistoryQueryOptions(id.toString())),
  });
}

/**
 * Board helper: market-id -> [{ t, pcts }] map, the same shape the home
 * page's old bulk useOddsHistory returned, so its TopMovers rail and
 * sparkFor() need no changes.
 */
export function useOddsHistoryMap(ids: (number | string | bigint)[]) {
  const queries = useOddsHistories(ids);
  return useMemo(() => {
    const map = new Map<string, { t: number; pcts: number[] }[]>();
    ids.forEach((id, i) => {
      const pts = queries[i]?.data?.points;
      if (pts && pts.length > 0) {
        map.set(
          id.toString(),
          pts.map((p) => ({ t: p.ts, pcts: p.pcts }))
        );
      }
    });
    return map;
  }, [ids, queries]);
}
