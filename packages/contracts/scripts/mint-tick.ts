/**
 * Mint testnet TICK to any wallet. Caller must be the TickToken owner.
 * Usage: DEV_WALLET=0x... MINT_AMOUNT_TICK=1000000 pnpm mint:tick:testnet
 */
import { network } from "hardhat";
import { isAddress, parseUnits } from "viem";

const TICK_TOKEN = "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b"; // reused across redeploys

async function main() {
  const to = process.env.DEV_WALLET;
  if (!to || !isAddress(to, { strict: false }))
    throw new Error('Set DEV_WALLET env to the recipient address');
  const amount = parseUnits(process.env.MINT_AMOUNT_TICK ?? "1000000", 18);

  const { viem } = await network.create("baseSepolia");
  const tick = await viem.getContractAt("TickToken", TICK_TOKEN as `0x${string}`);
  console.log("TickToken owner:", await tick.read.owner());

  const hash = await tick.write.mint([to as `0x${string}`, amount]);
  const receipt = await (await viem.getPublicClient()).waitForTransactionReceipt({ hash });
  console.log("mint status:", receipt.status);

  const bal = await tick.read.balanceOf([to as `0x${string}`]);
  console.log(`Balance of ${to}: ${Number(bal) / 1e18} TICK`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
