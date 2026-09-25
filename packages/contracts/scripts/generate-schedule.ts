/**
 * Generate the Season 1 fixture schedule on the deployed MatchRegistry,
 * in batches — a full 380-fixture season exceeds per-transaction gas
 * limits, so generation is split across multiple transactions.
 *
 *   MATCH_REGISTRY_ADDRESS=0x... pnpm schedule:testnet
 *   # or: pnpm schedule:testnet 0x...
 *
 * Env:
 *   MATCH_REGISTRY_ADDRESS       (required) — the new MatchRegistry from the redeploy
 *   SEASON_START_DELAY_MIN       (default 30) — how far out matchday 0's window opens
 *   MATCHDAY_INTERVAL_SECONDS    (default 172800 = 2 days, ~3.5 matchdays/week)
 *   MATCHDAYS_PER_BATCH          (default 2) — matchdays per transaction
 *                                            (2 matchdays = 20 fixtures ≈ well
 *                                            under per-tx gas limits)
 *
 * Resumable: the contract tracks contiguous progress on-chain
 * (matchdaysGenerated), so re-running continues from the first
 * un-generated matchday. Safe to Ctrl-C and rerun.
 *
 * 20 teams → 380 fixtures across 38 matchdays via the circle method.
 */
import "dotenv/config";
import { network } from "hardhat";

const TOTAL_MATCHDAYS = 38; // 20 teams -> 19 rounds x 2 legs
const EXPECTED_FIXTURES = 380;

async function main(): Promise<void> {
  const addressPattern = /^0x[0-9a-fA-F]{40}$/;
  const cliAddress = process.argv.slice(2).find((arg) => addressPattern.test(arg));
  const address = (process.env.MATCH_REGISTRY_ADDRESS ?? cliAddress) as `0x${string}` | undefined;
  if (!address || !addressPattern.test(address)) {
    throw new Error(
      "Provide a valid MatchRegistry address as a CLI argument or MATCH_REGISTRY_ADDRESS env"
    );
  }

  const batchSize = Number(process.env.MATCHDAYS_PER_BATCH ?? "2");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > TOTAL_MATCHDAYS) {
    throw new Error("MATCHDAYS_PER_BATCH must be an integer between 1 and 38");
  }

  const { viem } = await network.create("baseSepolia");
  const publicClient = await viem.getPublicClient();
  const matchRegistry = await viem.getContractAt("MatchRegistry", address);

  console.log("MatchRegistry:", address);

  if (await matchRegistry.read.scheduleGenerated()) {
    const count = await matchRegistry.read.fixtureCount();
    console.log(`Schedule already generated — fixtureCount = ${count}. Nothing to do.`);
    return;
  }

  // Resume from on-chain progress (0 on a fresh contract).
  let start = Number(await matchRegistry.read.matchdaysGenerated());
  let seasonStart: bigint;
  let intervalSec: bigint;

  if (start === 0) {
    const startDelayMin = Number(process.env.SEASON_START_DELAY_MIN ?? "30");
    intervalSec = BigInt(process.env.MATCHDAY_INTERVAL_SECONDS ?? "172800");
    seasonStart = BigInt(Math.floor(Date.now() / 1000) + startDelayMin * 60);
    console.log("seasonStart :", new Date(Number(seasonStart) * 1000).toISOString());
    console.log("intervalSec :", intervalSec.toString());
  } else {
    // Resuming — reuse the timing pinned on-chain by the first batch.
    seasonStart = await matchRegistry.read.seasonStartTimestamp();
    intervalSec = await matchRegistry.read.matchdayIntervalSeconds();
    console.log(`Resuming from matchday ${start} (season timing pinned by first batch)`);
  }

  console.log(
    `Generating matchdays ${start}..${TOTAL_MATCHDAYS - 1} in batches of ${batchSize}...`
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
        `Batch for matchdays ${start}..${start + count - 1} reverted on-chain (tx ${hash}) — fix and rerun to resume`
      );
    }
    console.log(
      `  matchdays ${start}..${start + count - 1} -> tx ${hash} (block ${receipt.blockNumber})`
    );
    start += count;
    // Brief pause so the RPC endpoint converges on the new state before
    // the next batch is gas-estimated (a stale read here surfaces as a
    // spurious NonContiguousBatch revert).
    if (start < TOTAL_MATCHDAYS) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }

  // Final verification — retry the reads a few times: public RPC endpoints
  // are load-balanced, and a read landing on a lagging backend can briefly
  // report stale values right after the last batch.
  let fixtureCount = 0n;
  let done = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    fixtureCount = await matchRegistry.read.fixtureCount();
    done = await matchRegistry.read.scheduleGenerated();
    if (fixtureCount === BigInt(EXPECTED_FIXTURES) && done) break;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  console.log(`Done — fixtureCount = ${fixtureCount} (expected ${EXPECTED_FIXTURES}), scheduleGenerated = ${done}`);
  if (fixtureCount !== BigInt(EXPECTED_FIXTURES) || !done) {
    throw new Error("Schedule incomplete — rerun the script to resume");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
