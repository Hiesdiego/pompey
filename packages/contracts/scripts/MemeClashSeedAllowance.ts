/** Set a finite TICK allowance for the backend signer to seed Arena clashes. */
import { network } from "hardhat";
import { isAddress, parseEther } from "viem";

const tokenAddress = "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b";
const factoryAddress = process.env.ARENA_CLASH_FACTORY_ADDRESS;
const targetTick = process.env.ARENA_SEED_ALLOWANCE_TICK ?? "25000";

async function main(): Promise<void> {
  if (!factoryAddress || !isAddress(factoryAddress, { strict: false })) {
    throw new Error("Set ARENA_CLASH_FACTORY_ADDRESS to the deployed Arena proxy");
  }
  if (!/^\d+$/.test(targetTick) || BigInt(targetTick) <= 0n) {
    throw new Error("ARENA_SEED_ALLOWANCE_TICK must be a positive whole TICK amount");
  }

  const { viem } = await network.create("baseSepolia");
  const [signer] = await viem.getWalletClients();
  if (!signer?.account) throw new Error("No backend signer account configured");
  const expectedResolver = process.env.ARENA_RESOLVER_ADDRESS;
  if (expectedResolver && signer.account.address.toLowerCase() !== expectedResolver.toLowerCase()) {
    throw new Error("Configured contracts signer is not ARENA_RESOLVER_ADDRESS; refusing approval");
  }

  const amount = parseEther(targetTick);
  const tick = await viem.getContractAt("TickToken", tokenAddress);
  const client = await viem.getPublicClient();
  const [balance, allowance] = await Promise.all([
    tick.read.balanceOf([signer.account.address]) as Promise<bigint>,
    tick.read.allowance([signer.account.address, factoryAddress]) as Promise<bigint>,
  ]);
  if (balance < amount) {
    throw new Error(`Backend signer has ${balance / 10n ** 18n} TICK; ${targetTick} TICK is required for the configured cap`);
  }
  if (allowance >= amount) {
    console.log(`Arena seed allowance is already at least ${targetTick} TICK; no transaction sent.`);
    return;
  }

  const hash = await tick.write.approve([factoryAddress, amount]);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Approval transaction failed: ${hash}`);
  const verified = await tick.read.allowance([signer.account.address, factoryAddress]) as bigint;
  if (verified < amount) throw new Error("Approval mined but the verified allowance is below the requested cap");
  console.log(`Approved a finite ${targetTick} TICK Arena seed allowance.`);
  console.log(`Transaction: ${hash}`);
  console.log(`Verified allowance: ${verified / 10n ** 18n} TICK`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
