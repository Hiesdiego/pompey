import { test } from "node:test";
import { strict as assert } from "node:assert";
import { calculatePredictorRanks, type RankStake } from "./predictorRank";

const stake = (staker: string, market_id: number, outcome: number, state: string, bitmap: string): RankStake =>
  ({ staker, market_id, outcome, markets: { state, winner_bitmap: bitmap } });

test("one win per resolved market, with repeat stakes and voids ignored", () => {
  const scores = calculatePredictorRanks([
    stake("0xAa", 1, 0, "resolved", "1"), stake("0xAA", 1, 0, "resolved", "1"),
    stake("0xaa", 1, 1, "resolved", "1"), stake("0xbb", 2, 1, "resolved", "2"),
    stake("0xbb", 6, 0, "resolved", "2"),
    stake("0xaa", 3, 0, "voided", "1"), stake("0xbb", 4, 0, "open", "1"),
    stake("0xcc", 5, 0, "resolved", "2"),
  ]);
  assert.deepEqual(scores.map(({ wallet, points, correct, settled, rank }) => ({ wallet, points, correct, settled, rank })), [
    { wallet: "0xaa", points: 3, correct: 1, settled: 1, rank: 1 },
    { wallet: "0xbb", points: 3, correct: 1, settled: 2, rank: 1 },
    { wallet: "0xcc", points: 0, correct: 0, settled: 1, rank: 3 },
  ]);
});
