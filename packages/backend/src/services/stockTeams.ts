/**
 * TICKR Stock League, roster (12 teams, LOCKED 2026-11-18).
 *
 * Intended destination: packages/backend/src/services/stockTeams.ts.
 * This is the single source of truth for the stock league, mirroring
 * packages/shared/src/teams.ts for crypto. Index in this array = on-chain
 * teamId. The stock TeamRegistry must be deployed from this exact list,
 * in this exact order. This roster REVISES the 22-team roster locked
 * 2026-11-16: the 13 sidelined teams return for Season 2, and INTC,
 * SNDK and SPCX are NEW to the league.
 *
 * Source: Base Tokenized Stocks API
 * (https://api.coinbase.com/v1/tokenized-stocks), verified live
 * 2026-11-18 09:45 UTC: all 12 teams carry a nav_price (NVDAc 161.13,
 * AAPLc 350.52, MSFTc 509.28, AMZNc 260.57, GOOGLc 281.99, METAc 621.58,
 * TSLAc 384.21, MSTRc 99.20, CRCLc 56.19, INTCc 56.25, SNDKc 828.01,
 * SPCXc 142.44). Contract addresses and ISINs below are copied from
 * that live response, not from the old CSV. Season 1 is Coinbase B20
 * only: SPY/QQQ/BABA/TSM/ASML/COST/COIN are Dinari-only and sit out.
 *
 * Fields, deliberately NOT the crypto fields:
 *   - No coinbasePair / binanceSymbol / coingeckoId. Stocks are not
 *     priced from Coinbase spot, Binance, or CoinGecko; the price source
 *     is Chainlink NAV via the Base Tokenized Stocks API. Reusing the
 *     crypto price-map fields would silently route a stock through a
 *     crypto venue. The CoinGecko last-resort tier (stockPriceFeed.ts)
 *     takes its own optional id map, never this file.
 *   - tokenSymbol is the B20 symbol (NVDAc, AAPLc, ...).
 *   - contractAddress is the B20 token contract on Base (0xb200...).
 *     All 12 are 8 decimals. These are the TOKEN contracts, not the
 *     Chainlink feed proxies.
 *   - multiplier is the live API snapshot value (2026-11-18). It changes
 *     on corporate actions (dividends, splits), so NEVER price from this
 *     copy: the live multiplier arrives with every NAV poll
 *     (stockNavPoller.ts) and the contracts read it from the onchain
 *     oracle registry. This field is documentation and a sanity check.
 *   - isin is the underlying stock's ISIN, from the live API response.
 *   - logoPath is a remote brand logo, verified live Nov 17 2026 for
 *     the 9 returning teams and Nov 18 2026 for INTC, SNDK and SPCX:
 *     DuckDuckGo favicons, except Simple Icons for Strategy
 *     (microstrategy) and Circle (circle). FIX (2026-11-17): logos used
 *     to point at local files under /public/stock-logos/, but that folder
 *     was never shipped, so every badge 404d and fell back to a
 *     single-letter avatar. The frontend still falls back to a letter
 *     avatar if a logo fails to load, so a missing logo never blocks the
 *     table or a fixture.
 */

export interface StockTeamDefinition {
  teamId: number;
  /** Underlying ticker, e.g. "NVDA". */
  ticker: string;
  /** Company name, e.g. "NVIDIA Corporation". */
  name: string;
  /** B20 token symbol, e.g. "NVDAc". */
  tokenSymbol: string;
  /** B20 token contract on Base. */
  contractAddress: `0x${string}`;
  /** Token decimals (8 for every B20 stock). */
  decimals: 8;
  /** Issuer: "Coinbase" for every Season 1 team. */
  issuer: "Coinbase";
  /** Share-to-token multiplier, live API snapshot 2026-11-18. Live value
   *  comes from the NAV API per poll; never price from this copy. */
  multiplier: number;
  /** Underlying stock ISIN. */
  isin: string;
  /** Remote brand logo URL (verified live Nov 17-18 2026); letter-avatar
   *  fallback on error. */
  logoPath: string;
}

export const STOCK_TEAMS: StockTeamDefinition[] = [
  { teamId: 0, ticker: "NVDA", name: "NVIDIA Corporation", tokenSymbol: "NVDAc", contractAddress: "0xb20000000000000000000078ee7ce2fE4908108C", decimals: 8, issuer: "Coinbase", multiplier: 1.0005379395763694, isin: "US67066G1040", logoPath: "https://icons.duckduckgo.com/ip3/nvidia.com.ico" },
  { teamId: 1, ticker: "AAPL", name: "Apple Inc.", tokenSymbol: "AAPLc", contractAddress: "0xb200000000000000000000C2e324d24d7eEcd1fb", decimals: 8, issuer: "Coinbase", multiplier: 1.0005003893019802, isin: "US0378331005", logoPath: "https://icons.duckduckgo.com/ip3/apple.com.ico" },
  { teamId: 2, ticker: "MSFT", name: "Microsoft Corporation", tokenSymbol: "MSFTc", contractAddress: "0xB200000000000000000000Ab99cFa739E253872B", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US5949181045", logoPath: "https://icons.duckduckgo.com/ip3/microsoft.com.ico" },
  { teamId: 3, ticker: "AMZN", name: "Amazon.com Inc.", tokenSymbol: "AMZNc", contractAddress: "0xb200000000000000000000d9192b6B456483C2E8", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US0231351067", logoPath: "https://icons.duckduckgo.com/ip3/amazon.com.ico" },
  { teamId: 4, ticker: "GOOGL", name: "Alphabet Inc.", tokenSymbol: "GOOGLc", contractAddress: "0xb2000000000000000000002D0BA3164cc74f58B7", decimals: 8, issuer: "Coinbase", multiplier: 1.0003771186767842, isin: "US02079K3059", logoPath: "https://icons.duckduckgo.com/ip3/google.com.ico" },
  { teamId: 5, ticker: "META", name: "Meta Platforms Inc.", tokenSymbol: "METAc", contractAddress: "0xb2000000000000000000008bC8786B856E61707C", decimals: 8, issuer: "Coinbase", multiplier: 1.0003137922895982, isin: "US30303M1027", logoPath: "https://icons.duckduckgo.com/ip3/meta.com.ico" },
  { teamId: 6, ticker: "TSLA", name: "Tesla Inc.", tokenSymbol: "TSLAc", contractAddress: "0xb2000000000000000000001e800a7f5189430cD0", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US88160R1014", logoPath: "https://icons.duckduckgo.com/ip3/tesla.com.ico" },
  { teamId: 7, ticker: "MSTR", name: "Strategy Inc.", tokenSymbol: "MSTRc", contractAddress: "0xb2000000000000000000004884b426556b92883d", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US5949724083", logoPath: "https://cdn.simpleicons.org/microstrategy" },
  { teamId: 8, ticker: "CRCL", name: "Circle Internet Group Inc.", tokenSymbol: "CRCLc", contractAddress: "0xB20000000000000000000019f6E7C675b73C2e4D", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US1725731079", logoPath: "https://cdn.simpleicons.org/circle" },
  { teamId: 9, ticker: "INTC", name: "Intel Corporation", tokenSymbol: "INTCc", contractAddress: "0xB2000000000000000000004AFF16039bA04bdFBc", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US4581401001", logoPath: "https://icons.duckduckgo.com/ip3/intel.com.ico" },
  { teamId: 10, ticker: "SNDK", name: "SanDisk Corporation", tokenSymbol: "SNDKc", contractAddress: "0xb200000000000000000000397293Cb8cda9a10c5", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US80004C2008", logoPath: "https://icons.duckduckgo.com/ip3/sandisk.com.ico" },
  { teamId: 11, ticker: "SPCX", name: "SpaceX", tokenSymbol: "SPCXc", contractAddress: "0xb2000000000000000000007b9fcbd005511aCBd5", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US84615Q1031", logoPath: "https://icons.duckduckgo.com/ip3/spacex.com.ico" },
];

export const STOCK_TEAM_COUNT = STOCK_TEAMS.length; // 12

/** Sidelined for Season 1 (user decision 2026-11-18): these 13 teams
 *  return for Season 2. GME and AMC headline the Meme Arena. They are
 *  listed here so nothing silently re-adds them to the Season 1 roster,
 *  and so the Season 2 expansion has its list ready. */
export const STOCK_SIDELINED_SEASON_2: string[] = [
  "AMD", "NFLX", "AVGO", "PLTR", "ORCL", "CRM", "JPM", "V", "LLY",
  "DIS", "HOOD", "GME", "AMC",
];

/** Double round-robin: each team plays every other team twice (home and away). */
export const STOCK_MATCHES_PER_TEAM = (STOCK_TEAM_COUNT - 1) * 2; // 22
export const STOCK_TOTAL_FIXTURES = (STOCK_TEAM_COUNT * STOCK_MATCHES_PER_TEAM) / 2; // 132

export function getStockTeamById(teamId: number): StockTeamDefinition | undefined {
  return STOCK_TEAMS.find((t) => t.teamId === teamId);
}

export function getStockTeamByTicker(ticker: string): StockTeamDefinition | undefined {
  return STOCK_TEAMS.find((t) => t.ticker === ticker.toUpperCase());
}

export function getStockTeamByTokenSymbol(tokenSymbol: string): StockTeamDefinition | undefined {
  return STOCK_TEAMS.find((t) => t.tokenSymbol === tokenSymbol);
}

export function getStockTeamByContract(contractAddress: string): StockTeamDefinition | undefined {
  const lower = contractAddress.toLowerCase();
  return STOCK_TEAMS.find((t) => t.contractAddress.toLowerCase() === lower);
}
