import assert from "node:assert/strict";
import test from "node:test";
import { calculateMarketResults, type IndexedStake } from "./profileMetrics";

const unit = 10n ** 18n;
const market = (state: IndexedStake["markets"]["state"], bitmap: string | null, multiplier: string | null, resolvedAt: string | null = null) => ({ state, winner_bitmap: bitmap, payout_per_share: multiplier, resolved_at: resolvedAt });

test("groups repeated stakes and hedged outcomes into one net market result", () => {
  const stakes: IndexedStake[] = [
    { market_id: 7, template_id: 3, outcome: 0, amount_tick: (4n * unit).toString(), markets: market("resolved", "1", (2n * unit).toString(), "2026-01-01T00:00:00Z") },
    { market_id: 7, template_id: 3, outcome: 1, amount_tick: (5n * unit).toString(), markets: market("resolved", "1", (2n * unit).toString(), "2026-01-01T00:00:00Z") },
  ];
  const [result] = calculateMarketResults(stakes);
  assert.equal(result.stakeTick, 9n * unit);
  assert.equal(result.netTick, -unit);
});

test("keeps open and incomplete settlements unknown, and voids at zero net", () => {
  const rows: IndexedStake[] = [
    { market_id: 1, template_id: 0, outcome: 0, amount_tick: unit.toString(), markets: market("open", null, null) },
    { market_id: 2, template_id: 0, outcome: 0, amount_tick: unit.toString(), markets: market("resolved", null, null) },
    { market_id: 3, template_id: 0, outcome: 0, amount_tick: unit.toString(), markets: market("voided", null, null) },
  ];
  const results = calculateMarketResults(rows);
  assert.equal(results[0].netTick, null);
  assert.equal(results[1].netTick, null);
  assert.equal(results[2].netTick, 0n);
});
