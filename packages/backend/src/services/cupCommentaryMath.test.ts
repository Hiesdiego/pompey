import { test } from "node:test";
import { strict as assert } from "node:assert";
import { cupLiveScore, cupTieWinner } from "./cupCommentaryMath.js";

test("cup commentary uses the contract's half-up scoring and loss normalization", () => {
  assert.deepEqual(cupLiveScore(10_000n, 10_000n, 10_025n, 10_000n).scoreA, 1);
  const loss = cupLiveScore(10_000n, 10_000n, 10_000n, 9_975n);
  assert.equal(loss.scoreA, 1);
  assert.equal(loss.scoreB, 0);
  assert.equal(cupLiveScore(10_000n, 10_000n, 10_024n, 10_000n).scoreA, 0);
});

test("draws advance the better full precision mover, then lower team id", () => {
  assert.equal(cupTieWinner(7, 3, 10_000n, 20_000n, 10_010n, 20_010n), 7);
  assert.equal(cupTieWinner(7, 3, 10_000n, 20_000n, 10_010n, 20_020n), 3);
});
