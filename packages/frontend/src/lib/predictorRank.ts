export interface RankStake {
  staker: string;
  market_id: number | string;
  outcome: number;
  markets: { state: string; winner_bitmap: string | number | null };
}

export interface PredictorScore {
  wallet: string;
  points: number;
  correct: number;
  settled: number;
  rank: number;
}

/** One settled market counts once, even if a player staked multiple times or on multiple outcomes. */
export function calculatePredictorRanks(stakes: RankStake[]): PredictorScore[] {
  const byWallet = new Map<string, Map<string, { won: boolean }>>();
  for (const stake of stakes) {
    if (stake.markets.state !== "resolved" || stake.markets.winner_bitmap == null) continue;
    const wallet = stake.staker.toLowerCase();
    const markets = byWallet.get(wallet) ?? new Map<string, { won: boolean }>();
    const key = String(stake.market_id);
    const won = (BigInt(stake.markets.winner_bitmap) & (1n << BigInt(stake.outcome))) !== 0n;
    markets.set(key, { won: (markets.get(key)?.won ?? false) || won });
    byWallet.set(wallet, markets);
  }
  const scores = [...byWallet].map(([wallet, markets]) => {
    const correct = [...markets.values()].filter((market) => market.won).length;
    return { wallet, points: correct * 3, correct, settled: markets.size, rank: 0 };
  });
  scores.sort((a, b) => b.points - a.points || a.wallet.localeCompare(b.wallet));
  let lastKey = "";
  let rank = 0;
  scores.forEach((score, index) => {
    const key = String(score.points);
    if (key !== lastKey) rank = index + 1;
    score.rank = rank;
    lastKey = key;
  });
  return scores;
}
