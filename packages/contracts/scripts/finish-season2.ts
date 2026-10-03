/**
 * TICKR season 2 — finish setup after the deploy script's registration
 * step misfired (its tx mined late, so the script threw on a stale read).
 *
 * This script:
 *   1. Verifies SeasonRegistry state (season SEASON_ID must point at
 *      MATCH_REGISTRY_ADDRESS).
 *   2. Calls the one-time MatchRegistry setters (setSeasonId, setResultEngine).
 *   3. Deploys the fresh MarketFactory.
 *   4. Prints the backend/frontend .env blocks.
 *
 * Required env:
 *   TEAM_REGISTRY_ADDRESS   — e.g. 0x352e6fce9c07de4bf3e187ce93a0120db05d2ea8
 *   MATCH_REGISTRY_ADDRESS  — e.g. 0xd5b0d27bb9c523ed777f355191a9dd2dcbee0c62
 *   SEASON_ID               — e.g. 2
 *
 * Optional (same defaults as deploy-season2.ts):
 *   TICK_TOKEN_ADDRESS, SEASON_REGISTRY_ADDRESS, PRICE_ORACLE_ADDRESS,
 *   RESULT_ENGINE_ADDRESS, PREDICTION_POOL_ADDRESS, TREASURY_ADDRESS,
 *   BACKEND_SIGNER_ADDRESS
 *
 * Usage:
 *   TEAM_REGISTRY_ADDRESS=0x... MATCH_REGISTRY_ADDRESS=0x... SEASON_ID=2 \
 *     pnpm --filter @tickr/contracts exec hardhat run scripts/finish-season2.ts --network baseSepolia
 */
import { network } from "hardhat";
import { isAddress } from "viem";

const TICK_TOKEN_DEFAULT = "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b";
const SEASON_REGISTRY_DEFAULT = "0xe6f2c8a55a3f4f34a7abd833afece63d9789c260";
const PRICE_ORACLE_DEFAULT = "0x2814bd64f7774eccd5dc11a792f15fecdfebdf90";
const RESULT_ENGINE_DEFAULT = "0x82e00f543ddf320eec4447fd16810852bda4ec12";
const PREDICTION_POOL_DEFAULT = "0xc47358e69d145f94728796a337ec14401641700f";

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
  const owner = deployer.account.address;
  const publicClient = await viem.getPublicClient();

  const teamRegistryAddr = address("TEAM_REGISTRY_ADDRESS", process.env.TEAM_REGISTRY_ADDRESS);
  const matchRegistryAddr = address("MATCH_REGISTRY_ADDRESS", process.env.MATCH_REGISTRY_ADDRESS);
  const seasonId = BigInt(process.env.SEASON_ID ?? "");
  if (seasonId <= 0n) throw new Error(`Missing or invalid SEASON_ID (got "${process.env.SEASON_ID}")`);

  const tickToken = address("TICK_TOKEN_ADDRESS", process.env.TICK_TOKEN_ADDRESS ?? TICK_TOKEN_DEFAULT);
  const seasonRegistryAddr = address("SEASON_REGISTRY_ADDRESS", process.env.SEASON_REGISTRY_ADDRESS ?? SEASON_REGISTRY_DEFAULT);
  const priceOracleAddr = address("PRICE_ORACLE_ADDRESS", process.env.PRICE_ORACLE_ADDRESS ?? PRICE_ORACLE_DEFAULT);
  const resultEngineAddr = address("RESULT_ENGINE_ADDRESS", process.env.RESULT_ENGINE_ADDRESS ?? RESULT_ENGINE_DEFAULT);
  const predictionPoolAddr = address("PREDICTION_POOL_ADDRESS", process.env.PREDICTION_POOL_ADDRESS ?? PREDICTION_POOL_DEFAULT);
  const treasury = address("TREASURY_ADDRESS", process.env.TREASURY_ADDRESS ?? owner);

  async function sendAndConfirm(label: string, tx: Promise<`0x${string}`>): Promise<void> {
    const hash = await tx;
    console.log(`  ${label} tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`${label} REVERTED on-chain (tx ${hash}). Check the block explorer.`);
    }
  }

  console.log("Deployer       :", owner);
  console.log("Season         :", seasonId.toString());
  console.log("TeamRegistry   :", teamRegistryAddr);
  console.log("MatchRegistry  :", matchRegistryAddr);
  console.log("");

  // --- 1. Verify SeasonRegistry state ---
  const seasonRegistry = await viem.getContractAt("SeasonRegistry", seasonRegistryAddr);
  const current = (await seasonRegistry.read.currentSeasonId()) as bigint;
  console.log("SeasonRegistry.currentSeasonId():", current.toString());
  if (current < seasonId) {
    throw new Error(
      `Season ${seasonId} is not registered yet (current=${current}). ` +
        `Register it first via SeasonRegistry.startNewSeason as the registry owner.`
    );
  }
  const seasonRaw = (await seasonRegistry.read.seasons([seasonId])) as unknown as readonly [
    `0x${string}`,
    `0x${string}`,
    bigint,
  ];
  const season = {
    teamRegistry: seasonRaw[0],
    matchRegistry: seasonRaw[1],
    startedAt: seasonRaw[2],
  };
  console.log(`seasons(${seasonId}).matchRegistry:`, season.matchRegistry);
  console.log(`seasons(${seasonId}).teamRegistry :`, season.teamRegistry);
  if (season.matchRegistry.toLowerCase() !== matchRegistryAddr.toLowerCase()) {
    throw new Error(
      `MISMATCH: season ${seasonId} points at ${season.matchRegistry}, ` +
        `but MATCH_REGISTRY_ADDRESS=${matchRegistryAddr}. Refusing to wire the wrong contract.`
    );
  }
  if (season.teamRegistry.toLowerCase() !== teamRegistryAddr.toLowerCase()) {
    throw new Error(
      `MISMATCH: season ${seasonId} points at team registry ${season.teamRegistry}, ` +
        `but TEAM_REGISTRY_ADDRESS=${teamRegistryAddr}. Refusing to continue.`
    );
  }
  console.log("  Season wiring verified ✓");
  console.log("");

  // --- 2. One-time MatchRegistry setters ---
  const matchRegistry = await viem.getContractAt("MatchRegistry", matchRegistryAddr);
  const mrOwner = (await matchRegistry.read.owner()) as `0x${string}`;
  if (mrOwner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`Deployer ${owner} is not the MatchRegistry owner (${mrOwner}).`);
  }
  const seasonIdSet = (await matchRegistry.read.seasonIdSet()) as boolean;
  const engineSet = (await matchRegistry.read.resultEngineSet()) as boolean;
  console.log("MatchRegistry wired:", { seasonIdSet, engineSet });
  if (!seasonIdSet) {
    await sendAndConfirm("MatchRegistry.setSeasonId", matchRegistry.write.setSeasonId([seasonId]));
    console.log("  MatchRegistry.setSeasonId ✓");
  } else {
    console.log("  MatchRegistry.setSeasonId already set — skipping");
  }
  if (!engineSet) {
    await sendAndConfirm(
      "MatchRegistry.setResultEngine",
      matchRegistry.write.setResultEngine([resultEngineAddr]),
    );
    console.log("  MatchRegistry.setResultEngine ✓");
  } else {
    console.log("  MatchRegistry.setResultEngine already set — skipping");
  }
  console.log("");

  // --- 3. Fresh market factory ---
  console.log("Deploying MarketFactory...");
  const marketFactory = await viem.deployContract("MarketFactory", [
    owner,
    tickToken,
    seasonRegistryAddr,
    priceOracleAddr,
    resultEngineAddr,
    treasury,
  ]);
  console.log("  MarketFactory:", marketFactory.address);
  const factoryDeployBlock = await publicClient.getBlockNumber();
  console.log(`  (deployed at block ${factoryDeployBlock})`);

  // --- 4. Print .env blocks ---
  console.log("");
  console.log("=================== SEASON SETUP COMPLETE ===================");
  console.log("");
  console.log("# ---- backend .env (packages/backend/.env) ----");
  console.log(`SEASON_ID=${seasonId}`);
  console.log(`TICK_TOKEN_ADDRESS=${tickToken}`);
  console.log(`SEASON_REGISTRY_ADDRESS=${seasonRegistryAddr}`);
  console.log(`TEAM_REGISTRY_ADDRESS=${teamRegistryAddr}`);
  console.log(`MATCH_REGISTRY_ADDRESS=${matchRegistryAddr}`);
  console.log(`PRICE_ORACLE_ADDRESS=${priceOracleAddr}`);
  console.log(`RESULT_ENGINE_ADDRESS=${resultEngineAddr}`);
  console.log(`PREDICTION_POOL_ADDRESS=${predictionPoolAddr}`);
  console.log(`MARKET_FACTORY_ADDRESS=${marketFactory.address}`);
  console.log(`MARKET_FACTORY_DEPLOY_BLOCK=${factoryDeployBlock}`);
  console.log("");
  console.log("# ---- next manual ceremonies ----");
  console.log("# 1. Generate the fixture schedule:");
  console.log(`#      MATCH_REGISTRY_ADDRESS=${matchRegistryAddr} pnpm schedule:testnet`);
  console.log("# 2. Seed the fixture pools:");
  console.log(`#      POOL_ADDRESS=${predictionPoolAddr} SEASON_ID=${seasonId} pnpm seed:v03:testnet`);
  console.log("# 3. Restart the backend on the new .env");
  console.log("");
  console.log("# ---- frontend .env ----");
  console.log(`NEXT_PUBLIC_SEASON_ID=${seasonId}`);
  console.log(`NEXT_PUBLIC_SEASON_NAME=CTF Season 1`);
  console.log(`NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=${marketFactory.address}`);
  console.log(`NEXT_PUBLIC_PREDICTION_POOL_ADDRESS=${predictionPoolAddr}`);
  console.log(`NEXT_PUBLIC_MATCH_REGISTRY_ADDRESS=${matchRegistryAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
