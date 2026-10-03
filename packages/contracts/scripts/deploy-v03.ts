/**
 * TICKR v0.3 — full fresh deploy (testnet).
 *
 * Deploys every contract EXCEPT TickToken (which is reused so TICK balances
 * and airdrops survive, per the standing rule). The v0.3 scoring changes
 * (0.5% per goal, no negative scorelines) live in the new PriceOracle; the
 * one-time setter wiring on every contract means the whole stack must be
 * fresh — this script does it in one run.
 *
 * Usage:
 *   pnpm deploy:v03:testnet
 *
 * Env overrides (all optional):
 *   TICK_TOKEN_ADDRESS       — default: the v0.2 TICK (0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b)
 *   BACKEND_SIGNER_ADDRESS   — default: read live from the v0.2 PriceOracle
 *   OLD_PRICE_ORACLE_ADDRESS — default: 0x8915F4919F6a2031A6aba16D9AAe639BE209b23b
 *   TREASURY_ADDRESS         — default: deployer
 *
 * After this: run pnpm backfill:v03:testnet, then pnpm schedule:testnet with
 * the new MatchRegistry address, then update backend/frontend .env files.
 */
import { network } from "hardhat";
import { isAddress } from "viem";

const TICK_TOKEN_DEFAULT = "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b";
const OLD_ORACLE_DEFAULT = "0x8915F4919F6a2031A6aba16D9AAe639BE209b23b";
const MATCH_DURATION_SECONDS = 3600n; // 1 hour — matches the v0.2 season

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
  const oldOracle = address("OLD_PRICE_ORACLE_ADDRESS", process.env.OLD_PRICE_ORACLE_ADDRESS ?? OLD_ORACLE_DEFAULT);
  const treasury = address("TREASURY_ADDRESS", process.env.TREASURY_ADDRESS ?? owner);

  // Backend signer: explicit override wins, otherwise read it live from the
  // v0.2 oracle so the backend hot wallet keeps working without changes.
  let backendSigner: `0x${string}`;
  if (process.env.BACKEND_SIGNER_ADDRESS) {
    backendSigner = address("BACKEND_SIGNER_ADDRESS", process.env.BACKEND_SIGNER_ADDRESS);
    console.log("Backend signer (env override):", backendSigner);
  } else {
    const oldOracleContract = await viem.getContractAt("PriceOracle", oldOracle);
    backendSigner = (await oldOracleContract.read.backendSigner()) as `0x${string}`;
    console.log("Backend signer (read from v0.2 oracle):", backendSigner);
  }

  console.log("Deployer :", owner);
  console.log("TickToken (reused):", tickToken);
  console.log("Treasury:", treasury);
  console.log("");

  // --- 1. Persistent contracts (no dependencies) ---
  console.log("Deploying PlayerStats...");
  const playerStats = await viem.deployContract("PlayerStats", [owner]);
  console.log("  PlayerStats:", playerStats.address);

  console.log("Deploying SeasonRegistry...");
  const seasonRegistry = await viem.deployContract("SeasonRegistry", [owner]);
  console.log("  SeasonRegistry:", seasonRegistry.address);

  console.log("Deploying PriceOracle (v0.3 scoring)...");
  const priceOracle = await viem.deployContract("PriceOracle", [owner, backendSigner]);
  console.log("  PriceOracle:", priceOracle.address);

  console.log("Deploying ResultEngine...");
  const resultEngine = await viem.deployContract("ResultEngine", [owner, seasonRegistry.address]);
  console.log("  ResultEngine:", resultEngine.address);

  console.log("Deploying PredictionPool...");
  const predictionPool = await viem.deployContract("PredictionPool", [
    owner,
    tickToken,
    seasonRegistry.address,
    playerStats.address,
    treasury,
  ]);
  console.log("  PredictionPool:", predictionPool.address);

  // --- 2. Per-season contracts ---
  console.log("Deploying TeamRegistry (20 teams)...");
  const teamRegistry = await viem.deployContract("TeamRegistry", [owner, TEAM_NAMES, TEAM_SYMBOLS]);
  console.log("  TeamRegistry:", teamRegistry.address);

  console.log("Deploying MatchRegistry...");
  const matchRegistry = await viem.deployContract("MatchRegistry", [
    owner,
    teamRegistry.address,
    backendSigner,
    MATCH_DURATION_SECONDS,
  ]);
  console.log("  MatchRegistry:", matchRegistry.address);

  console.log("Deploying MarketFactory (v0.3 spread granularity)...");
  const marketFactory = await viem.deployContract("MarketFactory", [
    owner,
    tickToken,
    seasonRegistry.address,
    priceOracle.address,
    resultEngine.address,
    treasury,
  ]);
  console.log("  MarketFactory:", marketFactory.address);

  // --- 3. One-time wiring (each setter can only ever be called once) ---
  console.log("");
  console.log("Wiring one-time setters...");
  let hash = await playerStats.write.setPredictionPool([predictionPool.address]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  PlayerStats.setPredictionPool ✓");

  hash = await predictionPool.write.setResultEngine([resultEngine.address]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  PredictionPool.setResultEngine ✓");

  hash = await priceOracle.write.setResultEngine([resultEngine.address]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  PriceOracle.setResultEngine ✓");

  hash = await resultEngine.write.setPriceOracle([priceOracle.address]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  ResultEngine.setPriceOracle ✓");

  hash = await resultEngine.write.setPredictionPool([predictionPool.address]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  ResultEngine.setPredictionPool ✓");

  hash = await matchRegistry.write.setResultEngine([resultEngine.address]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  MatchRegistry.setResultEngine ✓");

  // --- 4. Register season 1 as live ---
  console.log("");
  console.log("Registering season 1...");
  hash = await seasonRegistry.write.startNewSeason([teamRegistry.address, matchRegistry.address]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  SeasonRegistry.startNewSeason ✓");

  // --- 5. Print .env blocks ---
  console.log("");
  console.log("=================== DEPLOY COMPLETE ===================");
  console.log("");
  console.log("# ---- backend .env ----");
  console.log(`TICK_TOKEN_ADDRESS=${tickToken}`);
  console.log(`PRICE_ORACLE_ADDRESS=${priceOracle.address}`);
  console.log(`RESULT_ENGINE_ADDRESS=${resultEngine.address}`);
  console.log(`PREDICTION_POOL_ADDRESS=${predictionPool.address}`);
  console.log(`PLAYER_STATS_ADDRESS=${playerStats.address}`);
  console.log(`SEASON_REGISTRY_ADDRESS=${seasonRegistry.address}`);
  console.log(`TEAM_REGISTRY_ADDRESS=${teamRegistry.address}`);
  console.log(`MATCH_REGISTRY_ADDRESS=${matchRegistry.address}`);
  console.log(`MARKET_FACTORY_ADDRESS=${marketFactory.address}`);
  console.log("");
  console.log("# ---- frontend .env ----");
  console.log(`NEXT_PUBLIC_TICK_TOKEN_ADDRESS=${tickToken}`);
  console.log(`NEXT_PUBLIC_PRICE_ORACLE_ADDRESS=${priceOracle.address}`);
  console.log(`NEXT_PUBLIC_RESULT_ENGINE_ADDRESS=${resultEngine.address}`);
  console.log(`NEXT_PUBLIC_PREDICTION_POOL_ADDRESS=${predictionPool.address}`);
  console.log(`NEXT_PUBLIC_PLAYER_STATS_ADDRESS=${playerStats.address}`);
  console.log(`NEXT_PUBLIC_SEASON_REGISTRY_ADDRESS=${seasonRegistry.address}`);
  console.log(`NEXT_PUBLIC_TEAM_REGISTRY_ADDRESS=${teamRegistry.address}`);
  console.log(`NEXT_PUBLIC_MATCH_REGISTRY_ADDRESS=${matchRegistry.address}`);
  console.log(`NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=${marketFactory.address}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. pnpm backfill:v03:testnet   (72h price checkpoints -> new oracle)");
  console.log(`  2. pnpm schedule:testnet ${matchRegistry.address}   (generate 380 fixtures)`);
  console.log("  3. Update backend + frontend .env files with the addresses above");
  console.log("  4. Restart the backend");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
