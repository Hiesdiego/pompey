import "dotenv/config";
import { createPublicClient, http, parseAbi } from "viem";

const client = createPublicClient({
  transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://base-sepolia-rpc.publicnode.com"),
});
const registry = process.env.CUP_REGISTRY_ADDRESS || "0x45b8f0ef96b919184659bee98c7503834d167238";
const pool = process.env.CUP_POOL_ADDRESS || "0x9b2527c88f806fe34c166edb4784f60483b0864b";
const registryAbi = parseAbi([
  "function tournamentComplete() view returns (bool)",
  "function drawExecuted() view returns (bool)",
  "function getMatch(uint16) view returns ((uint16 teamA,uint16 teamB,uint16 feederA,uint16 feederB,uint16 winner,uint64 kickoffTimestamp,uint64 endTimestamp,uint8 state,uint8 goalsA,uint8 goalsB))",
]);
const poolAbi = parseAbi(["function outrightSettled() view returns (bool)"]);
const [complete, draw, final, settled, block] = await Promise.all([
  client.readContract({ address: registry, abi: registryAbi, functionName: "tournamentComplete" }),
  client.readContract({ address: registry, abi: registryAbi, functionName: "drawExecuted" }),
  client.readContract({ address: registry, abi: registryAbi, functionName: "getMatch", args: [62] }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "outrightSettled" }),
  client.getBlock(),
]);
console.log(JSON.stringify({
  drawExecuted: draw,
  tournamentComplete: complete,
  outrightSettled: settled,
  finalKickoff: final.kickoffTimestamp === 0n ? null : new Date(Number(final.kickoffTimestamp) * 1000).toISOString(),
  outrightOpen: !complete && (final.kickoffTimestamp === 0n || block.timestamp < final.kickoffTimestamp),
}, null, 2));
