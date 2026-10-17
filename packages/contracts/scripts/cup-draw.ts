/**
 * Run the CRYPTO PRICE WORLD CUP draw ceremony (Base Sepolia).
 *
 * Phase 1: registry.requestDraw()  — commits to drawBlock = now + 100
 *            (the seed hash doesn't exist yet, so the draw can't be rigged).
 * Phase 2: registry.executeDraw()  — permissionless once drawBlock is mined;
 *            must land within 256 blocks of drawBlock.
 * Then prints all 32 R64 pairings (symbols + pots).
 *
 * NOTE: executing the draw CLOSES the outright champion pool
 * (stakeOutright reverts once drawExecuted is true) and OPENS R64
 * per-match staking. Run this when the outright window should end.
 *
 * Usage:
 *   pnpm draw:cup:testnet
 *
 * Env overrides (all optional):
 *   CUP_REGISTRY_ADDRESS (default: the Oct 17 testnet deployment)
 */
import "dotenv/config";
import { network } from "hardhat";

const DEFAULT_REGISTRY = "0x5f43cf7f2d4dcfe91b60c6da55ee1053b3437328";

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

  if (!(await registry.read.drawRequested())) {
    console.log("Phase 1: requesting draw...");
    console.log("requestDraw tx:", await registry.write.requestDraw());
  } else {
    console.log("Draw already requested — resuming.");
  }

  const drawBlock = await registry.read.drawBlock();
  console.log("drawBlock:", drawBlock.toString(), "(waiting for it to be mined...)");

  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    const bn = await publicClient.getBlockNumber();
    if (bn > drawBlock) break;
    if (Date.now() > deadline) throw new Error("Timed out waiting for drawBlock");
    await new Promise((r) => setTimeout(r, 5000));
  }

  const bn = await publicClient.getBlockNumber();
  if (bn > drawBlock + 256n) {
    throw new Error("drawBlock expired (>256 blocks). Re-run: requestDraw() will reset it.");
  }

  console.log(`Phase 2: executing draw at block ${bn}...`);
  console.log("executeDraw tx:", await registry.write.executeDraw());

  console.log("\n================ R64 DRAW ================");
  await printDraw(registry);
  console.log("==========================================");
  console.log("Outright pool is now CLOSED. R64 match pools are OPEN for staking.");
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
