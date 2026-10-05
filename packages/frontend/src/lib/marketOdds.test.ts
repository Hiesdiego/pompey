import assert from "node:assert/strict";
import test from "node:test";
import { marketOdds, isHighPayout } from "./marketOdds";

const tick = 10n ** 18n;
const fees = [300, 200, 100] as const;

test("first stake gets the full seed and only staked volume pays fees", () => {
  const quote = marketOdds({ stake: 100n * tick, sideStaked: 0n, totalStaked: 0n, seed: 250n * tick, feesBps: fees });
  assert.equal(quote?.multiplier, 3.44);
  assert.equal(quote?.payout, 344n * tick);
});

test("quote includes the user's stake in both pool and chosen side", () => {
  const quote = marketOdds({ stake: 100n * tick, sideStaked: 100n * tick, totalStaked: 1000n * tick, seed: 250n * tick, feesBps: fees });
  assert.equal(quote?.multiplier, 6.42);
  assert.equal(quote?.payout, 642n * tick);
});

test("high payout requires a meaningful pool", () => {
  assert.equal(isHighPayout(20, 10n * tick, 10n * tick, 0n), false);
  assert.equal(isHighPayout(5, 50n * tick, 10n * tick, 10n * tick), true);
  assert.equal(isHighPayout(9, 50n * tick, 10n * tick, 25n * tick), false);
});

test("uses each contract fee's integer floor before the payout-per-share floor", () => {
  const quote = marketOdds({ stake: 101n, sideStaked: 0n, totalStaked: 0n, seed: 0n, feesBps: fees });
  assert.equal(quote?.payout, 94n);
});
