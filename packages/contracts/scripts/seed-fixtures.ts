/**
 * Seed every fixture pool with 250 TICK starting liquidity.
 *
 * Calls the owner-only PredictionPool.seedFixtures in batches. The pool pulls
 * 250 TICK per fixture from the caller via transferFrom, so approve the total
 * once first (this script does it for you).
 *
 * Usage:
 *   POOL_ADDRESS=0x... pnpm seed:v03:testnet
 *
 * Env:
 *   POOL_ADDRESS         — required: the PredictionPool with the seed feature
 *   SEASON_ID            — default: 1
 *   FIXTURE_COUNT        — default: 380
 *   BATCH_SIZE           — default: 38 (one matchday per tx)
 *
 * The TICK token address is read from the pool itself (pool.tick()), so no
 * token env var is needed.
 */
import { network } from "hardhat";
import { isAddress, parseAbi } from "viem";

const FIXTURE_SEED = 250n * 10n ** 18n;

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
]);

function address(name: string, value: string | undefined): `0x${string}` {
  if (!value || !isAddress(value, { strict: false })) {
    throw new Error(`Missing or invalid ${name} (got "${value}")`);
  }
  return value as `0x${string}`;
}

async function main(): Promise<void> {
  const poolAddr = address("POOL_ADDRESS", process.env.POOL_ADDRESS);
  const seasonId = BigInt(process.env.SEASON_ID ?? "1");
  const fixtureCount = Number(process.env.FIXTURE_COUNT ?? "380");
  const batchSize = Number(process.env.BATCH_SIZE ?? "38");

  const { viem } = await network.create("baseSepolia");
  const [deployer] = await viem.getWalletClients();
  if (!deployer?.account) throw new Error("No deployer account configured");
  const publicClient = await viem.getPublicClient();
  const pool = await viem.getContractAt("PredictionPool", poolAddr);

  // Read the token from the pool itself — never trust a stale env var.
  const tickAddr = (await pool.read.tick()) as `0x${string}`;
  console.log(`Pool's TICK token: ${tickAddr}`);

  const totalSeed = FIXTURE_SEED * BigInt(fixtureCount);
  console.log(`Approving ${totalSeed / 10n ** 18n} TICK for the pool...`);
  let hash = await deployer.writeContract({
    address: tickAddr,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [poolAddr, totalSeed],
    chain: deployer.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  approve ✓");

  console.log(`Seeding ${fixtureCount} fixtures in batches of ${batchSize}...`);
  for (let start = 0; start < fixtureCount; start += batchSize) {
    const count = Math.min(batchSize, fixtureCount - start);
    hash = await pool.write.seedFixtures([seasonId, BigInt(start), BigInt(count)]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  fixtures ${start}..${start + count - 1} ✓ (tx ${hash.slice(0, 12)}…)`);
  }

  console.log("All fixture pools seeded with 250 TICK.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
