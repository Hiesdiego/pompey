import { test } from "node:test";
import { strict as assert } from "node:assert";
import { commentaryCompletion, prepareCommentary } from "./cupCommentaryGeneration.js";

const facts = { teamA: "BTC", teamB: "NEAR", scoreA: 2, scoreB: 0, minute: 16 };

test("reasoning models get room to speak and low reasoning effort", () => {
  assert.deepEqual(commentaryCompletion("openai/gpt-oss-20b"), { max_completion_tokens: 768, reasoning_effort: "low" });
  assert.equal(commentaryCompletion("openai/gpt-oss-120b", "1024").max_completion_tokens, 1024);
  assert.deepEqual(commentaryCompletion("other-model"), { max_completion_tokens: 160 });
  assert.equal(commentaryCompletion("openai/gpt-oss-20b", "NaN").max_completion_tokens, 768);
});

test("fresh commentary need not recite the scoreboard or address Dee", () => {
  assert.equal(prepareCommentary("NEAR brought a whitepaper to a knife fight.", facts), "NEAR brought a whitepaper to a knife fight. (BTC 2-0 NEAR, 16').");
});

test("accepts normal score punctuation without changing match facts", () => {
  assert.equal(prepareCommentary("BTC lead 2 – 0 in the 16th minute.", facts), "BTC lead 2-0 in the 16th minute.");
  assert.equal(prepareCommentary("BTC lead 3-0 in the 16th minute.", facts), null);
  assert.equal(prepareCommentary("x".repeat(280), facts), null);
});
