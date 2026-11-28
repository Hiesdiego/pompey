import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { canonicalMarketTerms } from "./marketCreation";
import { priceTargetQuestion } from "./priceTargetQuestion";
import { stockPriceTargetQuestion } from "./stockMarketContracts";

test("champion terms ignore trailing bytes and preserve the season", () => {
  const encode = (season: bigint) => encodeAbiParameters(parseAbiParameters("uint256"), [season]);
  assert.equal(canonicalMarketTerms(1, encode(2n)), canonicalMarketTerms(1, `${encode(2n)}01`));
  assert.notEqual(canonicalMarketTerms(1, encode(2n)), canonicalMarketTerms(1, encode(3n)));
});

test("price targets match the exact deadline, asset, price and direction", () => {
  const encode = (at: bigint, above = true) => encodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), [0, 100000000n, at, above]);
  const key = canonicalMarketTerms(3, encode(1800000000n));
  assert.equal(key, canonicalMarketTerms(3, `${encode(1800000000n)}abcd`));
  assert.notEqual(key, canonicalMarketTerms(3, encode(1800000060n)));
  assert.notEqual(key, canonicalMarketTerms(3, encode(1800000000n, false)));
});

test("questions show inclusive below targets and explicit UTC deadline periods", () => {
  assert.equal(priceTargetQuestion("BTC", 100000, false, new Date("2026-11-30T23:59:00Z")), "Will BTC finish at or below $100,000 at the end of November 2026 (UTC)?");
  assert.match(priceTargetQuestion("BTC", 100000, true, new Date("2026-12-31T23:59:00Z")), /at or above.*at the end of 2026/);
  assert.match(priceTargetQuestion("BTC", 100000, false, new Date("2026-11-30T14:30:00Z")), /Nov 30, 2026 at 2:30 PM UTC/);
  assert.match(stockPriceTargetQuestion("NVDA", 15000000000n, false, new Date("2026-11-30T23:59:00Z")), /finish at or below \$150 at the end of November/);
  assert.match(stockPriceTargetQuestion("NVDA", 15000000000n, true, new Date("2026-11-30T23:59:00Z")), /finish above \$150/);
});
