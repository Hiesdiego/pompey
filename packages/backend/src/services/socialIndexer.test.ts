import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicClient } from "viem";

test("indexer limits each catch-up pass and resumes from the saved block", async () => {
  process.env.BACKEND_SIGNER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  process.env.MARKET_FACTORY_ADDRESS = `0x${"22".repeat(20)}`;
  const { SocialIndexer } = await import("./socialIndexer.js");
  const ranges: Array<[bigint, bigint]> = [];
  const saved: string[] = [];
  const db = {
    from: () => ({
      upsert: async (row: { last_block: string }) => {
        saved.push(row.last_block);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  const indexer = new SocialIndexer(db);
  const client = {
    getBlockNumber: async () => 20_000n,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push([fromBlock, toBlock]);
      return [];
    },
  } as unknown as PublicClient;
  const internal = indexer as unknown as {
    client: PublicClient;
    nextBlock: bigint | null;
    scanRange(from: bigint, to: bigint | null): Promise<void>;
  };
  internal.client = client;
  await internal.scanRange(0n, null);
  assert.equal(ranges.length, 10);
  assert.deepEqual(ranges[0], [0n, 899n]);
  assert.deepEqual(ranges[9], [8_100n, 8_999n]);
  assert.equal(internal.nextBlock, 9_000n);
  assert.equal(saved.at(-1), "8999");
  await internal.scanRange(internal.nextBlock!, null);
  assert.equal(ranges.length, 20);
  assert.deepEqual(ranges[10], [9_000n, 9_899n]);
  assert.equal(internal.nextBlock, 18_000n);
});
