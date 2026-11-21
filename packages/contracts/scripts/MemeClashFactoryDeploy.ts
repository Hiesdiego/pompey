/**
 * TICKR Stock Meme Arena deploy (Base Sepolia).
 *
 * Step 3 of the STOCK BUILD. Deploys MemeClashFactory, the outperform
 * clash factory for the Stock Meme Arena ("Will [MEME] outperform
 * [OPPONENT]?"), as a UUPS proxy. NOTHING in the crypto league, the
 * stock league or the stock price target markets is touched: no shared
 * storage, no shared wiring. TickToken (TICK) is REUSED, never
 * redeployed, so TICK balances survive (standing rule).
 *
 * Order:
 *   1. MemeClashFactory implementation + StockERC1967Proxy, with
 *      initialize(owner, tick, treasury, resolver) encoded into the
 *      proxy constructor so initialization is atomic and cannot be
 *      front-run, exactly like StockMarketFactoryDeploy.ts.
 *   2. Print backend + frontend .env blocks (ARENA_ prefixed) and the
 *      deploy block, so the backend can index ClashCreated events from
 *      the right block.
 *
 * Wiring set at initialize (no one-time setters to call afterwards):
 *   - tick:     the reused TICK token.
 *   - treasury: receives the 3 percent treasury fee, no-staker seeds and
 *               zero-winning-staker sweeps.
 *   - resolver: the ONLY address that can resolve clashes, by submitting
 *               the four window snapshot prices (meme start and end,
 *               opponent start and end) at or after a clash's windowEnd,
 *               and the only address that can settle cup tiebreaks via
 *               resolveCupTie (the backend signer). It earns the
 *               1 percent resolver fee. Rotatable later by the owner
 *               via setResolver.
 *
 * Defaults: treasury and resolver are both the backend signer / treasury
 * address used across the stock stack,
 * 0x5219d14dfbcf0be6ec00d6b5188fff353aeb33bf (see deployed-addresses.md).
 *
 * What this does NOT do (deliberate):
 *   - Does NOT deploy TickToken or any crypto, stock league or stock
 *     market contract.
 *   - Does NOT create any clash. Creators (anyone) call createClash
 *     afterwards; each creation pulls the 250 TICK seed from the creator,
 *     so a creator wallet needs a TICK balance plus an approve of the
 *     factory first. The Weekly Meme Cup seeder creates its cup ties the
 *     same way, from the backend signer wallet.
 *   - Does NOT set fees: the defaults (3 percent treasury, 2 percent
 *     creator, 1 percent resolver) are set in initialize from
 *     MemeClashConstants. The owner can adjust them later via setFees
 *     within the 10 percent total ceiling.
 *
 * Copy this file to packages/contracts/scripts/MemeClashFactoryDeploy.ts
 * in the pompey repo before running it (it imports StockERC1967Proxy and
 * MemeClashFactory artifacts, which live beside the arena contracts).
 *
 * Usage (run by the user, from the repo root):
 *   pnpm --filter @tickr/contracts exec hardhat run scripts/MemeClashFactoryDeploy.ts --network baseSepolia
 *
 * Env overrides (all optional):
 *   TICK_TOKEN_ADDRESS     , default: testnet TICK 0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b
 *   TREASURY_ADDRESS       , default: 0x5219d14dfbcf0be6ec00d6b5188fff353aeb33bf
 *   ARENA_RESOLVER_ADDRESS (also accepts BACKEND_SIGNER_ADDRESS),
 *                            default: 0x5219d14dfbcf0be6ec00d6b5188fff353aeb33bf
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
  const treasury = address(
    "TREASURY_ADDRESS",
    process.env.TREASURY_ADDRESS ?? process.env.STOCK_TREASURY_ADDRESS ?? BACKEND_SIGNER_DEFAULT,
  );
  const resolver = address(
    "ARENA_RESOLVER_ADDRESS",
    process.env.ARENA_RESOLVER_ADDRESS
      ?? process.env.STOCK_MARKET_RESOLVER_ADDRESS
      ?? process.env.STOCK_BACKEND_SIGNER_ADDRESS
      ?? process.env.BACKEND_SIGNER_ADDRESS
      ?? BACKEND_SIGNER_DEFAULT,
  );

  console.log("Deployer :", owner);
  console.log("TickToken (reused, NOT deployed):", tickToken);
  console.log("Treasury:", treasury);
  console.log("Resolver (backend signer, submits window snapshot prices):", resolver);
  console.log("");

  // --- 1. MemeClashFactory implementation + proxy ---
  console.log("Deploying MemeClashFactory (Stock Meme Arena outperform clashes)...");
  const impl = await viem.deployContract("MemeClashFactory", []);
  console.log("  MemeClashFactory implementation:", impl.address);
  const artifact = await artifacts.readArtifact("MemeClashFactory");
  const initData = encodeFunctionData({
    abi: artifact.abi,
    functionName: "initialize",
    args: [owner, tickToken, treasury, resolver] as never,
  });
  const proxy = await viem.deployContract("StockERC1967Proxy", [impl.address, initData]);
  const memeClashFactory = proxy.address;
  console.log("  MemeClashFactory proxy:", memeClashFactory);
  console.log("  MemeClashFactory.initialize atomically");

  // The deploy block: the current head right after the proxy deployment
  // is the block the proxy was mined in (or the one right after it on a
  // fast chain). The backend indexes ClashCreated from here, and the
  // stock stack records deploy blocks the same way in its .env blocks.
  const publicClient = await viem.getPublicClient();
  const deployBlock = await publicClient.getBlockNumber();
  console.log("  Deploy block:", deployBlock.toString());

  // Read back the wiring so a bad deploy fails loudly here, not later.
  const factory = await viem.getContractAt("MemeClashFactory", memeClashFactory);
  const wiredTick = (await factory.read.tick()) as string;
  const wiredTreasury = (await factory.read.treasury()) as string;
  const wiredResolver = (await factory.read.resolver()) as string;
  const wiredOwner = (await factory.read.owner()) as string;
  if (
    wiredOwner.toLowerCase() !== owner.toLowerCase()
    || wiredTick.toLowerCase() !== tickToken.toLowerCase()
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
  console.log("=================== MEME CLASH FACTORY DEPLOY COMPLETE ===================");
  console.log("");
  console.log("# ---- backend .env (ARENA_) ----");
  console.log(`ARENA_CLASH_FACTORY_ADDRESS=${memeClashFactory}`);
  console.log(`ARENA_CLASH_FACTORY_DEPLOY_BLOCK=${deployBlock.toString()}`);
  console.log(`ARENA_TICK_TOKEN_ADDRESS=${tickToken}`);
  console.log(`ARENA_RESOLVER_ADDRESS=${resolver}`);
  console.log(`ARENA_TREASURY_ADDRESS=${treasury}`);
  console.log("");
  console.log("# ---- frontend .env (ARENA_) ----");
  console.log(`NEXT_PUBLIC_ARENA_CLASH_FACTORY_ADDRESS=${memeClashFactory}`);
  console.log(`NEXT_PUBLIC_ARENA_TICK_TOKEN_ADDRESS=${tickToken}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Update backend + frontend .env files with the ARENA_ addresses above");
  console.log("  2. Restart the backend with the arena keeper enabled:");
  console.log("     it polls the BaseStonk registry, snapshots meme prices and stock NAV");
  console.log("     at windowStart and windowEnd, and calls resolve(clashId, memeStart,");
  console.log("     memeEnd, oppStart, oppEnd) from the resolver wallet, with every price");
  console.log("     at the 1e8 scale. Cup ties whose moves are exactly equal are settled");
  console.log("     via resolveCupTie with the volume and seed tiebreak winner");
  console.log("  3. Create clashes: from the creator wallet, approve the factory for");
  console.log("     250 TICK per clash, then call createClash(memeToken, memeSymbol,");
  console.log("     opponentKind, opponentToken, opponentSymbol, windowDuration, cupTie,");
  console.log("     creatorName). windowDuration must be 3600 (blitz) or 86400 (standard)");
  console.log("  4. Crypto MarketFactory, StockMarketFactory and the league contracts");
  console.log("     are untouched: verify no existing address changed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
