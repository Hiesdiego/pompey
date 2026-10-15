import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketSummary } from "./chainCache.js";

test("market list reuses the full scan and refreshes only changed markets", async () => {
  process.env.BACKEND_SIGNER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  process.env.MARKET_FACTORY_ADDRESS = `0x${"22".repeat(20)}`;
  const { ChainCache } = await import("./chainCache.js");
  const cache = new ChainCache();
  const internal = cache as unknown as {
    fetchMarkets(): Promise<{ markets: MarketSummary[]; asOfBlock: string; refreshedAt: string }>;
    fetchMarket(id: bigint): Promise<MarketSummary>;
    marketsCache: { at: number } | null;
  };
  const market = (id: number, totalStaked: string): MarketSummary => ({
    id,
    templateId: 0,
    creator: "0x",
    creatorName: "",
    params: "0x",
    bettingCloseTime: 0,
    endTime: 0,
    state: 0,
    winnerBitmap: "0",
    payoutPerShare: "0",
    seedAmount: "0",
    totalStaked,
    outcomeTotals: [totalStaked],
    outcomeCount: 1,
  });
  let fullScans = 0;
  const targeted: bigint[] = [];
  internal.fetchMarkets = async () => {
    fullScans++;
    return { markets: [market(0, "0"), market(1, "0")], asOfBlock: "100", refreshedAt: new Date().toISOString() };
  };
  internal.fetchMarket = async (id) => {
    targeted.push(id);
    return market(Number(id), "5");
  };

  await cache.getMarkets();
  await cache.getMarkets();
  assert.equal(fullScans, 1);
  cache.markMarketDirty(1n);
  const updated = await cache.getMarkets();
  assert.equal(updated.markets[1].totalStaked, "5");
  assert.deepEqual(targeted, [1n]);
  await cache.getMarkets();
  assert.equal(fullScans, 1);
  assert.deepEqual(targeted, [1n]);

  cache.markMarketDirty(2n);
  const created = await cache.getMarkets();
  assert.equal(created.markets[2].id, 2);
  assert.deepEqual(targeted, [1n, 2n]);

  internal.marketsCache!.at -= 10 * 60_000 + 1;
  await cache.getMarkets();
  assert.equal(fullScans, 2);
});
