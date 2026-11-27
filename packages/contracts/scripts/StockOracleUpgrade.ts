/**
 * StockOracleUpgrade.ts
 *
 * Target location in the repo:
 *   packages/contracts/scripts/StockOracleUpgrade.ts
 *
 * Upgrades the StockPriceOracle UUPS proxy in place to the banded
 * scoring implementation (revised 2026-11-27):
 *
 *   - Goals come from a banded scale over the absolute move: under
 *     0.10% scores 0, then 0.10% / 0.25% / 0.75% / 1.50% / 3.00% /
 *     6.00% score 1 / 2 / 3 / 4 / 5 / 6 goals, and each full extra
 *     3.00% beyond 6.00% adds one more goal. There is NO goal cap.
 *   - This replaces the original linear 1 goal = 0.05% conversion with
 *     its 10-goal cap, which saturated on routine in-session moves in
 *     Season 1 Matchday 2 (a +1.68% vs +0.50% match was recorded as a
 *     10-10 draw).
 *
 * Safety shape:
 *   - The new implementation changes ONLY the goal conversion function
 *     and constants. No state variables are added, removed, or
 *     reordered, so the proxy storage layout is identical and every
 *     snapshot, checkpoint, and flag already recorded survives the
 *     upgrade untouched.
 *   - upgradeToAndCall is owner-only on-chain (_authorizeUpgrade). The
 *     script refuses to run unless the configured deployer IS the
 *     oracle owner, so a wrong key fails here, not on-chain.
 *   - Only fixtures that settle AFTER the upgrade use the new scale.
 *     Settled results are recorded in StockResultEngine and never
 *     recomputed. Run this before Matchday 5's first settlement
 *     (Mon Nov 30, 2026) so the whole round uses one scale.
 *
 * After the upgrade the script verifies the new scale live through
 * previewScoreline, including the two Matchday 2 scorelines that
 * motivated the change, and re-reads the fixture 9 snapshot to prove
 * storage survived.
 *
 * Usage:
 *   pnpm --filter @tickr/contracts exec hardhat run scripts/StockOracleUpgrade.ts --network baseSepolia
 *
 * Env overrides (all optional):
 *   STOCK_PRICE_ORACLE_ADDRESS, default: the Season 1 proxy below.
 */
import { network } from "hardhat";
import { getContract, isAddress, parseAbi } from "viem";

const STOCK_PRICE_ORACLE_DEFAULT = "0xd0620e22ef3063d31067e23d11c4436b36952615";
const STOCK_SEASON_ID = 1n;

function address(name: string, value: string | undefined): `0x${string}` {
  if (!value || !isAddress(value, { strict: false })) {
    throw new Error(`Missing or invalid ${name} (got "${value}")`);
  }
  return value as `0x${string}`;
}

async function main(): Promise<void> {
  const { viem } = await network.create("baseSepolia");
  const [deployer] = await viem.getWalletClients();
  if (!deployer?.account) throw new Error("No deployer account configured");
  const publicClient = await viem.getPublicClient();

  const oracleAddress = address(
    "STOCK_PRICE_ORACLE_ADDRESS",
    process.env.STOCK_PRICE_ORACLE_ADDRESS ?? STOCK_PRICE_ORACLE_DEFAULT
  );
  const oracle = getContract({
    address: oracleAddress,
    abi: parseAbi([
      "function owner() view returns (address)",
      "function upgradeToAndCall(address newImplementation, bytes data) payable",
      "function previewScoreline(int256 homeBps, int256 awayBps) pure returns (int16 homeGoals, int16 awayGoals)",
      "function getSnapshot(uint256 seasonId, uint256 fixtureId) view returns ((uint256 homeStart, uint256 awayStart, uint256 homeEnd, uint256 awayEnd, bool startSubmitted, bool endSubmitted))",
    ]),
    client: { public: publicClient, wallet: deployer },
  });

  const owner = await oracle.read.owner();
  if (owner.toLowerCase() !== deployer.account.address.toLowerCase()) {
    throw new Error(
      `Deployer ${deployer.account.address} is not the oracle owner ${owner}. ` +
        "Run this script with the owner key; the upgrade would revert on-chain."
    );
  }
  console.log(`Upgrading StockPriceOracle proxy ${oracleAddress} as owner ${owner}`);

  const snapshotBefore = await oracle.read.getSnapshot([STOCK_SEASON_ID, 9n]);
  if (!snapshotBefore.startSubmitted || !snapshotBefore.endSubmitted) {
    throw new Error("Fixture 9 must have both snapshots before upgrading");
  }

  const impl = await viem.deployContract("StockPriceOracle");
  console.log(`New implementation deployed: ${impl.address}`);

  const hash = await oracle.write.upgradeToAndCall([impl.address, "0x"]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Upgrade transaction ${hash} did not succeed`);
  }
  console.log(`Proxy upgraded in tx ${hash}`);

  // Verify the banded scale live. previewScoreline applies the
  // no-negative normalization, exactly as settlement does.
  const cases: { homeBps: bigint; awayBps: bigint; expect: [number, number]; label: string }[] = [
    { homeBps: 5n, awayBps: 0n, expect: [0, 0], label: "below the first band" },
    { homeBps: 168n, awayBps: 50n, expect: [4, 2], label: "Matchday 2: MSTR +1.68% vs MSFT +0.50%" },
    { homeBps: 563n, awayBps: 12n, expect: [5, 1], label: "Matchday 2: SNDK +5.63% vs NVDA +0.12%" },
    { homeBps: -57n, awayBps: 0n, expect: [0, 2], label: "a fall transfers goals" },
    { homeBps: 900n, awayBps: 0n, expect: [7, 0], label: "tail: 9.00% scores 7" },
    { homeBps: 1200n, awayBps: 0n, expect: [8, 0], label: "tail: 12.00% scores 8, no cap" },
  ];
  for (const c of cases) {
    const [h, a] = await oracle.read.previewScoreline([c.homeBps, c.awayBps]);
    const got: [number, number] = [Number(h), Number(a)];
    if (got[0] !== c.expect[0] || got[1] !== c.expect[1]) {
      throw new Error(
        `previewScoreline(${c.homeBps}, ${c.awayBps}) returned ${got[0]}-${got[1]}, ` +
          `expected ${c.expect[0]}-${c.expect[1]} (${c.label})`
      );
    }
    console.log(`  previewScoreline(${c.homeBps}, ${c.awayBps}) = ${got[0]}-${got[1]} (${c.label}) OK`);
  }

  // Prove storage survived: fixture 9 (MSTR vs MSFT) settled on
  // Nov 27, 2026 with both snapshots submitted, before this upgrade.
  const snap = await oracle.read.getSnapshot([STOCK_SEASON_ID, 9n]);
  if (Object.keys(snapshotBefore).some((key) =>
    snapshotBefore[key as keyof typeof snapshotBefore] !== snap[key as keyof typeof snap]
  )) {
    throw new Error("Fixture 9 snapshot did not survive the upgrade as expected");
  }
  console.log("Fixture 9 snapshot intact after upgrade: storage layout preserved.");
  console.log("Done. Fixtures settling from now on use the banded scale.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
