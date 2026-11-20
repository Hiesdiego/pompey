/**
 * Seed the CRYPTO PRICE WORLD CUP pools (Base Sepolia).
 *
 * - 63 match pools × FIXTURE_SEED (250 TICK) via pool.seedMatchPools(0, 63)
 * - Outright champion pool × FIXTURE_SEED via pool.seedOutright()
 * Total pulled from the owner wallet: 16,000 TICK (idempotent — safe to
 * re-run; already-seeded pools are skipped on-chain).
 *
 * Run AFTER the draw (pnpm draw:cup:testnet). Approves TICK for the pool
 * first if the allowance is short. If the owner balance is under 16,000
 * TICK the script stops and tells you to mint (owner is the TickToken
 * owner — supply is uncapped on testnet).
 *
 * Usage:
 *   pnpm seed:cup:testnet
 *
 * Env overrides (all optional):
 *   CUP_POOL_ADDRESS, CUP_REGISTRY_ADDRESS, CUP_TICK_ADDRESS
 *   (defaults: the Oct 17 testnet deployment)
 */
import "dotenv/config";
import { network } from "hardhat";

const DEFAULT_POOL = "0x9b2527c88f806fe34c166edb4784f60483b0864b";
const DEFAULT_REGISTRY = "0x45b8f0ef96b919184659bee98c7503834d167238";
const DEFAULT_TICK = "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b";

const MATCH_COUNT = 63;
const SEED_PER_POOL = 250n * 10n ** 18n;
const TOTAL_NEEDED = SEED_PER_POOL * BigInt(MATCH_COUNT + 1); // + outright

function address(name: string, fallback: string): `0x${string}` {
  const value = process.env[name]?.trim() || fallback;
  return value as `0x${string}`;
}

function fmtTick(wei: bigint): string {
  return `${(wei / 10n ** 18n).toLocaleString("en-US")} TICK`;
}

async function main(): Promise<void> {
  const { viem } = await network.create("baseSepolia");
  const [owner] = await viem.getWalletClients();
  const ownerAddress = owner.account.address;

  const pool = await viem.getContractAt(
    "CupPool",
    address("CUP_POOL_ADDRESS", DEFAULT_POOL),
  );
  const registry = await viem.getContractAt(
    "CupRegistry",
    address("CUP_REGISTRY_ADDRESS", DEFAULT_REGISTRY),
  );
  const tick = await viem.getContractAt(
    "TickToken",
    address("CUP_TICK_ADDRESS", DEFAULT_TICK),
  );

  console.log("Owner:", ownerAddress);

  // 1. Draw must be done first (contract docstring: seed after the draw).
  if (!(await registry.read.drawExecuted())) {
    throw new Error(
      "Draw not executed yet. Run `pnpm draw:cup:testnet` first, then re-run this.",
    );
  }
  console.log("Draw executed ✓");

  // 2. Balance check — seeding pulls 250 TICK × 64 pools from the owner.
  const balance = await tick.read.balanceOf([ownerAddress]) as bigint;
  console.log("Owner TICK balance:", fmtTick(balance));
  if (balance < TOTAL_NEEDED) {
    throw new Error(
      `Need at least ${fmtTick(TOTAL_NEEDED)} to seed all pools. ` +
        "Mint testnet TICK to the owner wallet first (you own TickToken), then re-run.",
    );
  }

  // 3. Approve the pool to pull the seeds.
  const allowance = await tick.read.allowance([ownerAddress, pool.address]) as bigint;
  if (allowance < TOTAL_NEEDED) {
    console.log("Approving TICK for CupPool:", fmtTick(TOTAL_NEEDED));
    const approveHash = await tick.write.approve([pool.address, TOTAL_NEEDED]);
    console.log("approve tx:", approveHash);
    // Wait for the approve to be mined AND visible — public RPC nodes lag,
    // and a seed simulation against a stale node reads allowance = 0 and
    // reverts with ERC20InsufficientAllowance (hit on the first run).
    const publicClient = await viem.getPublicClient();
    await publicClient.waitForTransactionReceipt({ hash: approveHash, confirmations: 2 });
    console.log("Approve confirmed ✓");
  } else {
    console.log("Allowance sufficient ✓");
  }

  // 4. Seed the 63 match pools (batched, idempotent).
  console.log("Seeding match pools 0–62...");
  console.log("seedMatchPools tx:", await pool.write.seedMatchPools([0, MATCH_COUNT]));

  // 5. Seed the outright pool.
  console.log("Seeding outright pool...");
  console.log("seedOutright tx:", await pool.write.seedOutright());

  // 6. Verify.
  let seeded = 0;
  for (let i = 0; i < MATCH_COUNT; i++) {
    const p: any = await pool.read.getMatchPool([i]);
    if (p.seed > 0n) seeded++;
  }
  console.log(`\nMatch pools seeded: ${seeded}/${MATCH_COUNT}`);
  const final = await pool.read.getMatchPool([MATCH_COUNT - 1]);
  console.log(`Final (match 62) seed: ${fmtTick((final as any).seed)}`);
  console.log("Done — R64 staking is live once kickoffs are revealed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
