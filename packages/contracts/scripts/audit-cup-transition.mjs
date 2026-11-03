import "dotenv/config";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });
const registry = process.env.CUP_REGISTRY_ADDRESS;
const pool = process.env.CUP_POOL_ADDRESS;
if (!registry || !pool) throw new Error("CUP_REGISTRY_ADDRESS and CUP_POOL_ADDRESS are required");

const registryAbi = [
  { type: "function", name: "drawExecuted", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "tournamentComplete", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "getMatch", stateMutability: "view", inputs: [{ name: "matchId", type: "uint16" }], outputs: [{ type: "tuple", components: [
    { name: "teamA", type: "uint16" }, { name: "teamB", type: "uint16" }, { name: "feederA", type: "uint16" }, { name: "feederB", type: "uint16" },
    { name: "winner", type: "uint16" }, { name: "kickoffTimestamp", type: "uint64" }, { name: "endTimestamp", type: "uint64" },
    { name: "state", type: "uint8" }, { name: "goalsA", type: "int16" }, { name: "goalsB", type: "int16" },
  ] }] },
];
const poolAbi = [
  { type: "function", name: "getMatchPool", stateMutability: "view", inputs: [{ name: "matchId", type: "uint16" }], outputs: [{ type: "tuple", components: [
    { name: "totalA", type: "uint256" }, { name: "totalB", type: "uint256" }, { name: "seed", type: "uint256" }, { name: "settled", type: "bool" }, { name: "winner", type: "uint16" },
  ] }] },
  { type: "function", name: "getOutrightTotal", stateMutability: "view", inputs: [{ name: "teamId", type: "uint16" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "liveMatchStakingEnabled", stateMutability: "pure", inputs: [], outputs: [{ type: "bool" }] },
];

const [block, drawExecuted, tournamentComplete] = await Promise.all([
  client.getBlockNumber(),
  client.readContract({ address: registry, abi: registryAbi, functionName: "drawExecuted" }),
  client.readContract({ address: registry, abi: registryAbi, functionName: "tournamentComplete" }),
]);
let liveStakingEnabled = false;
try { liveStakingEnabled = await client.readContract({ address: pool, abi: poolAbi, functionName: "liveMatchStakingEnabled" }); } catch { /* Old pools lack this function. */ }
const matches = [];
let matchStakes = 0n;
let matchSeeds = 0n;
for (let start = 0; start < 63; start += 8) {
  const rows = await Promise.all(Array.from({ length: Math.min(8, 63 - start) }, async (_, offset) => {
    const id = start + offset;
    const [match, stake] = await Promise.all([
      client.readContract({ address: registry, abi: registryAbi, functionName: "getMatch", args: [id] }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "getMatchPool", args: [id] }),
    ]);
    return { id, match, stake };
  }));
  for (const { id, match, stake } of rows) {
    matchStakes += stake.totalA + stake.totalB;
    matchSeeds += stake.seed;
    if (stake.totalA + stake.totalB > 0n || match.state !== 0) matches.push({ id, state: match.state, kickoff: Number(match.kickoffTimestamp), end: Number(match.endTimestamp), stakesTick: Number(stake.totalA + stake.totalB) / 1e18, seedTick: Number(stake.seed) / 1e18, settled: stake.settled });
  }
}
let outrightStakes = 0n;
for (let start = 0; start < 64; start += 8) {
  const totals = await Promise.all(Array.from({ length: 8 }, (_, offset) => client.readContract({ address: pool, abi: poolAbi, functionName: "getOutrightTotal", args: [start + offset] })));
  for (const total of totals) outrightStakes += total;
}
console.log(JSON.stringify({ chain: "baseSepolia", block: String(block), registry, pool, drawExecuted, tournamentComplete, liveStakingEnabled, matchStakesTick: Number(matchStakes) / 1e18, matchSeedsTick: Number(matchSeeds) / 1e18, outrightStakesTick: Number(outrightStakes) / 1e18, matches }, null, 2));
