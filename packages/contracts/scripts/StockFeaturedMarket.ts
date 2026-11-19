import { network } from "hardhat";
import { formatUnits, parseUnits } from "viem";

const FACTORY = "0x8b7673bb0f04bc52b3f7f8b622969b6be5df3e0c" as const;
const TICK = "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b" as const;
const NVDA_TOKEN = "0xb20000000000000000000078ee7ce2fE4908108C" as const;
const TARGET = 18_000_000_000n; // $180.00 at 1e8 scale
const DEADLINE = BigInt(Math.floor(Date.parse("2026-12-20T23:59:00Z") / 1000));
const SEED = parseUnits("250", 18);

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
const factoryAbi = [
  { type: "function", name: "tick", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "marketCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "activeMarket", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint8" }, { type: "uint256" }, { type: "uint64" }], outputs: [{ type: "bool" }, { type: "uint256" }] },
  { type: "function", name: "createdMarket", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint8" }, { type: "uint256" }, { type: "uint64" }], outputs: [{ type: "bool" }, { type: "uint256" }] },
  { type: "function", name: "createMarket", stateMutability: "nonpayable", inputs: [{ name: "stockToken", type: "address" }, { name: "stockSymbol", type: "string" }, { name: "direction", type: "uint8" }, { name: "targetPrice", type: "uint256" }, { name: "deadline", type: "uint64" }, { name: "creatorName", type: "string" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "marketInfo", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }, { type: "string" }, { type: "uint8" }, { type: "uint256" }, { type: "address" }, { type: "string" }, { type: "uint64" }, { type: "uint64" }, { type: "uint64" }, { type: "uint64" }, { type: "uint8" }] },
  { type: "function", name: "marketSettlement", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint8" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
] as const;

async function main() {
  const { viem } = await network.create("baseSepolia");
  const [wallet] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  if (!wallet.account) throw new Error("No configured deployer wallet");
  const creator = wallet.account.address;
  const [wiredTick, balance, allowance, active, created, count, latestBlock] = await Promise.all([
    publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tick" }),
    publicClient.readContract({ address: TICK, abi: erc20Abi, functionName: "balanceOf", args: [creator] }),
    publicClient.readContract({ address: TICK, abi: erc20Abi, functionName: "allowance", args: [creator, FACTORY] }),
    publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "activeMarket", args: [NVDA_TOKEN, 0, TARGET, DEADLINE] }),
    publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "createdMarket", args: [NVDA_TOKEN, 0, TARGET, DEADLINE] }),
    publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "marketCount" }),
    publicClient.getBlock({ blockTag: "latest" }),
  ]);
  if (wiredTick.toLowerCase() !== TICK.toLowerCase()) throw new Error(`Factory TICK wiring mismatch: ${wiredTick}`);
  console.log(JSON.stringify({
    mode: process.env.STOCK_FEATURED_SUBMIT === "1" ? "submit" : "preflight",
    network: "Base Sepolia", creator, factory: FACTORY, tick: wiredTick, nvdaToken: NVDA_TOKEN,
    terms: { symbol: "NVDAc", direction: "Above", targetUsd: "180", deadlineUtc: "2026-12-20T23:59:00Z", deadlineUnix: DEADLINE.toString(), seedTICK: "250" },
    walletTickBalance: formatUnits(balance, 18), allowanceTICK: formatUnits(allowance, 18),
    activeMarket: active[0] ? active[1].toString() : null, previouslyCreatedMarket: created[0] ? created[1].toString() : null,
    marketCount: count.toString(), block: latestBlock.number?.toString(), chainTimeUtc: new Date(Number(latestBlock.timestamp) * 1000).toISOString(),
  }, null, 2));

  if (process.env.STOCK_FEATURED_SUBMIT !== "1") return;
  if (balance < SEED) throw new Error("Creator wallet has less than 250 TICK; no transactions sent");
  if (created[0]) throw new Error(`Exact terms already created as market ${created[1]}; no transactions sent`);
  let currentAllowance = allowance;
  if (currentAllowance < SEED) {
    const approvalHash = await wallet.writeContract({ address: TICK, abi: erc20Abi, functionName: "approve", args: [FACTORY, SEED] });
    await publicClient.waitForTransactionReceipt({ hash: approvalHash });
    currentAllowance = await publicClient.readContract({ address: TICK, abi: erc20Abi, functionName: "allowance", args: [creator, FACTORY] });
    if (currentAllowance < SEED) throw new Error(`Approval not reflected (${approvalHash}); createMarket not sent`);
  }
  const hash = await wallet.writeContract({ address: FACTORY, abi: factoryAbi, functionName: "createMarket", args: [NVDA_TOKEN, "NVDAc", 0, TARGET, DEADLINE, "TICKR"] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`createMarket reverted: ${hash}`);
  const marketId = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "marketCount" }).then((n) => n - 1n);
  const [info, settlement, duplicate] = await Promise.all([
    publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "marketInfo", args: [marketId] }),
    publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "marketSettlement", args: [marketId] }),
    publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "createdMarket", args: [NVDA_TOKEN, 0, TARGET, DEADLINE] }),
  ]);
  if (info[0].toLowerCase() !== NVDA_TOKEN.toLowerCase() || info[2] !== 0 || info[3] !== TARGET || info[8] !== DEADLINE || settlement[0] !== SEED || !duplicate[0] || duplicate[1] !== marketId) {
    throw new Error(`Post-create verification failed for market ${marketId} (${hash})`);
  }
  console.log(JSON.stringify({ created: true, marketId: marketId.toString(), txHash: hash, block: receipt.blockNumber.toString(), seedTICK: formatUnits(settlement[0], 18), totalStakedTICK: formatUnits(settlement[1], 18), status: settlement[2] === 0 ? "Open" : settlement[2] }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "featured market operation failed"); process.exitCode = 1; });
