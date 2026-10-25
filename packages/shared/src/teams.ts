

export interface TeamDefinition {
  teamId: number;
  name: string;
  symbol: string;
  coingeckoId: string;
  binanceSymbol: string;
  coinbasePair?: string;
  cmcId: number;
}

export const TICKR_TEAMS: TeamDefinition[] = [
  { teamId: 0, name: "Bitcoin", symbol: "BTC", coingeckoId: "bitcoin", binanceSymbol: "BTCUSDT", cmcId: 1, coinbasePair: "BTC-USD" },
  { teamId: 1, name: "Ethereum", symbol: "ETH", coingeckoId: "ethereum", binanceSymbol: "ETHUSDT", cmcId: 1027, coinbasePair: "ETH-USD" },
  { teamId: 2, name: "Somnia", symbol: "SOMI", coingeckoId: "somnia", binanceSymbol: "SOMIUSDT", cmcId: 37637, coinbasePair: "" },
  { teamId: 3, name: "Binance Coin", symbol: "BNB", coingeckoId: "binancecoin", binanceSymbol: "BNBUSDT", cmcId: 1839, coinbasePair: "BNB-USD" },
  { teamId: 4, name: "Solana", symbol: "SOL", coingeckoId: "solana", binanceSymbol: "SOLUSDT", cmcId: 5426, coinbasePair: "SOL-USD" },
  { teamId: 5, name: "Cardano", symbol: "ADA", coingeckoId: "cardano", binanceSymbol: "ADAUSDT", cmcId: 2010, coinbasePair: "ADA-USD" },
  { teamId: 6, name: "Ripple", symbol: "XRP", coingeckoId: "ripple", binanceSymbol: "XRPUSDT", cmcId: 52, coinbasePair: "XRP-USD" },
  { teamId: 7, name: "Polygon", symbol: "POL", coingeckoId: "polygon-ecosystem-token", binanceSymbol: "POLUSDT", cmcId: 28321, coinbasePair: "POL-USD" },
  { teamId: 8, name: "Dogecoin", symbol: "DOGE", coingeckoId: "dogecoin", binanceSymbol: "DOGEUSDT", cmcId: 74, coinbasePair: "DOGE-USD" },
  { teamId: 9, name: "Avalanche", symbol: "AVAX", coingeckoId: "avalanche-2", binanceSymbol: "AVAXUSDT", cmcId: 5805, coinbasePair: "AVAX-USD" },
  { teamId: 10, name: "Litecoin", symbol: "LTC", coingeckoId: "litecoin", binanceSymbol: "LTCUSDT", cmcId: 2, coinbasePair: "LTC-USD" },
  { teamId: 11, name: "Sui", symbol: "SUI", coingeckoId: "sui", binanceSymbol: "SUIUSDT", cmcId: 20947, coinbasePair: "SUI-USD" },
  { teamId: 12, name: "Tron", symbol: "TRX", coingeckoId: "tron", binanceSymbol: "TRXUSDT", cmcId: 1958, coinbasePair: "TRX-USD" },
  { teamId: 13, name: "Chainlink", symbol: "LINK", coingeckoId: "chainlink", binanceSymbol: "LINKUSDT", cmcId: 1975, coinbasePair: "LINK-USD" },
  { teamId: 14, name: "Polkadot", symbol: "DOT", coingeckoId: "polkadot", binanceSymbol: "DOTUSDT", cmcId: 6636, coinbasePair: "DOT-USD" },
  { teamId: 15, name: "Near", symbol: "NEAR", coingeckoId: "near", binanceSymbol: "NEARUSDT", cmcId: 6535, coinbasePair: "NEAR-USD" },
  { teamId: 16, name: "Ton", symbol: "TON", coingeckoId: "the-open-network", binanceSymbol: "GRAMUSDT", cmcId: 11419, coinbasePair: "TON-USD" },
  { teamId: 17, name: "Filecoin", symbol: "FIL", coingeckoId: "filecoin", binanceSymbol: "FILUSDT", cmcId: 2280, coinbasePair: "FIL-USD" },
  { teamId: 18, name: "Cosmos", symbol: "ATOM", coingeckoId: "cosmos", binanceSymbol: "ATOMUSDT", cmcId: 3794, coinbasePair: "ATOM-USD" },
  { teamId: 19, name: "Shiba Inu", symbol: "SHIB", coingeckoId: "shiba-inu", binanceSymbol: "SHIBUSDT", cmcId: 5994, coinbasePair: "SHIB-USD" },
];

export const TEAM_COUNT = TICKR_TEAMS.length;

export const MATCHES_PER_TEAM = (TEAM_COUNT - 1) * 2;
export const TOTAL_LEAGUE_MATCHES = (TEAM_COUNT * MATCHES_PER_TEAM) / 2;

export function getTeamById(teamId: number): TeamDefinition | undefined {
  return TICKR_TEAMS.find((t) => t.teamId === teamId);
}

export function getTeamByCoingeckoId(coingeckoId: string): TeamDefinition | undefined {
  return TICKR_TEAMS.find((t) => t.coingeckoId === coingeckoId);
}
