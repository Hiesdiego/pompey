import { scoreFromSnapshot } from "@tickr/shared/matchScore";
import type { ApiFixture, ApiFixtureForm, ApiFormEntry } from "./api";
import { api } from "./api";
import { CONTRACTS } from "./contracts";
import { getPublicClient } from "../hooks/usePublicClient";

const SNAPSHOT_ABI = [{
  type: "function",
  name: "getSnapshot",
  stateMutability: "view",
  inputs: [{ name: "seasonId", type: "uint256" }, { name: "fixtureId", type: "uint256" }],
  outputs: [{ type: "tuple", components: [
    { name: "homeStart", type: "uint256" }, { name: "awayStart", type: "uint256" },
    { name: "homeEnd", type: "uint256" }, { name: "awayEnd", type: "uint256" },
    { name: "startSubmitted", type: "bool" }, { name: "endSubmitted", type: "bool" },
  ] }],
}] as const;

export async function getRecentFormDirect(fixture: ApiFixture): Promise<ApiFixtureForm> {
  if (!fixture.home || !fixture.away || !CONTRACTS.priceOracle) throw new Error("Missing fixture or oracle");
  const fixtures = await api.fixtures();
  const settled = fixtures.filter((item) => item.seasonId === fixture.seasonId && item.settled && !item.voided && item.home && item.away);
  const latestFor = (teamId: number) => settled
    .filter((item) => item.home?.teamId === teamId || item.away?.teamId === teamId)
    .sort((a, b) => Date.parse(b.kickoff ?? b.windowEnd) - Date.parse(a.kickoff ?? a.windowEnd) || Number(BigInt(b.fixtureId) - BigInt(a.fixtureId)))
    .slice(0, 5);
  const candidates = [...new Map([...latestFor(fixture.home.teamId), ...latestFor(fixture.away.teamId)]
    .map((item) => [item.fixtureId, item])).values()];
  if (candidates.length === 0) return { ready: true, home: [], away: [] };
  const snapshots = await getPublicClient().multicall({
    contracts: candidates.map((item) => ({
      address: CONTRACTS.priceOracle as `0x${string}`,
      abi: SNAPSHOT_ABI,
      functionName: "getSnapshot" as const,
      args: [BigInt(fixture.seasonId), BigInt(item.fixtureId)] as const,
    })),
    allowFailure: true,
  });
  if (snapshots.every((item) => item.status === "failure")) throw new Error("Oracle snapshots unavailable");
  const scored = candidates.flatMap((item, index) => {
    const response = snapshots[index];
    if (response.status !== "success" || !item.home || !item.away) return [];
    const snapshot = response.result;
    if (!snapshot.endSubmitted || snapshot.homeStart === 0n || snapshot.awayStart === 0n) return [];
    const [homeGoals, awayGoals] = scoreFromSnapshot(snapshot.homeStart, snapshot.awayStart, snapshot.homeEnd, snapshot.awayEnd);
    return [{ item, homeGoals, awayGoals }];
  });
  const recent = (teamId: number): ApiFormEntry[] => scored
    .filter(({ item }) => item.home?.teamId === teamId || item.away?.teamId === teamId)
    .sort((a, b) => Date.parse(b.item.kickoff ?? b.item.windowEnd) - Date.parse(a.item.kickoff ?? a.item.windowEnd))
    .slice(0, 5)
    .map(({ item, homeGoals, awayGoals }) => {
      const isHome = item.home!.teamId === teamId;
      const goalsFor = isHome ? homeGoals : awayGoals;
      const goalsAgainst = isHome ? awayGoals : homeGoals;
      return {
        fixtureId: item.fixtureId,
        opponentTeamId: isHome ? item.away!.teamId : item.home!.teamId,
        result: goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D",
        goalsFor,
        goalsAgainst,
      };
    });
  return { ready: true, home: recent(fixture.home.teamId), away: recent(fixture.away.teamId) };
}
