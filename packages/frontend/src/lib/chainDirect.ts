/**
 * Direct on-chain reads — the fallback path when the backend chain-cache
 * proxy ({@link BACKEND_API_URL}/api/chain/*) is unreachable.
 *
 * Every function mirrors the backend's response shape so the query hooks can
 * swap sources without changing consumers:
 * - fetchMarketsDirect  -> GET /api/chain/markets
 * - fetchMarketDirect   -> GET /api/chain/markets/:id
 * - fetchOddsHistoryDirect -> GET /api/chain/odds-history/:id
 *
 * RPC budget: fetchMarketsDirect costs exactly 5 RPC calls (marketCount,
 * getBlockNumber, one marketInfo multicall, one marketSettlement multicall,
 * one outcomeTotals multicall) no matter how many markets exist.
 * Never 2N+1 calls.
 */

import { getPublicClient } from "../hooks/usePublicClient";
import { parseAbiItem } from "viem";
import type { Address } from "viem";
import { BACKEND_API_URL } from "./contracts";
import { integerString } from "./integerString";
import {
  MARKET_FACTORY_ABI,
  MARKET_FACTORY_ADDRESS,
  marketRouteKey,
  normalizeMarketInfo,
  normalizeMarketSettlement,
} from "./marketFactory";

/** Mirrors the backend MarketSummary (bigints arrive as strings). */
export interface MarketSummary {
  id: number;
  marketKey?: string;
  factoryAddress?: Address;
  templateId: number;
  creator: string;
  creatorName: string;
  params: string;
  bettingCloseTime: number;
  endTime: number;
  state: number; // 0 Open | 1 Resolved | 2 Voided
  winnerBitmap: string;
  payoutPerShare: string;
  seedAmount: string;
  totalStaked: string;
  outcomeTotals: string[];
  outcomeCount: number;
  /**
   * Direct-read enrichment for the market detail page (void-challenge
   * countdown). The backend chain-cache does not return these; they are
   * populated by fetchMarketDirect and by useMarket's enrichment step.
   * voidInitiatedAt is "0" when no challenge is active (or the factory
   * predates the two-step void).
   */
  voidAfter?: string;
  voidInitiatedAt?: string;
}

/**
 * One odds-history point. `totals` are raw wei per outcome — the direct
 * fallback resumes accumulation from the last cached point's totals, which
 * is what makes incremental (fromBlock-cursor) refetches correct.
 * `pcts` are basis-point percentages, same formula as the board sparklines.
 */
export interface OddsPoint {
  block: number;
  ts: number; // ms epoch
  totals: string[];
  pcts: number[];
}

export interface OddsHistoryData {
  points: OddsPoint[];
  latestBlock: number;
}

/** Backend chain-cache proxy envelope. */
interface ProxyEnvelope<T> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
}

export class ChainProxyError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ChainProxyError";
    this.code = code;
  }
}

function integerField(value: unknown): string {
  const normalized = typeof value === "string" || typeof value === "number"
    ? integerString(value) : null;
  if (normalized === null) throw new ChainProxyError("PROXY_BAD_RESPONSE", "Invalid chain integer");
  return normalized;
}

function normalizeMarketSummary(market: MarketSummary): MarketSummary {
  return {
    ...market,
    marketKey: market.marketKey ?? String(market.id),
    factoryAddress: market.factoryAddress ?? MARKET_FACTORY_ADDRESS,
    winnerBitmap: integerField(market.winnerBitmap),
    payoutPerShare: integerField(market.payoutPerShare),
    seedAmount: integerField(market.seedAmount),
    totalStaked: integerField(market.totalStaked),
    outcomeTotals: market.outcomeTotals.map(integerField),
  };
}

/**
 * GET against the backend chain-cache proxy. Throws ChainProxyError when the
 * backend is unreachable or reports { ok:false } — callers fall back to the
 * direct readers below.
 */
export async function proxyGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_API_URL}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new ChainProxyError(
      "PROXY_UNREACHABLE",
      err instanceof Error ? err.message : "backend unreachable"
    );
  }
  let body: ProxyEnvelope<T>;
  try {
    body = (await res.json()) as ProxyEnvelope<T>;
  } catch {
    throw new ChainProxyError("PROXY_BAD_RESPONSE", `HTTP ${res.status}`);
  }
  if (!res.ok || body.ok === false) {
    throw new ChainProxyError(
      body.code ?? `HTTP_${res.status}`,
      body.message ?? res.statusText
    );
  }
  const data = body.data as T;
  if (path === "/api/chain/markets") {
    const markets = data as { markets: MarketSummary[] };
    return { ...markets, markets: markets.markets.map(normalizeMarketSummary) } as T;
  }
  if (/^\/api\/chain\/markets\/\d+$/.test(path)) {
    const result = data as { market: MarketSummary };
    return { ...result, market: normalizeMarketSummary(result.market) } as T;
  }
  return data;
}

type MulticallResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error?: unknown };

function assertFactoryConfigured(factory: Address): void {
  if (!factory) throw new Error("MarketFactory not configured");
}

/** ONE multicall for outcomeTotals across every outcome of one market. */
async function readOutcomeTotalsDirect(
  marketId: bigint,
  outcomeCount: number,
  factory: Address
): Promise<string[]> {
  const client = getPublicClient();
  if (outcomeCount === 0) return [];
  const results = (await client.multicall({
    contracts: Array.from({ length: outcomeCount }, (_, outcome) => ({
      address: factory,
      abi: MARKET_FACTORY_ABI,
      functionName: "outcomeTotals",
      args: [marketId, BigInt(outcome)],
    })),
    allowFailure: true,
  })) as unknown as MulticallResult[];
  return results.map((r) =>
    r.status === "success" ? (r.result as bigint).toString() : "0"
  );
}

function toMarketSummary(
  id: number,
  infoRaw: unknown,
  settlementRaw: unknown,
  outcomeTotals: string[],
  factory: Address
): MarketSummary {
  const info = normalizeMarketInfo(infoRaw);
  const settlement = normalizeMarketSettlement(settlementRaw);
  return {
    id,
    marketKey: marketRouteKey(factory, id),
    factoryAddress: factory,
    templateId: info.templateId,
    creator: info.creator,
    creatorName: info.creatorName,
    params: info.params,
    bettingCloseTime: Number(info.bettingCloseTime),
    endTime: Number(info.endTime),
    state: settlement.state,
    winnerBitmap: settlement.winnerBitmap.toString(),
    payoutPerShare: settlement.payoutPerShare.toString(),
    seedAmount: settlement.seedAmount.toString(),
    totalStaked: settlement.totalStaked.toString(),
    outcomeTotals,
    outcomeCount: info.outcomeCount,
  };
}

/**
 * All markets, newest first. Exactly 5 RPC calls: marketCount, getBlockNumber,
 * one marketInfo multicall, one marketSettlement multicall, one outcomeTotals
 * multicall. Markets whose reads fail are skipped, never fatal.
 */
export async function fetchMarketsDirect(factory: Address = MARKET_FACTORY_ADDRESS): Promise<{
  markets: MarketSummary[];
  asOfBlock: string;
}> {
  assertFactoryConfigured(factory);
  const client = getPublicClient();
  const count = Number(
    (await client.readContract({
      address: factory,
      abi: MARKET_FACTORY_ABI,
      functionName: "marketCount",
    })) as bigint
  );
  if (count === 0) return { markets: [], asOfBlock: "0" };
  const ids = Array.from({ length: count }, (_, i) => BigInt(i));

  const [infoResults, settlementResults, asOfBlock] = await Promise.all([
    client
      .multicall({
        contracts: ids.map((id) => ({
          address: factory,
          abi: MARKET_FACTORY_ABI,
          functionName: "marketInfo",
          args: [id],
        })),
        allowFailure: true,
      })
      .then((r) => r as unknown as MulticallResult[]),
    client
      .multicall({
        contracts: ids.map((id) => ({
          address: factory,
          abi: MARKET_FACTORY_ABI,
          functionName: "marketSettlement",
          args: [id],
        })),
        allowFailure: true,
      })
      .then((r) => r as unknown as MulticallResult[]),
    client.getBlockNumber(),
  ]);

  // Collect outcomeTotals calls for every surviving market first, so they
  // ride in a single multicall; then walk the flat results with an offset.
  const survivors: { id: number; info: MulticallResult; settlement: MulticallResult }[] =
    [];
  ids.forEach((id, i) => {
    const info = infoResults[i];
    const settlement = settlementResults[i];
    if (info?.status === "success" && settlement?.status === "success") {
      survivors.push({ id: Number(id), info, settlement });
    }
  });

  const outcomeContracts = survivors.flatMap((s) => {
    const info = normalizeMarketInfo(
      (s.info as { status: "success"; result: unknown }).result
    );
    return Array.from({ length: info.outcomeCount }, (_, outcome) => ({
      address: factory,
      abi: MARKET_FACTORY_ABI,
      functionName: "outcomeTotals",
      args: [BigInt(s.id), BigInt(outcome)],
    }));
  });
  const outcomeResults =
    outcomeContracts.length > 0
      ? ((await client.multicall({
          contracts: outcomeContracts,
          allowFailure: true,
        })) as unknown as MulticallResult[])
      : [];

  const markets: MarketSummary[] = [];
  let offset = 0;
  for (const s of survivors) {
    const info = normalizeMarketInfo(
      (s.info as { status: "success"; result: unknown }).result
    );
    const totals: string[] = [];
    for (let o = 0; o < info.outcomeCount; o++) {
      const r = outcomeResults[offset++];
      totals.push(
        r && r.status === "success" ? (r.result as bigint).toString() : "0"
      );
    }
    markets.push(
      toMarketSummary(
        s.id,
        (s.info as { status: "success"; result: unknown }).result,
        (s.settlement as { status: "success"; result: unknown }).result,
        totals,
        factory
      )
    );
  }
  markets.reverse(); // newest first, matching the board pages
  return { markets, asOfBlock: asOfBlock.toString() };
}

/** One market by id. Also reads the void-lifecycle fields the detail page needs. */
export async function fetchMarketDirect(
  id: number | bigint,
  factory: Address = MARKET_FACTORY_ADDRESS
): Promise<MarketSummary> {
  assertFactoryConfigured(factory);
  const client = getPublicClient();
  const marketId = BigInt(id);
  const [infoRaw, settlementRaw, voidInitiated] = await Promise.all([
    client.readContract({
      address: factory,
      abi: MARKET_FACTORY_ABI,
      functionName: "marketInfo",
      args: [marketId],
    }),
    client.readContract({
      address: factory,
      abi: MARKET_FACTORY_ABI,
      functionName: "marketSettlement",
      args: [marketId],
    }),
    // Tolerate the pre-two-step-void factory: no challenge timestamp there.
    client
      .readContract({
        address: factory,
        abi: MARKET_FACTORY_ABI,
        functionName: "voidInitiatedAt",
        args: [marketId],
      })
      .catch(() => 0n),
  ]);
  const info = normalizeMarketInfo(infoRaw);
  const totals = await readOutcomeTotalsDirect(marketId, info.outcomeCount, factory);
  return {
    ...toMarketSummary(Number(marketId), infoRaw, settlementRaw, totals, factory),
    voidAfter: info.voidAfter.toString(),
    voidInitiatedAt: (voidInitiated as bigint).toString(),
  };
}

/**
 * Incremental MarketStaked history for one market.
 *
 * - `fromBlock` is an INCLUSIVE cursor: events in blocks <= fromBlock are
 *   already covered by `seedTotals` and are skipped, so re-fetching the
 *   boundary block never double-counts.
 * - `seedTotals` (raw wei per outcome, from the last cached point) seeds the
 *   running accumulation — without it, an incremental fetch would
 *   under-count every total.
 * - Totals accumulate for EVERY fresh event (even ones whose block timestamp
 *   lookup fails), so the seed for the next round stays exact; points are
 *   only emitted for events with a resolved timestamp.
 * - Block timestamps are fetched in chunks of 25 to stay kind to the RPC.
 */
export async function fetchOddsHistoryDirect(
  marketId: number | bigint,
  opts?: { fromBlock?: bigint; seedTotals?: string[] },
  factory: Address = MARKET_FACTORY_ADDRESS
): Promise<OddsHistoryData> {
  assertFactoryConfigured(factory);
  const client = getPublicClient();
  const id = BigInt(marketId);
  const cursor = opts?.fromBlock ?? 0n;

  const info = normalizeMarketInfo(
    await client.readContract({
      address: factory,
      abi: MARKET_FACTORY_ABI,
      functionName: "marketInfo",
      args: [id],
    })
  );
  const outcomeCount = info.outcomeCount;
  if (outcomeCount === 0) return { points: [], latestBlock: Number(cursor) };

  const logs = await client.getLogs({
    address: factory,
    event: parseAbiItem("event MarketStaked(uint256 indexed marketId, address indexed user, uint256 outcome, uint256 amount)"),
    args: { marketId: id },
    fromBlock: cursor,
    toBlock: "latest",
  });
  if (logs.length === 0) return { points: [], latestBlock: Number(cursor) };

  const latestBlock = logs.reduce(
    (m, l) => (l.blockNumber > m ? l.blockNumber : m),
    cursor
  );
  // Boundary block (fromBlock, inclusive) is already in seedTotals — skip it.
  const fresh = logs.filter((l) => l.blockNumber > cursor);
  if (fresh.length === 0) return { points: [], latestBlock: Number(latestBlock) };

  const blockNums = [...new Set(fresh.map((l) => l.blockNumber))];
  const times = new Map<bigint, number>();
  for (let i = 0; i < blockNums.length; i += 25) {
    const chunk = blockNums.slice(i, i + 25);
    const blocks = await Promise.all(
      chunk.map((bn) =>
        client.getBlock({ blockNumber: bn }).catch(() => null)
      )
    );
    blocks.forEach((b, j) => {
      if (b) times.set(chunk[j], Number(b.timestamp) * 1000);
    });
  }

  fresh.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1
  );

  const totals =
    opts?.seedTotals && opts.seedTotals.length === outcomeCount
      ? opts.seedTotals.map((s) => BigInt(s))
      : new Array<bigint>(outcomeCount).fill(0n);

  const points: OddsPoint[] = [];
  for (const log of fresh) {
    const a = log.args as unknown as {
      outcome: bigint;
      amount: bigint;
    };
    const outcome = Number(a.outcome);
    if (outcome < 0 || outcome >= outcomeCount) continue;
    totals[outcome] += a.amount; // always accumulate — keeps the seed exact
    const t = times.get(log.blockNumber);
    if (t === undefined) continue; // no timestamp, no point — but totals stay correct
    const sum = totals.reduce((s, v) => s + v, 0n);
    if (sum === 0n) continue;
    points.push({
      block: Number(log.blockNumber),
      ts: t,
      totals: totals.map((v) => v.toString()),
      pcts: totals.map((v) => Number((v * 10_000n) / sum) / 100),
    });
  }
  return { points, latestBlock: Number(latestBlock) };
}

/**
 * Thin a point series to `max` points, always keeping the final point
 * (the live value). Same thinning the board used before the data layer.
 */
export function thinPoints(points: OddsPoint[], max = 60): OddsPoint[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const thinned = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (thinned[thinned.length - 1] !== last) thinned.push(last);
  return thinned;
}
