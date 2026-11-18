/**
 * Seed all 132 Stock League Season 1 fixtures with 250 TICK each.
 *
 * Run ONLY against the FRESH 12-team StockPredictionPool deployed by
 * the 12-team StockDeploy.ts, after the fresh schedule is generated.
 *
 * Run after `schedule:stock:testnet`. This script verifies the complete
 * schedule and that the configured signer owns the pool, approves the full
 * maximum (33,000 TICK), then seeds in resumable batches. The contract skips
 * already-seeded fixtures, so rerunning after an interrupted batch is safe.
 *
 * Usage:
 *   $env:STOCK_PREDICTION_POOL_ADDRESS='0x...'; pnpm seed:stock:testnet
 * Env:
 *   STOCK_PREDICTION_POOL_ADDRESS (required)
 *   STOCK_SEASON_ID               (default 1)
 *   STOCK_FIXTURES_PER_BATCH      (default 33)
 */
import "dotenv/config";
import { network } from "hardhat";
import { isAddress, parseAbi } from "viem";

const EXPECTED_FIXTURES = 132;
const FIXTURE_SEED = 250n * 10n ** 18n;
const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
]);

function requiredAddress(name: string, value: string | undefined): `0x${string}` {
  if (!value || !isAddress(value, { strict: false })) {
    throw new Error(`Missing or invalid ${name}`);
  }
  return value as `0x${string}`;
}

async function main(): Promise<void> {
  const poolAddress = requiredAddress(
    "STOCK_PREDICTION_POOL_ADDRESS",
    process.env.STOCK_PREDICTION_POOL_ADDRESS,
  );
  const seasonId = BigInt(process.env.STOCK_SEASON_ID ?? "1");
  const batchSize = Number(process.env.STOCK_FIXTURES_PER_BATCH ?? "33");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > EXPECTED_FIXTURES) {
    throw new Error("STOCK_FIXTURES_PER_BATCH must be an integer from 1 to 132");
  }

  const { viem } = await network.create("baseSepolia");
  const [deployer] = await viem.getWalletClients();
  if (!deployer?.account) throw new Error("No Base Sepolia deployer account configured");
  const publicClient = await viem.getPublicClient();
  const pool = await viem.getContractAt("StockPredictionPool", poolAddress);
  const matchRegistryAddress = await pool.read.matchRegistry() as `0x${string}`;
  const matchRegistry = await viem.getContractAt("StockMatchRegistry", matchRegistryAddress);

  const poolOwner = await pool.read.owner() as string;
  if (poolOwner.toLowerCase() !== deployer.account.address.toLowerCase()) {
    throw new Error(`Connected signer ${deployer.account.address} is not the pool owner`);
  }
  if (!(await matchRegistry.read.scheduleGenerated())) {
    throw new Error("Stock schedule is not complete; run schedule:stock:testnet first");
  }
  const fixtureCount = await matchRegistry.read.fixtureCount();
  if (fixtureCount !== BigInt(EXPECTED_FIXTURES)) {
    throw new Error(`Expected ${EXPECTED_FIXTURES} scheduled fixtures, found ${fixtureCount}`);
  }

  const tickAddress = await pool.read.tick() as `0x${string}`;
  const totalApproval = FIXTURE_SEED * BigInt(EXPECTED_FIXTURES);
  console.log(`StockPredictionPool: ${poolAddress}`);
  console.log(`StockMatchRegistry: ${matchRegistryAddress}`);
  console.log(`TICK token: ${tickAddress}`);
  console.log(`Approving up to ${totalApproval / 10n ** 18n} TICK for fixture seeds...`);

  let hash = await deployer.writeContract({
    address: tickAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [poolAddress, totalApproval],
    chain: deployer.chain,
  });
  let receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`TICK approval reverted: ${hash}`);
  console.log(`  approval confirmed (${hash})`);

  console.log(`Seeding ${EXPECTED_FIXTURES} fixtures in batches of ${batchSize}...`);
  for (let start = 0; start < EXPECTED_FIXTURES; start += batchSize) {
    const count = Math.min(batchSize, EXPECTED_FIXTURES - start);
    hash = await pool.write.seedFixtures([seasonId, BigInt(start), BigInt(count)]);
    receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Seed batch ${start}..${start + count - 1} reverted: ${hash}`);
    }
    console.log(`  fixtures ${start}..${start + count - 1} confirmed (${hash})`);
  }

  console.log(`Stock fixture seeding complete for season ${seasonId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
