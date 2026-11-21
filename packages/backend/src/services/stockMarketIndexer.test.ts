import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicClient } from "viem";
import type { StockMarketSummary } from "./stockMarketReader.js";

// config.ts (pulled in transitively by stockMarketReader.ts via
// chainCache.ts) fails fast without these, exactly as in
// chainCache.test.ts. Set before any dynamic import below.
process.env.BACKEND_SIGNER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
process.env.MARKET_FACTORY_ADDRESS = `0x${"22".repeat(20)}`;

const FACTORY = `0x${"44".repeat(20)}` as `0x${string}`;
const STAKER = `0x${"33".repeat(20)}` as `0x${string}`;

function fakeDb(saved: Array<{ key: string; last_block: string }>): SupabaseClient {
  return {
    from: () => ({
      upsert: async (row: { key: string; last_block: string }) => {
        saved.push(row);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
}

test("stock market indexer limits each catch-up pass and resumes from the saved block", async () => {
  const { StockMarketIndexer } = await import("./stockMarketIndexer.js");
  const ranges: Array<[bigint, bigint]> = [];
  const saved: Array<{ key: string; last_block: string }> = [];
  const client = {
    getBlockNumber: async () => 20_000n,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push([fromBlock, toBlock]);
      return [];
    },
  } as unknown as PublicClient;
  const indexer = new StockMarketIndexer(fakeDb(saved), undefined, {
    factory: FACTORY,
    publicClient: client,
    deployBlock: 0n,
  });
  const internal = indexer as unknown as {
    nextBlock: bigint | null;
    scanRange(from: bigint, to: bigint | null): Promise<void>;
  };
  await internal.scanRange(0n, null);
  assert.equal(ranges.length, 10);
  assert.deepEqual(ranges[0], [0n, 899n]);
  assert.deepEqual(ranges[9], [8_100n, 8_999n]);
  assert.equal(internal.nextBlock, 9_000n);
  assert.equal(saved.at(-1)?.last_block, "8999");
  assert.ok(saved.every((row) => row.key === "stock_market_factory"));
  await internal.scanRange(internal.nextBlock!, null);
  assert.equal(ranges.length, 20);
  assert.deepEqual(ranges[10], [9_000n, 9_899n]);
  assert.equal(internal.nextBlock, 18_000n);
});

test("a MarketStaked log marks only that market dirty and the next list read refreshes only it", async () => {
  const { StockMarketIndexer, STOCK_MARKET_FACTORY_EVENTS_ABI } = await import(
    "./stockMarketIndexer.js"
  );
  const { StockMarketReader } = await import("./stockMarketReader.js");

  const market = (id: number, totalStaked: string): StockMarketSummary => ({
    id,
    token: FACTORY,
    tokenAddress: FACTORY,
    symbol: "NVDAc",
    name: null,
    iconUrl: null,
    creator: STAKER,
    creatorName: "",
    bettingCloseTime: 0,
    endTime: 0,
    deadline: 0,
    deadlineIso: new Date(0).toISOString(),
    targetPrice: "0",
    targetPriceUsd: "0",
    above: true,
    direction: "above",
    question: "",
    title: "",
    state: 0,
    winnerBitmap: "0",
    payoutPerShare: "0",
    seedAmount: "0",
    totalStaked,
    outcomeTotals: [totalStaked, "0"],
    yesTotal: totalStaked,
    noTotal: "0",
    outcomeCount: 2,
  });

  const reader = new StockMarketReader({
    factory: FACTORY,
    publicClient: {} as unknown as PublicClient,
  });
  const readerInternal = reader as unknown as {
    fetchMarkets(): Promise<{ markets: StockMarketSummary[]; asOfBlock: string; refreshedAt: string }>;
    fetchMarket(id: bigint): Promise<StockMarketSummary>;
  };
  let fullScans = 0;
  const targeted: bigint[] = [];
  readerInternal.fetchMarkets = async () => {
    fullScans++;
    return {
      markets: [market(0, "0"), market(1, "0")],
      asOfBlock: "100",
      refreshedAt: new Date().toISOString(),
    };
  };
  readerInternal.fetchMarket = async (id) => {
    targeted.push(id);
    return market(Number(id), "500");
  };

  const first = await reader.getMarkets();
  assert.equal(first.markets[1].totalStaked, "0");
  assert.equal(fullScans, 1);

  // Fixture MarketStaked log for market 1 at block 100, encoded with
  // the same ABI the indexer parses.
  const topics = encodeEventTopics({
    abi: STOCK_MARKET_FACTORY_EVENTS_ABI,
    eventName: "MarketStaked",
    args: { marketId: 1n, user: STAKER },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [0n, 500n]
  );
  const stakeLog = {
    address: FACTORY,
    blockHash: `0x${"00".repeat(32)}`,
    blockNumber: 100n,
    data,
    logIndex: 0,
    removed: false,
    topics,
    transactionHash: `0x${"ab".repeat(32)}`,
    transactionIndex: 0,
  };
  const saved: Array<{ key: string; last_block: string }> = [];
  const dirty: bigint[] = [];
  const client = {
    getBlockNumber: async () => 100n,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      fromBlock <= 100n && 100n <= toBlock ? [stakeLog] : [],
  } as unknown as PublicClient;
  const indexer = new StockMarketIndexer(
    fakeDb(saved),
    (marketId) => {
      dirty.push(marketId);
      reader.markMarketDirty(marketId);
    },
    { factory: FACTORY, publicClient: client, deployBlock: 0n }
  );
  const internal = indexer as unknown as {
    scanRange(from: bigint, to: bigint | null): Promise<void>;
  };
  await internal.scanRange(100n, 100n);
  assert.deepEqual(dirty, [1n]);
  assert.equal(saved.at(-1)?.key, "stock_market_factory");
  assert.equal(saved.at(-1)?.last_block, "100");

  const updated = await reader.getMarkets();
  assert.equal(updated.markets[1].totalStaked, "500");
  assert.equal(updated.markets[0].totalStaked, "0");
  assert.equal(fullScans, 1);
  assert.deepEqual(targeted, [1n]);

  await reader.getMarkets();
  assert.equal(fullScans, 1);
  assert.deepEqual(targeted, [1n]);
});
