import assert from "node:assert/strict";
import test from "node:test";
import { formatPriceTargetUsd, priceTargetQuestion } from "./priceTargetQuestion";

test("uses UTC month and year end wording without rounding a small target to zero", () => {
  assert.equal(
    priceTargetQuestion("Toshi", 0.00000012, true, new Date("2026-10-31T23:59:00Z")),
    "Will Toshi finish at or above $0.00000012 at the end of October 2026 (UTC)?"
  );
  assert.equal(
    priceTargetQuestion("BTC", 100000, false, new Date("2026-12-31T23:59:00Z")),
    "Will BTC finish at or below $100,000 at the end of 2026 (UTC)?"
  );
});

test("keeps an exact UTC date and time for other checkpoints", () => {
  assert.equal(
    priceTargetQuestion("ETH", 5000, true, new Date("2026-10-31T23:58:00Z")),
    "Will ETH finish at or above $5,000 on Oct 31, 2026 at 11:58 PM UTC?"
  );
  assert.equal(formatPriceTargetUsd(0.00000001), "$0.00000001");
});
