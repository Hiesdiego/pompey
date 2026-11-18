/**
 * Generate the Stock League Season 1 fixture schedule on the deployed
 * StockMatchRegistry, in batches. A full 132-fixture season exceeds
 * per-transaction gas limits, so generation is split across multiple
 * transactions.
 *
 *   STOCK_MATCH_REGISTRY_ADDRESS=0x... pnpm schedule:stock:testnet
 *   # or: pnpm schedule:stock:testnet 0x...
 *   (add to packages/contracts/package.json scripts:
 *    "schedule:stock:testnet": "hardhat run scripts/StockGenerateSchedule.ts --network baseSepolia")
 *
 * REDO PATH (locked Nov 18 2026): run this ONLY against the FRESH
 * StockMatchRegistry deployed by the 12-team StockDeploy.ts. NEVER run
 * it against the old 22-team registry
 * 0xc3a04de16ec15947d39ac1c27914c67e480ba019 (fixtureCount 231, schedule
 * already generated): that contract reverts ScheduleAlreadyGenerated,
 * and it must stay untouched.
 *
 * Env:
 *   STOCK_MATCH_REGISTRY_ADDRESS (required), the StockMatchRegistry from StockDeploy.ts
 *   SEASON_START_TIMESTAMP       (default 1795651200 = Nov 26 2026 00:00 UTC)
 *   MATCHDAY_INTERVAL_SECONDS    (default 86400 = 1 day; locked, do not change)
 *   MATCHDAYS_PER_BATCH          (default 3), matchdays per transaction
 *                                            (3 matchdays = 18 fixtures)
 *
 * Resumable: the contract tracks contiguous progress on-chain
 * (matchdaysGenerated), so re-running continues from the first
 * un-generated matchday. Safe to Ctrl-C and rerun.
 *
 * 12 teams → 132 fixtures across 22 rounds via the circle method,
 * DOUBLE round-robin (each pairing plays home and away, second leg
 * mirrors the first). Matchday 0 opens Nov 26 2026, matchday 20
 * opens Dec 16 2026.
 *
 * DOUBLE-HEADER FINALE: Nov 26 to Dec 16 inclusive is 21 days, so
 * 22 rounds need one double-header day. Dec 16 hosts rounds 21 and
 * 22 (matchdayIndex 20 and 21) in two waves, morning and evening,
 * 12 fixtures that day; both rounds share the Dec 16 matchday window
 * on-chain (window day offset capped at 20).
 */
import "dotenv/config";
import { network } from "hardhat";

const TOTAL_MATCHDAYS = 22; // 12 teams -> 22 rounds, double round-robin
const EXPECTED_FIXTURES = 132;
const DEFAULT_SEASON_START = 1795651200n; // Nov 26 2026 00:00:00 UTC
const DEFAULT_INTERVAL = 86400n; // 1 day

async function main(): Promise<void> {
  const addressPattern = /^0x[0-9a-fA-F]{40}$/;
  const cliAddress = process.argv.slice(2).find((arg) => addressPattern.test(arg));
  const address = (process.env.STOCK_MATCH_REGISTRY_ADDRESS ?? cliAddress) as `0x${string}` | undefined;
  if (!address || !addressPattern.test(address)) {
    throw new Error(
      "Provide a valid StockMatchRegistry address as a CLI argument or STOCK_MATCH_REGISTRY_ADDRESS env",
    );
  }

  const batchSize = Number(process.env.MATCHDAYS_PER_BATCH ?? "3");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > TOTAL_MATCHDAYS) {
    throw new Error("MATCHDAYS_PER_BATCH must be an integer between 1 and 22");
  }

  const intervalEnv = BigInt(process.env.MATCHDAY_INTERVAL_SECONDS ?? DEFAULT_INTERVAL.toString());
  if (intervalEnv !== DEFAULT_INTERVAL) {
    throw new Error(`MATCHDAY_INTERVAL_SECONDS is locked to 86400 for the stock league, got ${intervalEnv}`);
  }

  const { viem } = await network.create("baseSepolia");
  const publicClient = await viem.getPublicClient();
  const matchRegistry = await viem.getContractAt("StockMatchRegistry", address);

  console.log("StockMatchRegistry:", address);

  if (await matchRegistry.read.scheduleGenerated()) {
    const count = await matchRegistry.read.fixtureCount();
    console.log(`Schedule already generated, fixtureCount = ${count}. Nothing to do.`);
    return;
  }

  // Resume from on-chain progress (0 on a fresh contract).
  let start = Number(await matchRegistry.read.matchdaysGenerated() as bigint);
  let seasonStart: bigint;
  let intervalSec: bigint;

  if (start === 0) {
    intervalSec = intervalEnv;
    seasonStart = BigInt(process.env.SEASON_START_TIMESTAMP ?? DEFAULT_SEASON_START.toString());
    console.log("seasonStart :", new Date(Number(seasonStart) * 1000).toISOString());
    console.log("intervalSec :", intervalSec.toString());
    if (seasonStart !== DEFAULT_SEASON_START) {
      console.log("WARNING: season start is not the locked Nov 26 2026 00:00 UTC default.");
    }
  } else {
    // Resuming, reuse the timing pinned on-chain by the first batch.
    seasonStart = await matchRegistry.read.seasonStartTimestamp() as bigint;
    intervalSec = await matchRegistry.read.matchdayIntervalSeconds() as bigint;
    console.log(`Resuming from matchday ${start} (season timing pinned by first batch)`);
  }

  console.log(
    `Generating matchdays ${start}..${TOTAL_MATCHDAYS - 1} in batches of ${batchSize}...`,
  );

  while (start < TOTAL_MATCHDAYS) {
    const count = Math.min(batchSize, TOTAL_MATCHDAYS - start);
    const hash = await matchRegistry.write.generateScheduleBatch([
      seasonStart,
      intervalSec,
      start,
      count,
    ]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(
        `Batch for matchdays ${start}..${start + count - 1} reverted on-chain (tx ${hash}), fix and rerun to resume`,
      );
    }
    console.log(
      `  matchdays ${start}..${start + count - 1} -> tx ${hash} (block ${receipt.blockNumber})`,
    );
    start += count;
    // Brief pause so the RPC endpoint converges on the new state before
    // the next batch is gas-estimated (a stale read here surfaces as a
    // spurious NonContiguousBatch revert).
    if (start < TOTAL_MATCHDAYS) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }

  // Final verification, retry the reads a few times: public RPC endpoints
  // are load-balanced, and a read landing on a lagging backend can briefly
  // report stale values right after the last batch.
  let fixtureCount = 0n;
  let done = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    fixtureCount = await matchRegistry.read.fixtureCount() as bigint;
    done = await matchRegistry.read.scheduleGenerated() as boolean;
    if (fixtureCount === BigInt(EXPECTED_FIXTURES) && done) break;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  console.log(`Done, fixtureCount = ${fixtureCount} (expected ${EXPECTED_FIXTURES}), scheduleGenerated = ${done}`);
  if (fixtureCount !== BigInt(EXPECTED_FIXTURES) || !done) {
    throw new Error("Schedule incomplete, rerun the script to resume");
  }

  // Spot-check the shape: 6 fixtures on matchday 0, on matchday 20 and
  // on matchday 21, and every team plays exactly once per round
  // (22 matches per team over the season).
  const md0 = await matchRegistry.read.getFixturesByMatchday([0]) as bigint[];
  const md20 = await matchRegistry.read.getFixturesByMatchday([20]) as bigint[];
  const md21 = await matchRegistry.read.getFixturesByMatchday([21]) as bigint[];
  console.log(`Matchday 0 fixtures: ${md0.length} (expected 6)`);
  console.log(`Matchday 20 fixtures: ${md20.length} (expected 6)`);
  console.log(`Matchday 21 fixtures: ${md21.length} (expected 6)`);
  if (md0.length !== 6 || md20.length !== 6 || md21.length !== 6) {
    throw new Error("Matchday fixture counts wrong, inspect the schedule before seeding");
  }
  // Double-header check: the first fixture of round 22 (matchday 21)
  // must open in the same Dec 16 window as round 21 (matchday 20),
  // not on Dec 17.
  const f120 = (await matchRegistry.read.getFixture([md20[0]])) as unknown as { windowStart: bigint };
  const f126 = (await matchRegistry.read.getFixture([md21[0]])) as unknown as { windowStart: bigint };
  console.log(`Round 21 windowStart: ${f120.windowStart}, round 22 windowStart: ${f126.windowStart}`);
  if (f120.windowStart !== f126.windowStart) {
    throw new Error("Double-header broken: round 22 does not share the Dec 16 window with round 21");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
