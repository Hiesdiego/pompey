/**
 * TICKR v0.1 — Single League Roster (20 teams)
 * This is the single source of truth. TeamRegistry.sol is deployed from
 * this exact list, in this exact order. Index in this array = on-chain teamId.
 *
 * coingeckoId  -> used by the backend CoinGecko poller
 * binanceSymbol -> used by the backend Binance WebSocket client (vs USDT)
 * cmcId        -> CoinMarketCap id, logo fallback via s2.coinmarketcap.com CDN
 */

export interface TeamDefinition {
  teamId: number;
  name: string;
  symbol: string;
  coingeckoId: string;
  binanceSymbol: string; // e.g. "BTCUSDT"
  cmcId: number; // CoinMarketCap numeric id — logo fallback CDN
}

export const TICKR_TEAMS: TeamDefinition[] = [
  { teamId: 0, name: "Bitcoin", symbol: "BTC", coingeckoId: "bitcoin", binanceSymbol: "BTCUSDT", cmcId: 1 },
  { teamId: 1, name: "Ethereum", symbol: "ETH", coingeckoId: "ethereum", binanceSymbol: "ETHUSDT", cmcId: 1027 },
  { teamId: 2, name: "Somnia", symbol: "SOMI", coingeckoId: "somnia", binanceSymbol: "SOMIUSDT", cmcId: 37637 },
  { teamId: 3, name: "Binance Coin", symbol: "BNB", coingeckoId: "binancecoin", binanceSymbol: "BNBUSDT", cmcId: 1839 },
  { teamId: 4, name: "Solana", symbol: "SOL", coingeckoId: "solana", binanceSymbol: "SOLUSDT", cmcId: 5426 },
  { teamId: 5, name: "Cardano", symbol: "ADA", coingeckoId: "cardano", binanceSymbol: "ADAUSDT", cmcId: 2010 },
  { teamId: 6, name: "Ripple", symbol: "XRP", coingeckoId: "ripple", binanceSymbol: "XRPUSDT", cmcId: 52 },
  { teamId: 7, name: "Polygon", symbol: "POL", coingeckoId: "polygon-ecosystem-token", binanceSymbol: "POLUSDT", cmcId: 28321 }, // CG "matic-network" is a stale legacy entry — verified 2026-09-25
  { teamId: 8, name: "Dogecoin", symbol: "DOGE", coingeckoId: "dogecoin", binanceSymbol: "DOGEUSDT", cmcId: 74 },
  { teamId: 9, name: "Avalanche", symbol: "AVAX", coingeckoId: "avalanche-2", binanceSymbol: "AVAXUSDT", cmcId: 5805 },
  { teamId: 10, name: "Litecoin", symbol: "LTC", coingeckoId: "litecoin", binanceSymbol: "LTCUSDT", cmcId: 2 },
  { teamId: 11, name: "Sui", symbol: "SUI", coingeckoId: "sui", binanceSymbol: "SUIUSDT", cmcId: 20947 },
  { teamId: 12, name: "Tron", symbol: "TRX", coingeckoId: "tron", binanceSymbol: "TRXUSDT", cmcId: 1958 },
  { teamId: 13, name: "Chainlink", symbol: "LINK", coingeckoId: "chainlink", binanceSymbol: "LINKUSDT", cmcId: 1975 },
  { teamId: 14, name: "Polkadot", symbol: "DOT", coingeckoId: "polkadot", binanceSymbol: "DOTUSDT", cmcId: 6636 },
  { teamId: 15, name: "Near", symbol: "NEAR", coingeckoId: "near", binanceSymbol: "NEARUSDT", cmcId: 6535 },
  { teamId: 16, name: "Ton", symbol: "TON", coingeckoId: "the-open-network", binanceSymbol: "GRAMUSDT", cmcId: 11419 }, // Toncoin trades as GRAM/USDT on CEXs; Binance "TONUSDT" is a different token — verified 2026-09-25
  { teamId: 17, name: "Filecoin", symbol: "FIL", coingeckoId: "filecoin", binanceSymbol: "FILUSDT", cmcId: 2280 },
  { teamId: 18, name: "Cosmos", symbol: "ATOM", coingeckoId: "cosmos", binanceSymbol: "ATOMUSDT", cmcId: 3794 },
  { teamId: 19, name: "Shiba Inu", symbol: "SHIB", coingeckoId: "shiba-inu", binanceSymbol: "SHIBUSDT", cmcId: 5994 },
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
