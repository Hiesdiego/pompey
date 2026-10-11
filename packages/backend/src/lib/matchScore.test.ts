import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreFromSnapshot } from "@tickr/shared/matchScore";

test("matches oracle rounding at half a goal", () => {
  assert.deepEqual(scoreFromSnapshot(10_000n, 10_000n, 10_025n, 10_000n), [1, 0]);
});

test("transfers negative goals to the opponent", () => {
  assert.deepEqual(scoreFromSnapshot(10_000n, 10_000n, 9_900n, 10_050n), [0, 3]);
  assert.deepEqual(scoreFromSnapshot(10_000n, 10_000n, 9_900n, 9_900n), [2, 2]);
});
