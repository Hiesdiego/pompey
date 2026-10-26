
import type { TeamPriceMap } from "./priceFeed.js";

export const CUP_TARGET_ORACLE_OFFSET = 1000;

interface CupTeamDef {
  teamId: number;
  symbol: string;
  coinbasePair: string;
  binanceSymbol: string;
  coingeckoId: string;
}

const DEFS: CupTeamDef[] = [
  { teamId: 0, symbol: "BTC", coinbasePair: "BTC-USD", binanceSymbol: "BTCUSDT", coingeckoId: "bitcoin" },
  { teamId: 1, symbol: "ETH", coinbasePair: "ETH-USD", binanceSymbol: "ETHUSDT", coingeckoId: "ethereum" },
  { teamId: 2, symbol: "BNB", coinbasePair: "BNB-USD", binanceSymbol: "BNBUSDT", coingeckoId: "binancecoin" },
  { teamId: 3, symbol: "XRP", coinbasePair: "XRP-USD", binanceSymbol: "XRPUSDT", coingeckoId: "ripple" },
  { teamId: 4, symbol: "SOL", coinbasePair: "SOL-USD", binanceSymbol: "SOLUSDT", coingeckoId: "solana" },
  { teamId: 5, symbol: "TRON", coinbasePair: "", binanceSymbol: "TRXUSDT", coingeckoId: "tron" },
  { teamId: 6, symbol: "HYPE", coinbasePair: "HYPE-USD", binanceSymbol: "HYPEUSDT", coingeckoId: "hyperliquid" },
  { teamId: 7, symbol: "ZEC", coinbasePair: "ZEC-USD", binanceSymbol: "ZECUSDT", coingeckoId: "zcash" },
  { teamId: 8, symbol: "DOGE", coinbasePair: "DOGE-USD", binanceSymbol: "DOGEUSDT", coingeckoId: "dogecoin" },
  { teamId: 9, symbol: "LINK", coinbasePair: "LINK-USD", binanceSymbol: "LINKUSDT", coingeckoId: "chainlink" },
  { teamId: 10, symbol: "ADA", coinbasePair: "ADA-USD", binanceSymbol: "ADAUSDT", coingeckoId: "cardano" },
  { teamId: 11, symbol: "NEAR", coinbasePair: "NEAR-USD", binanceSymbol: "NEARUSDT", coingeckoId: "near" },
  { teamId: 12, symbol: "LTC", coinbasePair: "LTC-USD", binanceSymbol: "LTCUSDT", coingeckoId: "litecoin" },
  { teamId: 13, symbol: "AVAX", coinbasePair: "AVAX-USD", binanceSymbol: "AVAXUSDT", coingeckoId: "avalanche-2" },
  { teamId: 14, symbol: "SHIB", coinbasePair: "SHIB-USD", binanceSymbol: "SHIBUSDT", coingeckoId: "shiba-inu" },
  { teamId: 15, symbol: "TRUMP", coinbasePair: "TRUMP-USD", binanceSymbol: "TRUMPUSDT", coingeckoId: "official-trump" },
  { teamId: 16, symbol: "XLM", coinbasePair: "XLM-USD", binanceSymbol: "XLMUSDT", coingeckoId: "stellar" },
  { teamId: 17, symbol: "UNI", coinbasePair: "UNI-USD", binanceSymbol: "UNIUSDT", coingeckoId: "uniswap" },
  { teamId: 18, symbol: "BCH", coinbasePair: "BCH-USD", binanceSymbol: "BCHUSDT", coingeckoId: "bitcoin-cash" },
  { teamId: 19, symbol: "WAL", coinbasePair: "WAL-USD", binanceSymbol: "WALUSDT", coingeckoId: "walrus-2" },
  { teamId: 20, symbol: "HBAR", coinbasePair: "HBAR-USD", binanceSymbol: "HBARUSDT", coingeckoId: "hedera-hashgraph" },
  { teamId: 21, symbol: "SUI", coinbasePair: "SUI-USD", binanceSymbol: "SUIUSDT", coingeckoId: "sui" },
  { teamId: 22, symbol: "GRAM", coinbasePair: "TON-USD", binanceSymbol: "GRAMUSDT", coingeckoId: "the-open-network" },
  { teamId: 23, symbol: "TAO", coinbasePair: "TAO-USD", binanceSymbol: "TAOUSDT", coingeckoId: "bittensor" },
  { teamId: 24, symbol: "XAUT", coinbasePair: "", binanceSymbol: "XAUTUSDT", coingeckoId: "tether-gold" },
  { teamId: 25, symbol: "PUMP", coinbasePair: "PUMP-USD", binanceSymbol: "PUMPUSDT", coingeckoId: "pump-fun" },
  { teamId: 26, symbol: "WLD", coinbasePair: "WLD-USD", binanceSymbol: "WLDUSDT", coingeckoId: "worldcoin-wld" },
  { teamId: 27, symbol: "ENA", coinbasePair: "ENA-USD", binanceSymbol: "ENAUSDT", coingeckoId: "ethena" },
  { teamId: 28, symbol: "QNT", coinbasePair: "QNT-USD", binanceSymbol: "QNTUSDT", coingeckoId: "quant-network" },
  { teamId: 29, symbol: "AAVE", coinbasePair: "AAVE-USD", binanceSymbol: "AAVEUSDT", coingeckoId: "aave" },
  { teamId: 30, symbol: "ONDO", coinbasePair: "ONDO-USD", binanceSymbol: "ONDOUSDT", coingeckoId: "ondo-finance" },
  { teamId: 31, symbol: "DOT", coinbasePair: "DOT-USD", binanceSymbol: "DOTUSDT", coingeckoId: "polkadot" },
  { teamId: 32, symbol: "ASTER", coinbasePair: "ASTER-USD", binanceSymbol: "ASTERUSDT", coingeckoId: "aster-2" },
  { teamId: 33, symbol: "WLFI", coinbasePair: "WLFI-USD", binanceSymbol: "WLFIUSDT", coingeckoId: "world-liberty-financial" },
  { teamId: 34, symbol: "ARB", coinbasePair: "ARB-USD", binanceSymbol: "ARBUSDT", coingeckoId: "arbitrum" },
  { teamId: 35, symbol: "ICP", coinbasePair: "ICP-USD", binanceSymbol: "ICPUSDT", coingeckoId: "internet-computer" },
  { teamId: 36, symbol: "PEPE", coinbasePair: "PEPE-USD", binanceSymbol: "PEPEUSDT", coingeckoId: "pepe" },
  { teamId: 37, symbol: "SKY", coinbasePair: "SKY-USD", binanceSymbol: "SKYUSDT", coingeckoId: "sky" },
  { teamId: 38, symbol: "ORE", coinbasePair: "", binanceSymbol: "", coingeckoId: "ore" },
  { teamId: 39, symbol: "FIL", coinbasePair: "FIL-USD", binanceSymbol: "FILUSDT", coingeckoId: "filecoin" },
  { teamId: 40, symbol: "ETC", coinbasePair: "ETC-USD", binanceSymbol: "ETCUSDT", coingeckoId: "ethereum-classic" },
  { teamId: 41, symbol: "JST", coinbasePair: "", binanceSymbol: "JSTUSDT", coingeckoId: "just" },
  { teamId: 42, symbol: "JUP", coinbasePair: "JUPITER-USD", binanceSymbol: "JUPUSDT", coingeckoId: "jupiter-exchange-solana" },
  { teamId: 43, symbol: "ALGO", coinbasePair: "ALGO-USD", binanceSymbol: "ALGOUSDT", coingeckoId: "algorand" },
  { teamId: 44, symbol: "RAY", coinbasePair: "RAY-USD", binanceSymbol: "RAYUSDT", coingeckoId: "raydium" },
  { teamId: 45, symbol: "POL", coinbasePair: "POL-USD", binanceSymbol: "POLUSDT", coingeckoId: "polygon-ecosystem-token" },
  { teamId: 46, symbol: "RENDER", coinbasePair: "RENDER-USD", binanceSymbol: "RENDERUSDT", coingeckoId: "render-token" },
  { teamId: 47, symbol: "ATOM", coinbasePair: "ATOM-USD", binanceSymbol: "ATOMUSDT", coingeckoId: "cosmos" },
  { teamId: 48, symbol: "INJ", coinbasePair: "INJ-USD", binanceSymbol: "INJUSDT", coingeckoId: "injective-protocol" },
  { teamId: 49, symbol: "TOSHI", coinbasePair: "TOSHI-USD", binanceSymbol: "", coingeckoId: "toshi" },
  { teamId: 50, symbol: "NIGHT", coinbasePair: "", binanceSymbol: "NIGHTUSDT", coingeckoId: "midnight-3" },
  { teamId: 51, symbol: "CAKE", coinbasePair: "CAKE-USD", binanceSymbol: "CAKEUSDT", coingeckoId: "pancakeswap-token" },
  { teamId: 52, symbol: "VIRTUAL", coinbasePair: "VIRTUAL-USD", binanceSymbol: "VIRTUALUSDT", coingeckoId: "virtual-protocol" },
  { teamId: 53, symbol: "PYTH", coinbasePair: "PYTH-USD", binanceSymbol: "PYTHUSDT", coingeckoId: "pyth-network" },
  { teamId: 54, symbol: "DASH", coinbasePair: "DASH-USD", binanceSymbol: "DASHUSDT", coingeckoId: "dash" },
  { teamId: 55, symbol: "CRV", coinbasePair: "CRV-USD", binanceSymbol: "CRVUSDT", coingeckoId: "curve-dao-token" },
  { teamId: 56, symbol: "OP", coinbasePair: "OP-USD", binanceSymbol: "OPUSDT", coingeckoId: "optimism" },
  { teamId: 57, symbol: "TIA", coinbasePair: "TIA-USD", binanceSymbol: "TIAUSDT", coingeckoId: "celestia" },
  { teamId: 58, symbol: "VET", coinbasePair: "VET-USD", binanceSymbol: "VETUSDT", coingeckoId: "vechain" },
  { teamId: 59, symbol: "STRK", coinbasePair: "STRK-USD", binanceSymbol: "STRKUSDT", coingeckoId: "starknet" },
  { teamId: 60, symbol: "PENGUIN", coinbasePair: "PENGU-USD", binanceSymbol: "PENGUUSDT", coingeckoId: "pudgy-penguins" },
  { teamId: 61, symbol: "SEI", coinbasePair: "SEI-USD", binanceSymbol: "SEIUSDT", coingeckoId: "sei-network" },
  { teamId: 62, symbol: "AXS", coinbasePair: "AXS-USD", binanceSymbol: "AXSUSDT", coingeckoId: "axie-infinity" },
  { teamId: 63, symbol: "IMX", coinbasePair: "IMX-USD", binanceSymbol: "IMXUSDT", coingeckoId: "immutable-x" },
];

if (DEFS.length !== 64 || new Set(DEFS.map((d) => d.teamId)).size !== 64) {
  throw new Error("[cupTeams] must define exactly 64 unique teamIds");
}

export const CUP_TEAM_PRICE_MAP: TeamPriceMap[] = DEFS.map((d) => ({
  teamId: d.teamId,
  coinbasePair: d.coinbasePair,
  binanceSymbol: d.binanceSymbol,
  coingeckoId: d.coingeckoId,
}));

export const CUP_TEAM_SYMBOLS: Record<number, string> = Object.fromEntries(
  DEFS.map((d) => [d.teamId, d.symbol])
);
