/**
 * Deploy only the upgraded MarketFactory.
 *
 * Existing TICKR contracts are intentionally reused. This script does not
 * reset Ignition state, create a season, or rewire any existing contract.
 *
 * Usage:
 *   pnpm deploy:market-factory:testnet
 *
 * Override dependency addresses with MARKET_FACTORY_* environment variables
 * before deploying to a different environment.
 */
import "dotenv/config";
import { isAddress } from "viem";
import { network } from "hardhat";

const TESTNET_DEFAULTS = {
  tickToken: "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b",
  seasonRegistry: "0xe6f2c8a55a3f4f34a7abd833afece63d9789c260",
  priceOracle: "0x2814bd64f7774eccd5dc11a792f15fecdfebdf90",
  resultEngine: "0x82e00f543ddf320eec4447fd16810852bda4ec12",
};

function address(name: string, fallback?: string): `0x${string}` {
  // dotenv may populate optional variables as empty strings; treat those as
  // unset so the safe testnet defaults still apply.
  const configured = process.env[name]?.trim();
  const value = configured || fallback;
  // Existing deployment records contain mixed-case addresses that are not
  // all EIP-55 checksummed. Validate the hex address without requiring strict
  // checksum casing; the RPC accepts both forms.
  if (!value || !isAddress(value, { strict: false })) {
    throw new Error(`Missing or invalid ${name}`);
  }
  return value as `0x${string}`;
}

async function main(): Promise<void> {
  const { viem } = await network.create("baseSepolia");
  const [deployer] = await viem.getWalletClients();
  if (!deployer?.account) throw new Error("No deployer account configured");

  const treasury = address("MARKET_FACTORY_TREASURY", deployer.account.address);
  const constructorArgs = [
    deployer.account.address,
    address("MARKET_FACTORY_TICK_TOKEN", TESTNET_DEFAULTS.tickToken),
    address("MARKET_FACTORY_SEASON_REGISTRY", TESTNET_DEFAULTS.seasonRegistry),
    address("MARKET_FACTORY_PRICE_ORACLE", TESTNET_DEFAULTS.priceOracle),
    address("MARKET_FACTORY_RESULT_ENGINE", TESTNET_DEFAULTS.resultEngine),
    treasury,
  ] as const;

  console.log("Deploying upgraded MarketFactory...");
  console.log("Deployer:", deployer.account.address);
  console.log("Dependencies:", constructorArgs.slice(1));

  const factory = await viem.deployContract("MarketFactory", [...constructorArgs]);
  console.log("MarketFactory:", factory.address);
  console.log(`NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=${factory.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
