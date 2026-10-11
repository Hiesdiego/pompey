/** Mirrors PriceOracle's integer basis-point and 0.5% goal rounding. */
export function scoreFromSnapshot(homeStart: bigint, awayStart: bigint, homeEnd: bigint, awayEnd: bigint): [number, number] {
  const roundedGoals = (start: bigint, end: bigint): number => {
    const bps = ((end - start) * 10_000n) / start;
    return Number(bps >= 0n ? (bps + 25n) / 50n : (bps - 25n) / 50n);
  };
  const home = roundedGoals(homeStart, homeEnd);
  const away = roundedGoals(awayStart, awayEnd);
  return [Math.max(0, home) + Math.max(0, -away), Math.max(0, away) + Math.max(0, -home)];
}
