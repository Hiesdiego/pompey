/**
 * TICKR Stock League — full fresh deploy (Base Sepolia).
 *
 * Deploys a brand-new, parallel stock stack as UUPS proxies. NOTHING in
 * the crypto league's contracts is touched: no shared storage, no shared
 * wiring, no cross-calls into the crypto MatchRegistry / ResultEngine /
 * PriceOracle / PredictionPool / PlayerStats. TickToken (TICK) is REUSED,
 * never redeployed, so TICK balances survive (standing rule).
 *
 * Order:
 *   1. StockTeamRegistry implementation + proxy (22 teams, locked order)
 *   2. StockMatchRegistry implementation + proxy
 *   3. StockPriceOracle implementation + proxy
 *   4. StockResultEngine implementation + proxy
 *   5. StockPredictionPool implementation + proxy
 *   6. Wire one-time setters (each can only ever be called once):
 *      oracle.setResultEngine, engine.setPriceOracle,
 *      engine.setPredictionPool, engine.setMatchRegistry,
 *      pool.setResultEngine, matchRegistry.setResultEngine
 *   7. Print backend + frontend .env blocks (STOCK_ prefixed)
 *
 * What this does NOT do (deliberate):
 *   - Does NOT deploy TickToken, SeasonRegistry, PlayerStats, or any
 *     crypto contract. The stock stack has its own season id (1) and its
 *     own MatchRegistry, wired directly, no SeasonRegistry indirection.
 *   - Does NOT generate the schedule: run StockGenerateSchedule.ts next.
 *   - Does NOT seed pools: run pool.seedFixtures after the schedule.
 *   - Does NOT wire anything to crypto PlayerStats: its
 *     setPredictionPool is one-time and already set to the crypto pool.
 *     Stock TP is aggregated off-chain by the backend (see
 *     StockPredictionPool header).
 *
 * UUPS proxies: each implementation is deployed, then a StockERC1967Proxy
 * (a local wrapper around OpenZeppelin's ERC1967Proxy) is deployed with
 * encoded initializer calldata so initialization is atomic
 * and cannot be front-run. Upgrades are owner-only
 * (_authorizeUpgrade onlyOwner in every implementation).
 *
 * Dependency @openzeppelin/contracts-upgradeable@5.4.0 is pinned in the
 * contracts package and workspace lockfile. Stock Solidity files live
 * beside the existing contracts and compile with solc 0.8.28.
 *
 * Usage:
 *   pnpm deploy:stock:testnet
 *   This command is available at both the workspace root and contracts package.
 *
 * Env overrides (all optional):
 *   TICK_TOKEN_ADDRESS       — default: testnet TICK 0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b
 *   BACKEND_SIGNER_ADDRESS   — default: read live from the current crypto PriceOracle
 *   CRYPTO_PRICE_ORACLE_ADDRESS — default: current address in deployed-addresses.md
 *   TREASURY_ADDRESS         — default: deployer
 *   STOCK_MATCH_DURATION_SECONDS — default: 3600 (locked, do not change)
 *
 * After this: run StockGenerateSchedule.ts, then seed pools, then update
 * backend/frontend .env files with the STOCK_ addresses below.
 */
import { artifacts, network } from "hardhat";
import { encodeFunctionData, isAddress } from "viem";

const TICK_TOKEN_DEFAULT = "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b";
const CRYPTO_ORACLE_DEFAULT = "0x2814bd64f7774eccd5dc11a792f15fecdfebdf90";
const MATCH_DURATION_SECONDS = 3600n; // 1 hour, locked for Stock Season 1

// Locked roster, teamId 0-21. Names, symbols and Coinbase B20 token
// addresses copied verbatim from base-tokenized-stocks.csv
// (Base Tokenized Stocks API, live 2026-11-14). All decimals 8.
const TEAM_NAMES = [
  "NVIDIA", "Apple", "Microsoft", "Amazon", "Alphabet",
  "Meta", "Tesla", "AMD", "Netflix", "Broadcom",
  "Palantir", "Strategy", "Oracle", "Salesforce", "JPMorgan",
  "Visa", "Eli Lilly", "Disney", "Robinhood", "Circle",
  "GameStop", "AMC",
];
const TEAM_SYMBOLS = [
  "NVDAc", "AAPLc", "MSFTc", "AMZNc", "GOOGLc",
  "METAc", "TSLAc", "AMDc", "NFLXc", "AVGOc",
  "PLTRc", "MSTRc", "ORCLc", "CRMc", "JPMc",
  "Vc", "LLYc", "DISc", "HOODc", "CRCLc",
  "GMEc", "AMCc",
];
const TEAM_TOKEN_ADDRESSES = [
  "0xb20000000000000000000078ee7ce2fE4908108C", // NVDAc
  "0xb200000000000000000000C2e324d24d7eEcd1fb", // AAPLc
  "0xB200000000000000000000Ab99cFa739E253872B", // MSFTc
  "0xb200000000000000000000d9192b6B456483C2E8", // AMZNc
  "0xb2000000000000000000002D0BA3164cc74f58B7", // GOOGLc
  "0xb2000000000000000000008bC8786B856E61707C", // METAc
  "0xb2000000000000000000001e800a7f5189430cD0", // TSLAc
  "0xB2000000000000000000000d8Ce462E99ee7A47B", // AMDc
  "0xb20000000000000000000058B8c947e44011dFE6", // NFLXc
  "0xB200000000000000000000Fc737aeA6196aB5a4c", // AVGOc
  "0xb2000000000000000000007d16372840dF4dAbbe", // PLTRc
  "0xb2000000000000000000004884b426556b92883d", // MSTRc
  "0xb200000000000000000000347AFbA223D7B6b63C", // ORCLc
  "0xB2000000000000000000006432a3a7991e718DBB", // CRMc
  "0xB200000000000000000000FDe956536A25725156", // JPMc
  "0xB20000000000000000000054b11Fd279a4f7D4EF", // Vc
  "0xB200000000000000000000f1a0F91e34892E4718", // LLYc
  "0xb2000000000000000000000bD75bF439A38bF7DF", // DISc
  "0xb2000000000000000000006F944897540579D3f2", // HOODc
  "0xB20000000000000000000019f6E7C675b73C2e4D", // CRCLc
  "0xb2000000000000000000007790ed6E48e06eD935", // GMEc
  "0xB200000000000000000000CD7e6b8042cb7c2BB5", // AMCc
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
  const cryptoOracle = address(
    "CRYPTO_PRICE_ORACLE_ADDRESS",
    process.env.CRYPTO_PRICE_ORACLE_ADDRESS ?? CRYPTO_ORACLE_DEFAULT,
  );
  const treasury = address("TREASURY_ADDRESS", process.env.TREASURY_ADDRESS ?? owner);
  const matchDuration = BigInt(process.env.STOCK_MATCH_DURATION_SECONDS ?? MATCH_DURATION_SECONDS.toString());
  if (matchDuration !== 3600n) {
    throw new Error(`STOCK_MATCH_DURATION_SECONDS is locked to 3600, got ${matchDuration}`);
  }

  // Backend signer: explicit override wins, otherwise read it live from
  // the crypto oracle so the backend hot wallet keeps working unchanged.
  let backendSigner: `0x${string}`;
  if (process.env.BACKEND_SIGNER_ADDRESS) {
    backendSigner = address("BACKEND_SIGNER_ADDRESS", process.env.BACKEND_SIGNER_ADDRESS);
    console.log("Backend signer (env override):", backendSigner);
  } else {
    const cryptoOracleContract = await viem.getContractAt("PriceOracle", cryptoOracle);
    backendSigner = (await cryptoOracleContract.read.backendSigner()) as `0x${string}`;
    console.log("Backend signer (read from crypto oracle):", backendSigner);
  }

  if (
    TEAM_NAMES.length !== 22 || TEAM_SYMBOLS.length !== 22 || TEAM_TOKEN_ADDRESSES.length !== 22
  ) {
    throw new Error("Stock roster must be exactly 22 teams");
  }

  console.log("Deployer :", owner);
  console.log("TickToken (reused, NOT deployed):", tickToken);
  console.log("Treasury:", treasury);
  console.log("");

  // Helper: deploy an implementation, wrap it in an ERC1967Proxy with
  // empty init data, then call initialize() once on the proxy.
  // Returns the proxy address; callers use getContractAt(Impl, proxy).
  async function deployProxy(
    implName: string,
    initFn: string,
    initArgs: unknown[],
  ): Promise<`0x${string}`> {
    const impl = await viem.deployContract(implName, []);
    console.log(`  ${implName} implementation:`, impl.address);
    const artifact = await artifacts.readArtifact(implName);
    const initData = encodeFunctionData({
      abi: artifact.abi,
      functionName: initFn,
      args: initArgs as never,
    });
    const proxy = await viem.deployContract("StockERC1967Proxy", [impl.address, initData]);
    console.log(`  ${implName} proxy:`, proxy.address);
    console.log(`  ${implName}.initialize atomically`);
    return proxy.address;
  }

  // --- 1. TeamRegistry ---
  console.log("Deploying StockTeamRegistry (22 teams)...");
  const teamRegistry = await deployProxy("StockTeamRegistry", "initialize", [
    owner,
    TEAM_NAMES,
    TEAM_SYMBOLS,
    TEAM_TOKEN_ADDRESSES,
  ]);

  // --- 2. MatchRegistry ---
  console.log("Deploying StockMatchRegistry...");
  const matchRegistry = await deployProxy("StockMatchRegistry", "initialize", [
    owner,
    teamRegistry,
    backendSigner,
    matchDuration,
  ]);

  // --- 3. PriceOracle ---
  console.log("Deploying StockPriceOracle (0.05% per goal)...");
  const priceOracle = await deployProxy("StockPriceOracle", "initialize", [owner, backendSigner]);

  // --- 4. ResultEngine ---
  console.log("Deploying StockResultEngine...");
  const resultEngine = await deployProxy("StockResultEngine", "initialize", [owner, backendSigner]);

  // --- 5. PredictionPool ---
  console.log("Deploying StockPredictionPool...");
  const predictionPool = await deployProxy("StockPredictionPool", "initialize", [
    owner,
    tickToken,
    matchRegistry,
    treasury,
  ]);

  // --- 6. One-time wiring (each setter can only ever be called once) ---
  console.log("");
  console.log("Wiring one-time setters...");
  const oracle = await viem.getContractAt("StockPriceOracle", priceOracle);
  const engine = await viem.getContractAt("StockResultEngine", resultEngine);
  const pool = await viem.getContractAt("StockPredictionPool", predictionPool);
  const matches = await viem.getContractAt("StockMatchRegistry", matchRegistry);

  let hash = await oracle.write.setResultEngine([resultEngine]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  StockPriceOracle.setResultEngine ✓");

  hash = await engine.write.setPriceOracle([priceOracle]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  StockResultEngine.setPriceOracle ✓");

  hash = await engine.write.setPredictionPool([predictionPool]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  StockResultEngine.setPredictionPool ✓");

  hash = await engine.write.setMatchRegistry([matchRegistry]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  StockResultEngine.setMatchRegistry ✓");

  hash = await pool.write.setResultEngine([resultEngine]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  StockPredictionPool.setResultEngine ✓");

  hash = await matches.write.setResultEngine([resultEngine]);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  StockMatchRegistry.setResultEngine ✓");

  // --- 7. Print .env blocks ---
  console.log("");
  console.log("=================== STOCK DEPLOY COMPLETE ===================");
  console.log("");
  console.log("# ---- backend .env (STOCK_) ----");
  console.log(`STOCK_TICK_TOKEN_ADDRESS=${tickToken}`);
  console.log(`STOCK_PRICE_ORACLE_ADDRESS=${priceOracle}`);
  console.log(`STOCK_RESULT_ENGINE_ADDRESS=${resultEngine}`);
  console.log(`STOCK_PREDICTION_POOL_ADDRESS=${predictionPool}`);
  console.log(`STOCK_TEAM_REGISTRY_ADDRESS=${teamRegistry}`);
  console.log(`STOCK_MATCH_REGISTRY_ADDRESS=${matchRegistry}`);
  console.log(`STOCK_SEASON_ID=1`);
  console.log(`STOCK_BACKEND_SIGNER_ADDRESS=${backendSigner}`);
  console.log(`STOCK_TREASURY_ADDRESS=${treasury}`);
  console.log("");
  console.log("# ---- frontend .env (STOCK_) ----");
  console.log(`NEXT_PUBLIC_STOCK_TICK_TOKEN_ADDRESS=${tickToken}`);
  console.log(`NEXT_PUBLIC_STOCK_PRICE_ORACLE_ADDRESS=${priceOracle}`);
  console.log(`NEXT_PUBLIC_STOCK_RESULT_ENGINE_ADDRESS=${resultEngine}`);
  console.log(`NEXT_PUBLIC_STOCK_PREDICTION_POOL_ADDRESS=${predictionPool}`);
  console.log(`NEXT_PUBLIC_STOCK_TEAM_REGISTRY_ADDRESS=${teamRegistry}`);
  console.log(`NEXT_PUBLIC_STOCK_MATCH_REGISTRY_ADDRESS=${matchRegistry}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Generate the schedule (21 matchdays, 231 fixtures):`);
  console.log(`     $env:STOCK_MATCH_REGISTRY_ADDRESS='${matchRegistry}'; pnpm schedule:stock:testnet`);
  console.log("  2. Seed pools with 250 TICK x 231 fixtures (the seed script approves first):");
  console.log(`     $env:STOCK_PREDICTION_POOL_ADDRESS='${predictionPool}'; pnpm seed:stock:testnet`);
  console.log("  3. Update backend + frontend .env files with the STOCK_ addresses above");
  console.log("  4. Restart the backend with the stock loop enabled");
  console.log("  5. Crypto contracts untouched: verify no crypto address changed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
