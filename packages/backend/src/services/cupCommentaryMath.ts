export function cupLiveScore(startA: bigint, startB: bigint, priceA: bigint, priceB: bigint) {
  if (startA <= 0n || startB <= 0n || priceA <= 0n || priceB <= 0n) throw new Error("Invalid cup price");
  const changeA = ((priceA - startA) * 10_000n) / startA;
  const changeB = ((priceB - startB) * 10_000n) / startB;
  const round = (bps: bigint) => Number((bps >= 0n ? bps + 25n : bps - 25n) / 50n);
  const rawA = round(changeA);
  const rawB = round(changeB);
  return {
    scoreA: Math.max(rawA, 0) + Math.max(-rawB, 0),
    scoreB: Math.max(rawB, 0) + Math.max(-rawA, 0),
    moveA: Number(changeA) / 100,
    moveB: Number(changeB) / 100,
  };
}

export function cupTieWinner(teamA: number, teamB: number, startA: bigint, startB: bigint, endA: bigint, endB: bigint) {
  const moveA = (endA - startA) * startB;
  const moveB = (endB - startB) * startA;
  return moveA === moveB ? Math.min(teamA, teamB) : moveA > moveB ? teamA : teamB;
}
