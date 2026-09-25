/**
 * TICKR v0.1 — Single League Roster (20 teams)
 * This is the single source of truth. TeamRegistry.sol is deployed from
 * this exact list, in this exact order. Index in this array = on-chain teamId.
 *
 * coingeckoId  -> used by the backend CoinGecko poller
 * binanceSymbol -> used by the backend Binance WebSocket client (vs USDT)
 */

export interface TeamDefinition {
  teamId: number;
  name: string;
  symbol: string;
  coingeckoId: string;
  binanceSymbol: string; // e.g. "BTCUSDT"
}

export const TICKR_TEAMS: TeamDefinition[] = [
  { teamId: 0, name: "Bitcoin", symbol: "BTC", coingeckoId: "bitcoin", binanceSymbol: "BTCUSDT" },
  { teamId: 1, name: "Ethereum", symbol: "ETH", coingeckoId: "ethereum", binanceSymbol: "ETHUSDT" },
  { teamId: 2, name: "Somnia", symbol: "SOMI", coingeckoId: "somnia", binanceSymbol: "SOMIUSDT" },
  { teamId: 3, name: "Binance Coin", symbol: "BNB", coingeckoId: "binancecoin", binanceSymbol: "BNBUSDT" },
  { teamId: 4, name: "Solana", symbol: "SOL", coingeckoId: "solana", binanceSymbol: "SOLUSDT" },
  { teamId: 5, name: "Cardano", symbol: "ADA", coingeckoId: "cardano", binanceSymbol: "ADAUSDT" },
  { teamId: 6, name: "Ripple", symbol: "XRP", coingeckoId: "ripple", binanceSymbol: "XRPUSDT" },
  { teamId: 7, name: "Polygon", symbol: "POL", coingeckoId: "polygon-ecosystem-token", binanceSymbol: "POLUSDT" }, // CG "matic-network" is a stale legacy entry — verified 2026-09-25
  { teamId: 8, name: "Dogecoin", symbol: "DOGE", coingeckoId: "dogecoin", binanceSymbol: "DOGEUSDT" },
  { teamId: 9, name: "Avalanche", symbol: "AVAX", coingeckoId: "avalanche-2", binanceSymbol: "AVAXUSDT" },
  { teamId: 10, name: "Litecoin", symbol: "LTC", coingeckoId: "litecoin", binanceSymbol: "LTCUSDT" },
  { teamId: 11, name: "Sui", symbol: "SUI", coingeckoId: "sui", binanceSymbol: "SUIUSDT" },
  { teamId: 12, name: "Tron", symbol: "TRX", coingeckoId: "tron", binanceSymbol: "TRXUSDT" },
  { teamId: 13, name: "Chainlink", symbol: "LINK", coingeckoId: "chainlink", binanceSymbol: "LINKUSDT" },
  { teamId: 14, name: "Polkadot", symbol: "DOT", coingeckoId: "polkadot", binanceSymbol: "DOTUSDT" },
  { teamId: 15, name: "Near", symbol: "NEAR", coingeckoId: "near", binanceSymbol: "NEARUSDT" },
  { teamId: 16, name: "Ton", symbol: "TON", coingeckoId: "the-open-network", binanceSymbol: "GRAMUSDT" }, // Toncoin trades as GRAM/USDT on CEXs; Binance "TONUSDT" is a different token — verified 2026-09-25
  { teamId: 17, name: "Filecoin", symbol: "FIL", coingeckoId: "filecoin", binanceSymbol: "FILUSDT" },
  { teamId: 18, name: "Cosmos", symbol: "ATOM", coingeckoId: "cosmos", binanceSymbol: "ATOMUSDT" },
  { teamId: 19, name: "Shiba Inu", symbol: "SHIB", coingeckoId: "shiba-inu", binanceSymbol: "SHIBUSDT" },
];

export const TEAM_COUNT = TICKR_TEAMS.length; // 20

/**
 * Football league math: with 20 teams playing a full home+away round robin,
 * each team plays 38 matches (19 opponents x home + away) — this is the
 * "38 fixtures" referenced throughout planning, matching Premier League format.
 * The TOTAL number of matches played league-wide is 380 (20 teams x 38 / 2).
 */
export const MATCHES_PER_TEAM = (TEAM_COUNT - 1) * 2; // 38
export const TOTAL_LEAGUE_MATCHES = (TEAM_COUNT * MATCHES_PER_TEAM) / 2; // 380

export function getTeamById(teamId: number): TeamDefinition | undefined {
  return TICKR_TEAMS.find((t) => t.teamId === teamId);
}

export function getTeamByCoingeckoId(coingeckoId: string): TeamDefinition | undefined {
  return TICKR_TEAMS.find((t) => t.coingeckoId === coingeckoId);
}
