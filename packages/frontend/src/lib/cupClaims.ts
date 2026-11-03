import { BaseError, ContractFunctionRevertedError, type Address } from "viem";
import { getPublicClient } from "../hooks/usePublicClient";
import { CUP_CONTRACTS, CUP_POOL_ABI, CUP_REGISTRY_ABI, CUP_STATE } from "./cup";

export interface ClaimableCupMatch {
  kind: "cup";
  poolAddress: Address;
  matchId: number;
  teamA: number;
  teamB: number;
  amount: bigint;
}

export async function scanCupClaims(player: Address): Promise<ClaimableCupMatch[]> {
  if (!CUP_CONTRACTS.registry) return [];
  const pools = [...new Set(
    [CUP_CONTRACTS.matchPool, CUP_CONTRACTS.pool].filter(Boolean).map((address) => address.toLowerCase() as Address)
  )];
  if (!pools.length) return [];
  const client = getPublicClient();
  const matches = await client.multicall({
    contracts: Array.from({ length: 63 }, (_, matchId) => ({
      address: CUP_CONTRACTS.registry as Address,
      abi: CUP_REGISTRY_ABI,
      functionName: "getMatch" as const,
      args: [matchId] as const,
    })),
    allowFailure: false,
  });
  const claims: ClaimableCupMatch[] = [];
  for (const poolAddress of pools) {
    const fee = await client.readContract({ address: poolAddress, abi: CUP_POOL_ABI, functionName: "platformFeeBps" });
    const settled = matches.flatMap((match, matchId) => match.state === CUP_STATE.Settled ? [{ match, matchId }] : []);
    for (let offset = 0; offset < settled.length; offset += 25) {
      const chunk = settled.slice(offset, offset + 25);
      const stakes = await client.multicall({
        contracts: chunk.map(({ match, matchId }) => ({
          address: poolAddress, abi: CUP_POOL_ABI, functionName: "getMatchStake" as const,
          args: [matchId, player, match.winner === match.teamA ? 0 : 1] as const,
        })),
        allowFailure: false,
      });
      await Promise.all(chunk.map(async ({ match, matchId }, index) => {
        if (stakes[index] === 0n) return;
        // Claimed flags are private. Simulating also covers lazy pool settlement.
        try {
          await client.simulateContract({ address: poolAddress, abi: CUP_POOL_ABI, functionName: "claimMatch", args: [matchId], account: player });
        } catch (error) {
          const revert = error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : null;
          if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName === "AlreadyClaimed") return;
          throw error;
        }
        const pool = await client.readContract({ address: poolAddress, abi: CUP_POOL_ABI, functionName: "getMatchPool", args: [matchId] });
        const winningTotal = match.winner === match.teamA ? pool.totalA : pool.totalB;
        const distributable = (pool.totalA + pool.totalB + pool.seed) * (10_000n - fee) / 10_000n;
        const amount = stakes[index] * distributable / winningTotal;
        if (amount > 0n) claims.push({ kind: "cup", poolAddress, matchId, teamA: match.teamA, teamB: match.teamB, amount });
      }));
    }
  }
  return claims.sort((a, b) => a.matchId - b.matchId || a.poolAddress.localeCompare(b.poolAddress));
}
