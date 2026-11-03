/** Deploy a match staking sidecar against the active CupRegistry. */
import "dotenv/config";
import { isAddress } from "viem";
import { network } from "hardhat";

function requiredAddress(name: string, fallback?: string): `0x${string}` {
  const value = process.env[name]?.trim() || fallback;
  if (!value || !isAddress(value, { strict: false })) throw new Error(`Missing or invalid ${name}`);
  return value as `0x${string}`;
}

async function main(): Promise<void> {
  const { viem } = await network.create("baseSepolia");
  const [wallet] = await viem.getWalletClients();
  if (!wallet?.account) throw new Error("No deployer configured");
  const owner = wallet.account.address;
  const registry = requiredAddress("CUP_REGISTRY_ADDRESS", "0x45b8f0ef96b919184659bee98c7503834d167238");
  const tick = requiredAddress("CUP_TICK_TOKEN", "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b");
  const treasury = requiredAddress("CUP_TREASURY", owner);
  const publicClient = await viem.getPublicClient();
  const registryCode = await publicClient.getBytecode({ address: registry });
  const tickCode = await publicClient.getBytecode({ address: tick });
  if (!registryCode || !tickCode) throw new Error("Registry or TICK contract is missing on this chain");
  const pool = await viem.deployContract("CupPool", [owner, tick, registry, treasury]);
  console.log(`CUP_MATCH_POOL_ADDRESS=${pool.address}`);
  console.log(`NEXT_PUBLIC_CUP_MATCH_POOL_ADDRESS=${pool.address}`);
  console.log("Original CupRegistry, CupEngine, CupPool and existing claims remain in place.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
