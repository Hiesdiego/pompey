import { getPublicClient } from "@/hooks/usePublicClient";
import { normalizeScoreline } from "@/lib/format";
import { CONTRACTS } from "@/lib/contracts";
const SNAPSHOT_ABI = [
  {
    type: "function",
    name: "getSnapshot",
    stateMutability: "view",
    inputs: [{ name: "seasonId", type: "uint256" }, { name: "fixtureId", type: "uint256" }],
    outputs: [
      { name: "homeStart", type: "uint256" },
      { name: "awayStart", type: "uint256" },
      { name: "homeEnd", type: "uint256" },
      { name: "awayEnd", type: "uint256" },
      { name: "startSubmitted", type: "bool" },
      { name: "endSubmitted", type: "bool" },
    ],
  },
] as const;

function roundedPercentChange(start: bigint, end: bigint): number | null {
  if (start <= 0n || end <= 0n) return null;
  const basisPoints = ((end - start) * 10_000n) / start;
  const adjustment = basisPoints >= 0n ? 25n : -25n;
  return Number((basisPoints + adjustment) / 50n);
}

export async function leagueScore(id: string, season: string | number | bigint): Promise<[number, number] | null> {
  if (!CONTRACTS.priceOracle) return null;
  try {
    const snapshot = await getPublicClient().readContract({ address: CONTRACTS.priceOracle, abi: SNAPSHOT_ABI, functionName: "getSnapshot", args: [BigInt(season), BigInt(id)] });
    if (!snapshot[5]) return null;
    const home = roundedPercentChange(snapshot[0], snapshot[2]);
    const away = roundedPercentChange(snapshot[1], snapshot[3]);
    return home !== null && away !== null ? normalizeScoreline(home, away) : null;
  } catch { return null; }
}
