/**
 * Run the CRYPTO PRICE WORLD CUP draw ceremony (Base Sepolia).
 *
 * Phase 1: registry.requestDraw()  — commits to drawBlock = now + 100
 *            (the seed hash doesn't exist yet, so the draw can't be rigged).
 * Phase 2: registry.executeDraw()  — permissionless once drawBlock is mined;
 *            must land within 256 blocks of drawBlock.
 * Then prints all 32 R64 pairings (symbols + pots).
 *
 * NOTE: the draw does NOT close the outright pool — it stays open until
 * the final kicks off. The draw OPENS R64 per-match staking.
 *
 * Usage:
 *   pnpm draw:cup:testnet
 *
 * Env overrides (all optional):
 *   CUP_REGISTRY_ADDRESS (default: the Oct 17 testnet deployment)
 *
 * Drop-in replacement for packages/contracts/scripts/cup-draw.ts.
 * Fixes vs the Oct 17 version:
 *   1. waits for the requestDraw receipt before reading drawBlock (the old
 *      code read it pre-mining, saw 0, and threw a bogus "drawBlock expired"
 *      error on every fresh run);
 *   2. waits for the executeDraw receipt before printing pairings (the old
 *      code printed 32 empty/TBD rows);
 *   3. a lapsed 256-block window now re-requests the draw instead of telling
 *      you to re-run into the same error forever (the contract explicitly
 *      allows re-requesting after expiry);
 *   4. the closing line no longer claims the outright pool is closed — it
 *      stays open until the final kicks off.
 */
import "dotenv/config";
import { parseAbi, parseEventLogs } from "viem";
import { network } from "hardhat";

const DEFAULT_REGISTRY = "0x45b8f0ef96b919184659bee98c7503834d167238";
const DRAW_EXECUTION_WINDOW = 256n;
const DRAW_REQUESTED_ABI = parseAbi(["event DrawRequested(uint256 indexed drawBlock)"]);

function address(name: string, fallback: string): `0x${string}` {
  const value = process.env[name]?.trim() || fallback;
  return value as `0x${string}`;
}

async function main(): Promise<void> {
  const { viem } = await network.create("baseSepolia");
  const publicClient = await viem.getPublicClient();
  const registry = await viem.getContractAt(
    "CupRegistry",
    address("CUP_REGISTRY_ADDRESS", DEFAULT_REGISTRY),
  );

  if (await registry.read.drawExecuted()) {
    console.log("Draw already executed. Current R64 pairings:");
    await printDraw(registry);
    return;
  }

  const requested = await registry.read.drawRequested();
  const now = await publicClient.getBlockNumber();
  let drawBlock = (await registry.read.drawBlock()) as bigint;

  if (requested && drawBlock === 0n) {
    throw new Error("RPC returned drawRequested=true with drawBlock=0. Wait for the RPC to catch up, then re-run.");
  }

  if (!requested || now > drawBlock + DRAW_EXECUTION_WINDOW) {
    // Fresh request, or the previous request's execution window lapsed —
    // the contract allows re-requesting after expiry, which resets drawBlock.
    console.log(
      requested
        ? "Previous draw request expired — re-requesting (resets drawBlock)..."
        : "Phase 1: requesting draw...",
    );
    const reqHash = await registry.write.requestDraw();
    console.log("requestDraw tx:", reqHash);
    const reqReceipt = await publicClient.waitForTransactionReceipt({ hash: reqHash });
    if (reqReceipt.status !== "success") {
      throw new Error(`requestDraw reverted — see tx ${reqHash}`);
    }
    const events = parseEventLogs({
      abi: DRAW_REQUESTED_ABI,
      logs: reqReceipt.logs.filter(
        (log) => log.address.toLowerCase() === registry.address.toLowerCase(),
      ),
      eventName: "DrawRequested",
      strict: true,
    });
    if (events.length !== 1) {
      throw new Error(`Expected one DrawRequested event in tx ${reqHash}, found ${events.length}`);
    }
    drawBlock = events[0].args.drawBlock;
  } else {
    console.log("Draw already requested — resuming.");
  }

  console.log("drawBlock:", drawBlock.toString(), "(waiting for it to be mined...)");

  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    const bn = await publicClient.getBlockNumber();
    if (bn > drawBlock) break;
    if (Date.now() > deadline) throw new Error("Timed out waiting for drawBlock");
    await new Promise((r) => setTimeout(r, 5000));
  }

  const bn = await publicClient.getBlockNumber();
  if (bn > drawBlock + DRAW_EXECUTION_WINDOW) {
    throw new Error("drawBlock expired (>256 blocks) before execution — re-run to re-request.");
  }

  console.log(`Phase 2: executing draw at block ${bn}...`);
  const execHash = await registry.write.executeDraw();
  console.log("executeDraw tx:", execHash);
  const execReceipt = await publicClient.waitForTransactionReceipt({ hash: execHash });
  if (execReceipt.status !== "success") {
    throw new Error(`executeDraw reverted — see tx ${execHash}`);
  }

  console.log("\n================ R64 DRAW ================");
  await printDraw(registry);
  console.log("==========================================");
  console.log(
    "Outright pool stays OPEN until the final kicks off. R64 match pools are OPEN for staking.",
  );
}

async function printDraw(registry: any): Promise<void> {
  for (let i = 0; i < 32; i++) {
    const m: any = await registry.read.getMatch([i]);
    const a: any = await registry.read.getTeam([m.teamA]);
    const b: any = await registry.read.getTeam([m.teamB]);
    console.log(
      `Match ${String(i).padStart(2, " ")}: ${a.symbol} (pot ${a.pot}) vs ${b.symbol} (pot ${b.pot})`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
