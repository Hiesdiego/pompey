/**
 * Settle the CRYPTO PRICE WORLD CUP outright champion pool (Base Sepolia).
 *
 * The outright pool does NOT settle on its own. Match pools settle through
 * the engine, but the outright waits for one explicit, permissionless call:
 * CupPool.settleOutright(). The backend never makes it and the cup page has
 * a Claim button but no Resolve button, so this script is the resolve step.
 *
 * What it does:
 * - Checks CupRegistry.tournamentComplete() (stops if the final is not in).
 * - If the outright is already settled, prints the champion and stops
 *   (idempotent — safe to re-run).
 * - Calls pool.settleOutright() from the configured wallet (any wallet
 *   works, the call is permissionless; it just pays the gas).
 * - Verifies on-chain and prints the champion, the total pool, the winning
 *   side's total, and the distributable amount (pool minus platform fee).
 *
 * After this runs, winning backers claim individually: the cup page's
 * "Claim outright winnings" button (CupStakePanel) or claimOutright().
 * claimOutright() reverts NotSettled until this settlement has happened.
 *
 * Usage:
 *   pnpm --filter @tickr/contracts settle:cup-outright:testnet
 * (add the package.json script below, or run hardhat directly:
 *   pnpm exec hardhat run scripts/settle-cup-outright.ts --network baseSepolia
 *  from packages/contracts)
 *
 * package.json (packages/contracts) script entry:
 *   "settle:cup-outright:testnet": "hardhat run scripts/settle-cup-outright.ts --network baseSepolia"
 *
 * Env overrides (all optional):
 *   CUP_POOL_ADDRESS, CUP_REGISTRY_ADDRESS
 *   (defaults: the Oct 17 testnet deployment)
 */
import "dotenv/config";
import { network } from "hardhat";

const DEFAULT_POOL = "0x9b2527c88f806fe34c166edb4784f60483b0864b";
const DEFAULT_REGISTRY = "0x45b8f0ef96b919184659bee98c7503834d167238";

const TEAM_COUNT = 64;
const OUTRIGHT_SEED = 250n * 10n ** 18n; // FIXTURE_SEED, via seedOutright()

// Team symbols in teamId order (POT 1..4 as drawn).
const TEAM_SYMBOLS = [
  "BTC", "ETH", "BNB", "XRP", "SOL", "TRON", "HYPE", "ZEC",
  "DOGE", "LINK", "ADA", "NEAR", "LTC", "AVAX", "SHIB", "TRUMP",
  "XLM", "UNI", "BCH", "WAL", "HBAR", "SUI", "GRAM", "TAO",
  "XAUT", "PUMP", "WLD", "ENA", "QNT", "AAVE", "ONDO", "DOT",
  "ASTER", "WLFI", "ARB", "ICP", "PEPE", "SKY", "ORE", "FIL",
  "ETC", "JST", "JUP", "ALGO", "RAY", "POL", "RENDER", "ATOM",
  "INJ", "TOSHI", "NIGHT", "CAKE", "VIRTUAL", "PYTH", "DASH", "CRV",
  "OP", "TIA", "VET", "STRK", "PENGUIN", "SEI", "AXS", "IMX",
] as const;

function address(name: string, fallback: string): `0x${string}` {
  const value = process.env[name]?.trim() || fallback;
  return value as `0x${string}`;
}

function fmtTick(wei: bigint): string {
  return `${(wei / 10n ** 18n).toLocaleString("en-US")} TICK`;
}

async function main(): Promise<void> {
  const { viem } = await network.create("baseSepolia");
  const [caller] = await viem.getWalletClients();
  const callerAddress = caller.account.address;

  const pool = await viem.getContractAt(
    "CupPool",
    address("CUP_POOL_ADDRESS", DEFAULT_POOL),
  );
  const registry = await viem.getContractAt(
    "CupRegistry",
    address("CUP_REGISTRY_ADDRESS", DEFAULT_REGISTRY),
  );

  console.log("Caller (any wallet works, settleOutright is permissionless):", callerAddress);
  console.log("CupPool:", pool.address);

  // 1. The tournament must be complete (final settled in the registry).
  if (!(await registry.read.tournamentComplete())) {
    throw new Error(
      "Tournament not complete in CupRegistry yet. The final must be " +
        "settled on-chain before the outright can resolve.",
    );
  }
  console.log("Tournament complete ✓");

  // 2. Report helper: champion, totals, distributable.
  const report = async (): Promise<void> => {
    const champion = Number(await pool.read.outrightChampion());
    const feeBps = (await pool.read.platformFeeBps()) as bigint;
    let staked = 0n;
    let winningTotal = 0n;
    for (let t = 0; t < TEAM_COUNT; t++) {
      const total = (await pool.read.getOutrightTotal([t])) as bigint;
      staked += total;
      if (t === champion) winningTotal = total;
    }
    const totalPool = staked + OUTRIGHT_SEED;
    const distributable = (totalPool * (10_000n - feeBps)) / 10_000n;
    console.log(`Champion: ${TEAM_SYMBOLS[champion]} (teamId ${champion})`);
    console.log("Total staked (all teams):", fmtTick(staked));
    console.log("Total pool (stakes + 250 TICK seed):", fmtTick(totalPool));
    console.log(`Winning side total (${TEAM_SYMBOLS[champion]}):`, fmtTick(winningTotal));
    console.log(`Platform fee: ${feeBps} bps`);
    console.log("Distributable to winning backers:", fmtTick(distributable));
    if (winningTotal === 0n) {
      console.log("Nobody staked on the champion: the whole pool was swept to the treasury at settlement.");
    }
  };

  // 3. Already settled? Print the state and stop.
  if (await pool.read.outrightSettled()) {
    console.log("Outright already settled ✓");
    await report();
    console.log("Winning backers can claim now (cup page Claim button or claimOutright()).");
    return;
  }

  // 4. Settle it.
  console.log("Settling the outright pool...");
  const hash = await pool.write.settleOutright();
  console.log("settleOutright tx:", hash);
  // Wait for the tx to be mined AND visible — public RPC nodes lag.
  const publicClient = await viem.getPublicClient();
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  console.log("Settlement confirmed ✓");

  // 5. Verify.
  if (!(await pool.read.outrightSettled())) {
    throw new Error("outrightSettled() still reads false after the settle tx. Check the tx on the explorer.");
  }
  await report();
  console.log(
    "\nDone. Winning backers claim individually from the cup page " +
      "(Claim outright winnings) or by calling claimOutright().",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
