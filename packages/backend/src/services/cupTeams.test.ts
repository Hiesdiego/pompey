import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CUP_TEAM_NAMES, cupRoundName } from "./cupTeams.js";

test("broadcast identities cover all 64 teams in oracle order", () => {
  assert.equal(CUP_TEAM_NAMES.length, 64);
  assert.equal(new Set(CUP_TEAM_NAMES).size, 64);
  assert.equal(CUP_TEAM_NAMES[0], "Bitcoin");
  assert.equal(CUP_TEAM_NAMES[22], "Toncoin");
  assert.equal(CUP_TEAM_NAMES[60], "Pudgy Penguins");
});

test("round labels follow every knockout boundary including the Final", () => {
  for (const [id, round] of [[0, "Round of 64"], [31, "Round of 64"], [32, "Round of 32"], [47, "Round of 32"], [48, "Round of 16"], [55, "Round of 16"], [56, "Quarter-final"], [59, "Quarter-final"], [60, "Semi-final"], [61, "Semi-final"], [62, "Final"]] as const) {
    assert.equal(cupRoundName(id), round);
  }
});
