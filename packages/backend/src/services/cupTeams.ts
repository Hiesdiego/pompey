/**
 * CRYPTO PRICE WORLD CUP — 64-team price-source map.
 *
 * teamIds are the on-chain registration order: pots 1→4, 16 teams each
 * (deploy-cup.ts registers POT_1, POT_2, POT_3, POT_4 in order).
 *
 * Price sources:
 * - 62 teams price on Binance spot (data-api.binance.vision).
 *   TRON trades as TRX, PENGUIN trades as PENGU.
 * - ORE (team 38) and TOSHI (team 49) use CoinGecko IDs "ore" and "toshi".
 * - GRAM (team 22) has no verified CoinGecko id — Binance is its only
 *   source (validation skipped, not failed).
 */
import type { TeamPriceMap } from "./priceFeed.js";

interface CupTeamDef {
  teamId: number;
  symbol: string;
  binanceSymbol: string; // "" = not on Binance
  coingeckoId: string; // "" = no verified id (Binance-only)
  coingeckoOnly: boolean;
}

const DEFS: CupTeamDef[] = [
  // Pot 1 (teams 0–15)
  { teamId: 0, symbol: "BTC", binanceSymbol: "BTCUSDT", coingeckoId: "bitcoin", coingeckoOnly: false },
  { teamId: 1, symbol: "ETH", binanceSymbol: "ETHUSDT", coingeckoId: "ethereum", coingeckoOnly: false },
  { teamId: 2, symbol: "BNB", binanceSymbol: "BNBUSDT", coingeckoId: "binancecoin", coingeckoOnly: false },
  { teamId: 3, symbol: "XRP", binanceSymbol: "XRPUSDT", coingeckoId: "ripple", coingeckoOnly: false },
  { teamId: 4, symbol: "SOL", binanceSymbol: "SOLUSDT", coingeckoId: "solana", coingeckoOnly: false },
  { teamId: 5, symbol: "TRON", binanceSymbol: "TRXUSDT", coingeckoId: "tron", coingeckoOnly: false },
  { teamId: 6, symbol: "HYPE", binanceSymbol: "HYPEUSDT", coingeckoId: "hyperliquid", coingeckoOnly: false },
  { teamId: 7, symbol: "ZEC", binanceSymbol: "ZECUSDT", coingeckoId: "zcash", coingeckoOnly: false },
  { teamId: 8, symbol: "DOGE", binanceSymbol: "DOGEUSDT", coingeckoId: "dogecoin", coingeckoOnly: false },
  { teamId: 9, symbol: "LINK", binanceSymbol: "LINKUSDT", coingeckoId: "chainlink", coingeckoOnly: false },
  { teamId: 10, symbol: "ADA", binanceSymbol: "ADAUSDT", coingeckoId: "cardano", coingeckoOnly: false },
  { teamId: 11, symbol: "NEAR", binanceSymbol: "NEARUSDT", coingeckoId: "near", coingeckoOnly: false },
  { teamId: 12, symbol: "LTC", binanceSymbol: "LTCUSDT", coingeckoId: "litecoin", coingeckoOnly: false },
  { teamId: 13, symbol: "AVAX", binanceSymbol: "AVAXUSDT", coingeckoId: "avalanche-2", coingeckoOnly: false },
  { teamId: 14, symbol: "SHIB", binanceSymbol: "SHIBUSDT", coingeckoId: "shiba-inu", coingeckoOnly: false },
  { teamId: 15, symbol: "TRUMP", binanceSymbol: "TRUMPUSDT", coingeckoId: "official-trump", coingeckoOnly: false },
  // Pot 2 (teams 16–31)
  { teamId: 16, symbol: "XLM", binanceSymbol: "XLMUSDT", coingeckoId: "stellar", coingeckoOnly: false },
  { teamId: 17, symbol: "UNI", binanceSymbol: "UNIUSDT", coingeckoId: "uniswap", coingeckoOnly: false },
  { teamId: 18, symbol: "BCH", binanceSymbol: "BCHUSDT", coingeckoId: "bitcoin-cash", coingeckoOnly: false },
  { teamId: 19, symbol: "WAL", binanceSymbol: "WALUSDT", coingeckoId: "walrus-2", coingeckoOnly: false },
  { teamId: 20, symbol: "HBAR", binanceSymbol: "HBARUSDT", coingeckoId: "hedera", coingeckoOnly: false },
  { teamId: 21, symbol: "SUI", binanceSymbol: "SUIUSDT", coingeckoId: "sui", coingeckoOnly: false },
  { teamId: 22, symbol: "GRAM", binanceSymbol: "GRAMUSDT", coingeckoId: "", coingeckoOnly: false },
  { teamId: 23, symbol: "TAO", binanceSymbol: "TAOUSDT", coingeckoId: "bittensor", coingeckoOnly: false },
  { teamId: 24, symbol: "XAUT", binanceSymbol: "XAUTUSDT", coingeckoId: "tether-gold", coingeckoOnly: false },
  { teamId: 25, symbol: "PUMP", binanceSymbol: "PUMPUSDT", coingeckoId: "pump-fun", coingeckoOnly: false },
  { teamId: 26, symbol: "WLD", binanceSymbol: "WLDUSDT", coingeckoId: "worldcoin", coingeckoOnly: false },
  { teamId: 27, symbol: "ENA", binanceSymbol: "ENAUSDT", coingeckoId: "ethena", coingeckoOnly: false },
  { teamId: 28, symbol: "QNT", binanceSymbol: "QNTUSDT", coingeckoId: "quant-network", coingeckoOnly: false },
  { teamId: 29, symbol: "AAVE", binanceSymbol: "AAVEUSDT", coingeckoId: "aave", coingeckoOnly: false },
  { teamId: 30, symbol: "ONDO", binanceSymbol: "ONDOUSDT", coingeckoId: "ondo-finance", coingeckoOnly: false },
  { teamId: 31, symbol: "DOT", binanceSymbol: "DOTUSDT", coingeckoId: "polkadot", coingeckoOnly: false },
  // Pot 3 (teams 32–47)
  { teamId: 32, symbol: "ASTER", binanceSymbol: "ASTERUSDT", coingeckoId: "aster-2", coingeckoOnly: false },
  { teamId: 33, symbol: "WLFI", binanceSymbol: "WLFIUSDT", coingeckoId: "world-liberty-financial", coingeckoOnly: false },
  { teamId: 34, symbol: "ARB", binanceSymbol: "ARBUSDT", coingeckoId: "arbitrum", coingeckoOnly: false },
  { teamId: 35, symbol: "ICP", binanceSymbol: "ICPUSDT", coingeckoId: "internet-computer", coingeckoOnly: false },
  { teamId: 36, symbol: "PEPE", binanceSymbol: "PEPEUSDT", coingeckoId: "pepe", coingeckoOnly: false },
  { teamId: 37, symbol: "SKY", binanceSymbol: "SKYUSDT", coingeckoId: "sky", coingeckoOnly: false },
  { teamId: 38, symbol: "ORE", binanceSymbol: "", coingeckoId: "ore", coingeckoOnly: true },
  { teamId: 39, symbol: "FIL", binanceSymbol: "FILUSDT", coingeckoId: "filecoin", coingeckoOnly: false },
  { teamId: 40, symbol: "ETC", binanceSymbol: "ETCUSDT", coingeckoId: "ethereum-classic", coingeckoOnly: false },
  { teamId: 41, symbol: "JST", binanceSymbol: "JSTUSDT", coingeckoId: "just", coingeckoOnly: false },
  { teamId: 42, symbol: "JUP", binanceSymbol: "JUPUSDT", coingeckoId: "jupiter", coingeckoOnly: false },
  { teamId: 43, symbol: "ALGO", binanceSymbol: "ALGOUSDT", coingeckoId: "algorand", coingeckoOnly: false },
  { teamId: 44, symbol: "RAY", binanceSymbol: "RAYUSDT", coingeckoId: "raydium", coingeckoOnly: false },
  { teamId: 45, symbol: "POL", binanceSymbol: "POLUSDT", coingeckoId: "polygon-ecosystem-token", coingeckoOnly: false },
  { teamId: 46, symbol: "RENDER", binanceSymbol: "RENDERUSDT", coingeckoId: "render-token", coingeckoOnly: false },
  { teamId: 47, symbol: "ATOM", binanceSymbol: "ATOMUSDT", coingeckoId: "cosmos", coingeckoOnly: false },
  // Pot 4 (teams 48–63)
  { teamId: 48, symbol: "INJ", binanceSymbol: "INJUSDT", coingeckoId: "injective-protocol", coingeckoOnly: false },
  { teamId: 49, symbol: "TOSHI", binanceSymbol: "", coingeckoId: "toshi", coingeckoOnly: true },
  { teamId: 50, symbol: "NIGHT", binanceSymbol: "NIGHTUSDT", coingeckoId: "midnight", coingeckoOnly: false },
  { teamId: 51, symbol: "CAKE", binanceSymbol: "CAKEUSDT", coingeckoId: "pancakeswap-token", coingeckoOnly: false },
  { teamId: 52, symbol: "VIRTUAL", binanceSymbol: "VIRTUALUSDT", coingeckoId: "virtual-protocol", coingeckoOnly: false },
  { teamId: 53, symbol: "PYTH", binanceSymbol: "PYTHUSDT", coingeckoId: "pyth-network", coingeckoOnly: false },
  { teamId: 54, symbol: "DASH", binanceSymbol: "DASHUSDT", coingeckoId: "dash", coingeckoOnly: false },
  { teamId: 55, symbol: "CRV", binanceSymbol: "CRVUSDT", coingeckoId: "curve-dao-token", coingeckoOnly: false },
  { teamId: 56, symbol: "OP", binanceSymbol: "OPUSDT", coingeckoId: "optimism", coingeckoOnly: false },
  { teamId: 57, symbol: "TIA", binanceSymbol: "TIAUSDT", coingeckoId: "celestia", coingeckoOnly: false },
  { teamId: 58, symbol: "VET", binanceSymbol: "VETUSDT", coingeckoId: "vechain", coingeckoOnly: false },
  { teamId: 59, symbol: "STRK", binanceSymbol: "STRKUSDT", coingeckoId: "starknet", coingeckoOnly: false },
  { teamId: 60, symbol: "PENGUIN", binanceSymbol: "PENGUUSDT", coingeckoId: "pudgy-penguins", coingeckoOnly: false },
  { teamId: 61, symbol: "SEI", binanceSymbol: "SEIUSDT", coingeckoId: "sei-network", coingeckoOnly: false },
  { teamId: 62, symbol: "AXS", binanceSymbol: "AXSUSDT", coingeckoId: "axie-infinity", coingeckoOnly: false },
  { teamId: 63, symbol: "IMX", binanceSymbol: "IMXUSDT", coingeckoId: "immutable-x", coingeckoOnly: false },
];

if (DEFS.length !== 64 || new Set(DEFS.map((d) => d.teamId)).size !== 64) {
  throw new Error("[cupTeams] must define exactly 64 unique teamIds");
}

/** PriceFeed-compatible map for the cup's 64 teams. */
export const CUP_TEAM_PRICE_MAP: TeamPriceMap[] = DEFS.map((d) => ({
  teamId: d.teamId,
  binanceSymbol: d.binanceSymbol,
  coingeckoId: d.coingeckoId,
  coingeckoOnly: d.coingeckoOnly,
}));

/** teamId → display symbol (for logs / the API). */
export const CUP_TEAM_SYMBOLS: Record<number, string> = Object.fromEntries(
  DEFS.map((d) => [d.teamId, d.symbol])
);
