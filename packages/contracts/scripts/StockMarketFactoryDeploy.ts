/**
 * TICKR Stock Price Target Markets deploy (Base Sepolia).
 *
 * Step 2 of the STOCK BUILD. Deploys StockMarketFactory, the sibling of
 * the crypto MarketFactory for stock price target markets
 * ("Will [STOCK] be above or below $X by [date]?"), as a UUPS proxy.
 * NOTHING in the crypto league or the stock league is touched: no shared
 * storage, no shared wiring. TickToken (TICK) is REUSED, never
 * redeployed, so TICK balances survive (standing rule).
 *
 * Order:
 *   1. StockMarketFactory implementation + StockERC1967Proxy, with
 *      initialize(owner, tick, treasury, resolver) encoded into the
 *      proxy constructor so initialization is atomic and cannot be
 *      front-run, exactly like StockDeploy.ts.
 *   2. Print backend + frontend .env blocks (STOCK_MARKET_ prefixed).
 *
 * Wiring set at initialize (no one-time setters to call afterwards):
 *   - tick:     the reused TICK token.
 *   - treasury: receives the 3 percent treasury fee, no-staker seeds and
 *               zero-winning-staker sweeps.
 *   - resolver: the ONLY address that can resolve markets, by submitting
 *               the final NAV price at or after a market's deadline
 *               (the backend signer). It earns the 1 percent resolver
 *               fee. Rotatable later by the owner via setResolver.
 *
 * Defaults: treasury and resolver are both the backend signer / treasury
 * address used across the stock stack,
 * 0x5219d14dfbcf0be6ec00d6b5188fff353aeb33bf (see deployed-addresses.md).
 *
 * What this does NOT do (deliberate):
 *   - Does NOT deploy TickToken or any crypto or stock league contract.
 *   - Does NOT create any market. Creators (anyone) call createMarket
 *     afterwards; each creation pulls the 250 TICK seed from the creator,
 *     so a creator wallet needs a TICK balance plus an approve of the
 *     factory first. TICKR's own featured boards are created the same
 *     way, from the creator wallet, after this deploy.
 *   - Does NOT set fees: the defaults (3 percent treasury, 2 percent
 *     creator, 1 percent resolver) are set in initialize from
 *     StockMarketConstants. The owner can adjust them later via setFees
 *     within the 10 percent total ceiling.
 *
 * Copy this file to packages/contracts/scripts/StockMarketFactoryDeploy.ts
 * in the pompey repo before running it (it imports StockERC1967Proxy and
 * StockMarketFactory artifacts, which live beside the stock contracts).
 *
 * Usage (run by the user, from the repo root):
 *   pnpm --filter @tickr/contracts exec hardhat run scripts/StockMarketFactoryDeploy.ts --network baseSepolia
 *
 * Env overrides (all optional):
 *   TICK_TOKEN_ADDRESS          , default: testnet TICK 0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b
 *   TREASURY_ADDRESS            , default: 0x5219d14dfbcf0be6ec00d6b5188fff353aeb33bf
 *   STOCK_MARKET_RESOLVER_ADDRESS (also accepts BACKEND_SIGNER_ADDRESS),
 *                                 default: 0x5219d14dfbcf0be6ec00d6b5188fff353aeb33bf
 */
import { artifacts, network } from "hardhat";
import { encodeFunctionData, isAddress } from "viem";

const TICK_TOKEN_DEFAULT = "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b";
const BACKEND_SIGNER_DEFAULT = "0x5219d14dfbcf0be6ec00d6b5188fff353aeb33bf";

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

  const tickToken = address("TICK_TOKEN_ADDRESS", process.env.TICK_TOKEN_ADDRESS ?? TICK_TOKEN_DEFAULT);
  const treasury = address("TREASURY_ADDRESS", process.env.TREASURY_ADDRESS ?? BACKEND_SIGNER_DEFAULT);
  const resolver = address(
    "STOCK_MARKET_RESOLVER_ADDRESS",
    process.env.STOCK_MARKET_RESOLVER_ADDRESS ?? process.env.BACKEND_SIGNER_ADDRESS ?? BACKEND_SIGNER_DEFAULT,
  );

  console.log("Deployer :", owner);
  console.log("TickToken (reused, NOT deployed):", tickToken);
  console.log("Treasury:", treasury);
  console.log("Resolver (backend signer, submits final NAV prices):", resolver);
  console.log("");

  // --- 1. StockMarketFactory implementation + proxy ---
  console.log("Deploying StockMarketFactory (stock price target markets)...");
  const impl = await viem.deployContract("StockMarketFactory", []);
  console.log("  StockMarketFactory implementation:", impl.address);
  const artifact = await artifacts.readArtifact("StockMarketFactory");
  const initData = encodeFunctionData({
    abi: artifact.abi,
    functionName: "initialize",
    args: [owner, tickToken, treasury, resolver] as never,
  });
  const proxy = await viem.deployContract("StockERC1967Proxy", [impl.address, initData]);
  const stockMarketFactory = proxy.address;
  console.log("  StockMarketFactory proxy:", stockMarketFactory);
  console.log("  StockMarketFactory.initialize atomically");

  // Read back the wiring so a bad deploy fails loudly here, not later.
  const factory = await viem.getContractAt("StockMarketFactory", stockMarketFactory);
  const wiredTick = (await factory.read.tick()) as string;
  const wiredTreasury = (await factory.read.treasury()) as string;
  const wiredResolver = (await factory.read.resolver()) as string;
  if (
    wiredTick.toLowerCase() !== tickToken.toLowerCase()
    || wiredTreasury.toLowerCase() !== treasury.toLowerCase()
    || wiredResolver.toLowerCase() !== resolver.toLowerCase()
  ) {
    throw new Error(
      `Wiring mismatch: tick=${wiredTick} treasury=${wiredTreasury} resolver=${wiredResolver}`,
    );
  }
  console.log("  Wiring verified: tick, treasury, resolver all match");

  // --- 2. Print .env blocks ---
  console.log("");
  console.log("=================== STOCK MARKET FACTORY DEPLOY COMPLETE ===================");
  console.log("");
  console.log("# ---- backend .env (STOCK_MARKET_) ----");
  console.log(`STOCK_MARKET_FACTORY_ADDRESS=${stockMarketFactory}`);
  console.log(`STOCK_MARKET_TICK_TOKEN_ADDRESS=${tickToken}`);
  console.log(`STOCK_MARKET_RESOLVER_ADDRESS=${resolver}`);
  console.log(`STOCK_MARKET_TREASURY_ADDRESS=${treasury}`);
  console.log("");
  console.log("# ---- frontend .env (STOCK_MARKET_) ----");
  console.log(`NEXT_PUBLIC_STOCK_MARKET_FACTORY_ADDRESS=${stockMarketFactory}`);
  console.log(`NEXT_PUBLIC_STOCK_MARKET_TICK_TOKEN_ADDRESS=${tickToken}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Update backend + frontend .env files with the STOCK_MARKET_ addresses above");
  console.log("  2. Restart the backend with the stock price target keeper enabled:");
  console.log("     it watches deadlines and calls resolve(marketId, finalPrice) from the");
  console.log("     resolver wallet, with finalPrice = Coinbase NAV at the deadline x 1e8");
  console.log("  3. Create featured boards: from the creator wallet, approve the factory for");
  console.log("     250 TICK per market, then call createMarket(token, symbol, direction,");
  console.log("     targetPrice (1e8 scale), deadline, creatorName). Deadlines must be");
  console.log("     no later than MAX_TARGET_TIME 1798761599 (Dec 31, 2026, 23:59:59 UTC)");
  console.log("  4. Crypto MarketFactory and the stock league contracts are untouched:");
  console.log("     verify no existing address changed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
