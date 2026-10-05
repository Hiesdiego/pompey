/** Projected MarketFactory payout for a new stake, assuming this is the only winning outcome. */
export function marketOdds(input: {
  stake: bigint;
  sideStaked: bigint;
  totalStaked: bigint;
  seed: bigint;
  feesBps: readonly [number, number, number];
}): { payout: bigint; multiplier: number } | null {
  const { stake, sideStaked, totalStaked, seed, feesBps } = input;
  if (stake <= 0n || sideStaked < 0n || totalStaked < sideStaked || seed < 0n) return null;
  if (feesBps.some((fee) => !Number.isInteger(fee) || fee < 0) || feesBps.reduce((sum, fee) => sum + fee, 0) > 1000) return null;
  const stakedAfter = totalStaked + stake;
  const fees = feesBps.reduce((sum, fee) => sum + stakedAfter * BigInt(fee) / 10_000n, 0n);
  const distributable = stakedAfter - fees + seed;
  const payoutPerShare = distributable * 10n ** 18n / (sideStaked + stake);
  const payout = stake * payoutPerShare / 10n ** 18n;
  return { payout, multiplier: Number(payoutPerShare) / 1e18 };
}

export function formatMarketOdds(multiplier: number | null): string {
  if (multiplier === null || !Number.isFinite(multiplier)) return "—";
  if (multiplier > 0 && multiplier < 0.005) return "<0.01×";
  return multiplier >= 1000 ? `${Math.floor(multiplier).toLocaleString()}×` : `${multiplier.toFixed(2)}×`;
}

/** Spotlight a side only when it has <=20% of a meaningful staked pool. */
export function isHighPayout(multiplier: number | null, totalStaked: bigint, referenceStake: bigint, sideStaked: bigint): boolean {
  return multiplier !== null && multiplier >= 5 && totalStaked >= referenceStake * 5n && sideStaked * 5n <= totalStaked;
}
