/**
 * TICKR season 2 — clean redeploy of the per-season contracts + fresh market factory.
 *
 * Context: season 1's fixtures 15–19 can never be revealed (backend was down
 * through their whole matchday window) and the contracts have no escape
 * hatch, so season 1 can never complete. This script starts a clean season 2
 * on contracts that DO have the void escape hatch:
 *   - MatchRegistry.voidFixture (owner-only, only after the fixture's windowEnd)
 *   - ResultEngine.recordVoid (counts toward season completion, no league points)
 *   - PredictionPool.voidFixture + claimVoid (seed -> treasury, stakes refunded 1:1)
 *
 * What is REUSED (never reset, per the standing rule):
 *   TickToken, PlayerStats, PriceOracle, SeasonRegistry, PredictionPool, ResultEngine.
 * What is DEPLOYED FRESH:
 *   TeamRegistry (same 20-coin roster, so team IDs are unchanged),
 *   MatchRegistry (with the void hatch), MarketFactory (fresh, empty).
 *
 * Flow:
 *   1. Deploy TeamRegistry + MatchRegistry
 *   2. SeasonRegistry.startNewSeason(...) -> season 2
 *   3. One-time wiring: MatchRegistry.setSeasonId + setResultEngine
 *   4. Deploy MarketFactory (two-step-void build, same code as season 1's)
 *   5. Print the .env blocks (backend + frontend)
 *
 * NOT done here (separate manual ceremonies, unchanged):
 *   - Schedule generation:  MATCH_REGISTRY_ADDRESS=0x... pnpm schedule:testnet
 *   - Pool seeding:          POOL_ADDRESS=0x... SEASON_ID=2 pnpm seed:v03:testnet
 *
 * Usage:
 *   pnpm deploy:season2:testnet
 *
 * Env overrides (all optional):
 *   TICK_TOKEN_ADDRESS       — default: 0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b
 *   SEASON_REGISTRY_ADDRESS  — default: 0xe6f2c8a55a3f4f34a7abd833afece63d9789c260
 *   PRICE_ORACLE_ADDRESS     — default: 0x2814bd64f7774eccd5dc11a792f15fecdfebdf90
 *   RESULT_ENGINE_ADDRESS    — default: 0x82e00f543ddf320eec4447fd16810852bda4ec12
 *   PREDICTION_POOL_ADDRESS  — default: 0xc47358e69d145f94728796a337ec14401641700f
 *   BACKEND_SIGNER_ADDRESS   — default: read live from the PriceOracle
 *   TREASURY_ADDRESS         — default: deployer
 *   MATCH_DURATION_SECONDS   — default: 3600 (1h — must match backend config)
 */
import { network } from "hardhat";
import { isAddress } from "viem";

const TICK_TOKEN_DEFAULT = "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b";
const SEASON_REGISTRY_DEFAULT = "0xe6f2c8a55a3f4f34a7abd833afece63d9789c260";
const PRICE_ORACLE_DEFAULT = "0x2814bd64f7774eccd5dc11a792f15fecdfebdf90";
const RESULT_ENGINE_DEFAULT = "0x82e00f543ddf320eec4447fd16810852bda4ec12";
const PREDICTION_POOL_DEFAULT = "0xc47358e69d145f94728796a337ec14401641700f";
const MATCH_DURATION_SECONDS = 3600n;

const TEAM_NAMES = [
  "Bitcoin", "Ethereum", "Somnia", "Binance Coin", "Solana",
  "Cardano", "Ripple", "Polygon", "Dogecoin", "Avalanche",
  "Litecoin", "Sui", "Tron", "Chainlink", "Polkadot",
  "Near", "Ton", "Filecoin", "Cosmos", "Shiba Inu",
];
const TEAM_SYMBOLS = [
  "BTC", "ETH", "SOMI", "BNB", "SOL",
  "ADA", "XRP", "POL", "DOGE", "AVAX",
  "LTC", "SUI", "TRX", "LINK", "DOT",
  "NEAR", "TON", "FIL", "ATOM", "SHIB",
];

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

  const tickToken = address("TICK_TOKEN_ADDRESS", process.env.TICK_TOKEN_ADDRESS ?? TICK_TOKEN_DEFAULT);
  const seasonRegistryAddr = address("SEASON_REGISTRY_ADDRESS", process.env.SEASON_REGISTRY_ADDRESS ?? SEASON_REGISTRY_DEFAULT);
  const priceOracleAddr = address("PRICE_ORACLE_ADDRESS", process.env.PRICE_ORACLE_ADDRESS ?? PRICE_ORACLE_DEFAULT);
  const resultEngineAddr = address("RESULT_ENGINE_ADDRESS", process.env.RESULT_ENGINE_ADDRESS ?? RESULT_ENGINE_DEFAULT);
  const predictionPoolAddr = address("PREDICTION_POOL_ADDRESS", process.env.PREDICTION_POOL_ADDRESS ?? PREDICTION_POOL_DEFAULT);
  const treasury = address("TREASURY_ADDRESS", process.env.TREASURY_ADDRESS ?? owner);

  // Backend signer: explicit override wins, otherwise read it live from the
  // PriceOracle so the backend hot wallet keeps working without changes.
  let backendSigner: `0x${string}`;
  if (process.env.BACKEND_SIGNER_ADDRESS) {
    backendSigner = address("BACKEND_SIGNER_ADDRESS", process.env.BACKEND_SIGNER_ADDRESS);
    console.log("Backend signer (env override):", backendSigner);
  } else {
    const oracleContract = await viem.getContractAt("PriceOracle", priceOracleAddr);
    backendSigner = (await oracleContract.read.backendSigner()) as `0x${string}`;
    console.log("Backend signer (read from PriceOracle):", backendSigner);
  }

  console.log("Deployer       :", owner);
  console.log("TickToken      :", tickToken, "(reused)");
  console.log("SeasonRegistry :", seasonRegistryAddr, "(reused)");
  console.log("PriceOracle    :", priceOracleAddr, "(reused)");
  console.log("ResultEngine   :", resultEngineAddr, "(reused)");
  console.log("PredictionPool :", predictionPoolAddr, "(reused)");
  console.log("Treasury       :", treasury);
  console.log("");

  // --- 1. Fresh per-season contracts ---
  console.log("Deploying TeamRegistry (same 20-coin roster)...");
  const teamRegistry = await viem.deployContract("TeamRegistry", [owner, TEAM_NAMES, TEAM_SYMBOLS]);
  console.log("  TeamRegistry:", teamRegistry.address);

  console.log("Deploying MatchRegistry (with void escape hatch)...");
  const matchRegistry = await viem.deployContract("MatchRegistry", [
    owner,
    teamRegistry.address,
    backendSigner,
    MATCH_DURATION_SECONDS,
  ]);
  console.log("  MatchRegistry:", matchRegistry.address);

  // --- 2. Register the new season ---
  const seasonRegistry = await viem.getContractAt("SeasonRegistry", seasonRegistryAddr);
  const seasonIdBefore = (await seasonRegistry.read.currentSeasonId()) as bigint;
  console.log("");
  console.log(`Registering season ${seasonIdBefore + 1n}...`);
  let hash = await seasonRegistry.write.startNewSeason([teamRegistry.address, matchRegistry.address]);
  await publicClient.waitForTransactionReceipt({ hash });
  const seasonId = (await seasonRegistry.read.currentSeasonId()) as bigint;
  if (seasonId !== seasonIdBefore + 1n) throw new Error(`Unexpected season id after startNewSeason: ${seasonId}`);
  console.log(`  SeasonRegistry.startNewSeason ✓ (seasonId=${seasonId})`);

  // --- 3. One-time wiring on the new MatchRegistry ---
  console.log("");
  console.log("Wiring one-time setters on MatchRegistry...");
  hash = await matchRegistry.write.setSeasonId([seasonId]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  MatchRegistry.setSeasonId ✓");

  hash = await matchRegistry.write.setResultEngine([resultEngineAddr]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  MatchRegistry.setResultEngine ✓");

  // --- 4. Fresh market factory (two-step-void build, empty) ---
  console.log("");
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

  // --- 5. Print .env blocks ---
  console.log("");
  console.log("=================== DEPLOY COMPLETE ===================");
  console.log("");
  console.log("# ---- backend .env (packages/backend/.env) ----");
  console.log(`SEASON_ID=${seasonId}`);
  console.log(`TICK_TOKEN_ADDRESS=${tickToken}`);
  console.log(`SEASON_REGISTRY_ADDRESS=${seasonRegistryAddr}`);
  console.log(`TEAM_REGISTRY_ADDRESS=${teamRegistry.address}`);
  console.log(`MATCH_REGISTRY_ADDRESS=${matchRegistry.address}`);
  console.log(`PRICE_ORACLE_ADDRESS=${priceOracleAddr}`);
  console.log(`RESULT_ENGINE_ADDRESS=${resultEngineAddr}`);
  console.log(`PREDICTION_POOL_ADDRESS=${predictionPoolAddr}`);
  console.log(`MARKET_FACTORY_ADDRESS=${marketFactory.address}`);
  console.log(`MARKET_FACTORY_DEPLOY_BLOCK=${factoryDeployBlock}`);
  console.log("");
  console.log("# ---- next manual ceremonies ----");
  console.log("# 1. Generate the fixture schedule:");
  console.log(`#      MATCH_REGISTRY_ADDRESS=${matchRegistry.address} pnpm schedule:testnet`);
  console.log("# 2. Seed the fixture pools:");
  console.log(`#      POOL_ADDRESS=${predictionPoolAddr} SEASON_ID=${seasonId} pnpm seed:v03:testnet`);
  console.log("# 3. Restart the backend on the new .env");
  console.log("");
  console.log("# ---- frontend .env ----");
  console.log(`NEXT_PUBLIC_SEASON_ID=${seasonId}`);
  console.log(`NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=${marketFactory.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
