/**
 * Deploy the CRYPTO PRICE WORLD CUP contracts (Base Sepolia).
 *
 * Deploys four brand-new tournament contracts and wires them together.
 * NOTHING in the league's contracts is touched: no shared storage, no
 * shared wiring, no cross-calls into MatchRegistry / ResultEngine /
 * PriceOracle / PredictionPool.
 *
 * Order:
 *   1. CupRegistry(owner, operator)
 *   2. CupEngine(owner, registry, operator)
 *   3. DisputeBallot(owner, tick, treasury, engine)
 *   4. CupPool(owner, tick, registry, treasury)
 *   5. Wire: registry.setEngine, engine.setDisputeBallot,
 *      engine.setCupPool, pool.setEngine (all one-time)
 *   6. Register the 64-team field (4 pots of 16)
 *
 * The draw (requestDraw / executeDraw) is intentionally NOT run here —
 * that is the Oct 30 draw-ceremony step.
 *
 * Usage:
 *   pnpm deploy:cup:testnet
 *
 * Env overrides (all optional):
 *   CUP_TICK_TOKEN   (default: testnet TICK)
 *   CUP_TREASURY     (default: deployer)
 *   CUP_OPERATOR     (default: deployer — point at the backend hot signer
 *                     later with setOperator on registry + engine)
 */
import "dotenv/config";
import { isAddress } from "viem";
import { network } from "hardhat";

const TESTNET_TICK = "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b";

// The 64-team field, 4 pots of 16 (user-curated 2026-10-16).
// MANTLE -> ORE, APY -> TOSHI (both CoinGecko-priced; rest Binance spot).
const POT_1 = ["BTC","ETH","BNB","XRP","SOL","TRON","HYPE","ZEC","DOGE","LINK","ADA","NEAR","LTC","AVAX","SHIB","TRUMP"];
const POT_2 = ["XLM","UNI","BCH","WAL","HBAR","SUI","GRAM","TAO","XAUT","PUMP","WLD","ENA","QNT","AAVE","ONDO","DOT"];
const POT_3 = ["ASTER","WLFI","ARB","ICP","PEPE","SKY","ORE","FIL","ETC","JST","JUP","ALGO","RAY","POL","RENDER","ATOM"];
const POT_4 = ["INJ","TOSHI","NIGHT","CAKE","VIRTUAL","PYTH","DASH","CRV","OP","TIA","VET","STRK","PENGUIN","SEI","AXS","IMX"];

function address(name: string, fallback?: string): `0x${string}` {
  const configured = process.env[name]?.trim();
  const value = configured || fallback;
  if (!value || !isAddress(value, { strict: false })) {
    throw new Error(`Missing or invalid ${name}`);
  }
  return value as `0x${string}`;
}

async function main(): Promise<void> {
  const { viem } = await network.create("baseSepolia");
  const [deployer] = await viem.getWalletClients();
  if (!deployer?.account) throw new Error("No deployer account configured");
  const owner = deployer.account.address;

  const tick = address("CUP_TICK_TOKEN", TESTNET_TICK);
  const treasury = address("CUP_TREASURY", owner);
  const operator = address("CUP_OPERATOR", owner);

  for (const [i, pot] of [POT_1, POT_2, POT_3, POT_4].entries()) {
    if (pot.length !== 16) throw new Error(`Pot ${i + 1} has ${pot.length} teams, expected 16`);
  }
  const symbols = [...POT_1, ...POT_2, ...POT_3, ...POT_4];
  const pots = [
    ...POT_1.map(() => 1), ...POT_2.map(() => 2),
    ...POT_3.map(() => 3), ...POT_4.map(() => 4),
  ];

  console.log("Deployer (owner):", owner);
  console.log("TICK:", tick);
  console.log("Treasury:", treasury);
  console.log("Operator:", operator);

  console.log("\n1/4 Deploying CupRegistry...");
  const registry = await viem.deployContract("CupRegistry", [owner, operator]);
  console.log("CupRegistry:", registry.address);

  console.log("2/4 Deploying CupEngine...");
  const engine = await viem.deployContract("CupEngine", [owner, registry.address, operator]);
  console.log("CupEngine:", engine.address);

  console.log("3/4 Deploying DisputeBallot...");
  const ballot = await viem.deployContract("DisputeBallot", [owner, tick, treasury, engine.address]);
  console.log("DisputeBallot:", ballot.address);

  console.log("4/4 Deploying CupPool...");
  const pool = await viem.deployContract("CupPool", [owner, tick, registry.address, treasury]);
  console.log("CupPool:", pool.address);

  console.log("\nWiring (one-time setters)...");
  await registry.write.setEngine([engine.address]);
  console.log(" - registry.setEngine");
  await engine.write.setDisputeBallot([ballot.address]);
  console.log(" - engine.setDisputeBallot");
  await engine.write.setCupPool([pool.address]);
  console.log(" - engine.setCupPool");
  await pool.write.setEngine([engine.address]);
  console.log(" - pool.setEngine");

  console.log("\nRegistering 64 teams...");
  await registry.write.registerTeams([symbols, pots]);
  console.log(" - 64 teams registered, 16 per pot");

  console.log("\n================ DEPLOYED ================");
  console.log(`CUP_REGISTRY_ADDRESS=${registry.address}`);
  console.log(`CUP_ENGINE_ADDRESS=${engine.address}`);
  console.log(`CUP_BALLOT_ADDRESS=${ballot.address}`);
  console.log(`CUP_POOL_ADDRESS=${pool.address}`);
  console.log("==========================================");
  console.log("\nNext steps (before Nov 1):");
  console.log(" 1. Point the backend at these addresses + split price feed");
  console.log("    (Binance spot for 62 teams, CoinGecko ids 'ore' + 'toshi').");
  console.log(" 2. Approve TICK spend, then seed pools:");
  console.log("      pool.seedMatchPools(0, 63)   // 250 TICK x 63");
  console.log("      pool.seedOutright()         // 250 TICK");
  console.log(" 3. Oct 30 draw ceremony: registry.requestDraw(), then");
  console.log("    registry.executeDraw() 100+ blocks later (permissionless).");
  console.log(" 4. Backend reveals R64 kickoffs (>= 1h lead, >= 24h for openers).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
