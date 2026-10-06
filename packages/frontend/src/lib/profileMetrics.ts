/** Market-level calculations shared by private profile analytics and tests. */
import { integerBigInt } from "./integerString";
export interface IndexedStake {
  market_id: number | string;
  template_id: number;
  outcome: number;
  amount_tick: string;
  markets: {
    state: "open" | "resolved" | "voided";
    winner_bitmap: string | null;
    payout_per_share: string | null;
    resolved_at: string | null;
  };
}

export interface MarketResult {
  marketId: string;
  templateId: number;
  state: IndexedStake["markets"]["state"];
  stakeTick: bigint;
  netTick: bigint | null;
  resolvedAt: string | null;
}

const SCALE = 10n ** 18n;

export function calculateMarketResults(stakes: IndexedStake[]): MarketResult[] {
  const groups = new Map<string, IndexedStake[]>();
  for (const stake of stakes) {
    const id = String(stake.market_id);
    const group = groups.get(id) ?? [];
    group.push(stake);
    groups.set(id, group);
  }
  return [...groups.entries()].map(([marketId, rows]) => {
    const market = rows[0].markets;
    const stakeTick = rows.reduce((sum, row) => sum + integerBigInt(row.amount_tick), 0n);
    let netTick: bigint | null = null;
    if (market.state === "voided") netTick = 0n;
    if (market.state === "resolved" && market.winner_bitmap !== null && market.payout_per_share !== null) {
      const bitmap = integerBigInt(market.winner_bitmap);
      const perShare = integerBigInt(market.payout_per_share);
      const payout = rows.reduce((sum, row) => {
        const wins = (bitmap & (1n << BigInt(row.outcome))) !== 0n;
        return sum + (wins ? integerBigInt(row.amount_tick) * perShare / SCALE : 0n);
      }, 0n);
      netTick = payout - stakeTick;
    }
    return { marketId, templateId: rows[0].template_id, state: market.state, stakeTick, netTick, resolvedAt: market.resolved_at };
  });
}
