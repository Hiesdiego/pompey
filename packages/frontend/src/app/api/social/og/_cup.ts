import { TICKR_TEAMS } from "@tickr/shared/teams";
import { CUP_TEAMS, CUP_CONTRACTS, CUP_REGISTRY_ABI } from "@/lib/cup";
import { getPublicClient } from "@/hooks/usePublicClient";

export function cupCmcId(id: number): number | undefined {
  const extras: Record<number, number> = { 32: 36341, 33: 33251, 38: 32782, 49: 27750, 60: 34466 };
  const symbol = CUP_TEAMS.find(t => t.teamId === id)?.symbol;
  return extras[id] ?? TICKR_TEAMS.find(t => t.symbol === (symbol === "TRON" ? "TRX" : symbol === "PENGUIN" ? "PENGU" : symbol))?.cmcId;
}

export async function cupMatch(id: string) {
  if (!/^(0|[1-9]\d?)$/.test(id) || Number(id) > 62 || !CUP_CONTRACTS.registry) return null;
  try {
    return await getPublicClient().readContract({ address: CUP_CONTRACTS.registry, abi: CUP_REGISTRY_ABI, functionName: "getMatch", args: [Number(id)] });
  } catch { return null; }
}
