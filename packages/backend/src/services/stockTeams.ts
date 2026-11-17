/**
 * TICKR Stock League — roster (22 teams, LOCKED).
 *
 * Intended destination: packages/backend/src/services/stockTeams.ts.
 * This is the single source of truth for the stock league, mirroring
 * packages/shared/src/teams.ts for crypto. Index in this array = on-chain
 * teamId. The stock TeamRegistry must be deployed from this exact list,
 * in this exact order.
 *
 * Source: ~/workspace/goals/tickr-prediction-market-build/files/
 * base-tokenized-stocks.csv (Base Tokenized Stocks API snapshot, live
 * 2026-11-14), Coinbase B20 rows only. Contract addresses were
 * re-verified against the live API (https://api.coinbase.com/v1/
 * tokenized-stocks) on 2026-11-16 for NVDAc, AAPLc and GMEc; all three
 * match the CSV exactly. Season 1 is Coinbase B20 only: SPY/QQQ/BABA/
 * TSM/ASML/COST/COIN are Dinari-only and sit out.
 *
 * Fields, deliberately NOT the crypto fields:
 *   - No coinbasePair / binanceSymbol / coingeckoId. Stocks are not
 *     priced from Coinbase spot, Binance, or CoinGecko; the price source
 *     is Chainlink NAV via the Base Tokenized Stocks API. Reusing the
 *     crypto price-map fields would silently route a stock through a
 *     crypto venue. The CoinGecko last-resort tier (stockPriceFeed.ts)
 *     takes its own optional id map, never this file.
 *   - tokenSymbol is the B20 symbol (NVDAc, AAPLc, ...). Visa's B20
 *     symbol really is "Vc" (lowercase c), verified live 2026-11-16.
 *   - contractAddress is the B20 token contract on Base (0xb200...).
 *     All 22 are 8 decimals. These are the TOKEN contracts, not the
 *     Chainlink feed proxies.
 *   - multiplier is the CSV snapshot value (2026-11-14). It changes on
 *     corporate actions (dividends, splits), so NEVER price from this
 *     copy: the live multiplier arrives with every NAV poll
 *     (stockNavPoller.ts) and the contracts read it from the onchain
 *     oracle registry. This field is documentation and a sanity check.
 *   - isin is the underlying stock's ISIN, where the CSV carries one.
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
  /** Share-to-token multiplier, CSV snapshot 2026-11-14. Live value
   *  comes from the NAV API per poll; never price from this copy. */
  multiplier: number;
  /** Underlying stock ISIN. */
  isin: string;
}

export const STOCK_TEAMS: StockTeamDefinition[] = [
  { teamId: 0, ticker: "NVDA", name: "NVIDIA Corporation", tokenSymbol: "NVDAc", contractAddress: "0xb20000000000000000000078ee7ce2fE4908108C", decimals: 8, issuer: "Coinbase", multiplier: 1.0005379395763694, isin: "US67066G1040" },
  { teamId: 1, ticker: "AAPL", name: "Apple Inc.", tokenSymbol: "AAPLc", contractAddress: "0xb200000000000000000000C2e324d24d7eEcd1fb", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US0378331005" },
  { teamId: 2, ticker: "MSFT", name: "Microsoft Corporation", tokenSymbol: "MSFTc", contractAddress: "0xb200000000000000000000Ab99cFa739E253872B", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US5949181045" },
  { teamId: 3, ticker: "AMZN", name: "Amazon.com Inc.", tokenSymbol: "AMZNc", contractAddress: "0xb200000000000000000000d9192b6B456483C2E8", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US0231351067" },
  { teamId: 4, ticker: "GOOGL", name: "Alphabet Inc.", tokenSymbol: "GOOGLc", contractAddress: "0xb2000000000000000000002D0BA3164cc74f58B7", decimals: 8, issuer: "Coinbase", multiplier: 1.0003771186767842, isin: "US02079K3059" },
  { teamId: 5, ticker: "META", name: "Meta Platforms Inc.", tokenSymbol: "METAc", contractAddress: "0xb2000000000000000000008bC8786B856E61707C", decimals: 8, issuer: "Coinbase", multiplier: 1.0003137922895982, isin: "US30303M1027" },
  { teamId: 6, ticker: "TSLA", name: "Tesla Inc.", tokenSymbol: "TSLAc", contractAddress: "0xb2000000000000000000001e800a7f5189430cD0", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US88160R1014" },
  { teamId: 7, ticker: "AMD", name: "Advanced Micro Devices, Inc.", tokenSymbol: "AMDc", contractAddress: "0xB2000000000000000000000d8Ce462E99ee7A47B", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US0079031078" },
  { teamId: 8, ticker: "NFLX", name: "Netflix Inc", tokenSymbol: "NFLXc", contractAddress: "0xb20000000000000000000058B8c947e44011dFE6", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US64110L1061" },
  { teamId: 9, ticker: "AVGO", name: "Broadcom Inc.", tokenSymbol: "AVGOc", contractAddress: "0xB200000000000000000000Fc737aeA6196aB5a4c", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US11135F1012" },
  { teamId: 10, ticker: "PLTR", name: "Palantir Technologies Inc.", tokenSymbol: "PLTRc", contractAddress: "0xb2000000000000000000007d16372840dF4dAbbe", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US69608A1088" },
  { teamId: 11, ticker: "MSTR", name: "Strategy Inc.", tokenSymbol: "MSTRc", contractAddress: "0xb2000000000000000000004884b426556b92883d", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US5949724083" },
  { teamId: 12, ticker: "ORCL", name: "Oracle Corporation", tokenSymbol: "ORCLc", contractAddress: "0xb200000000000000000000347AFbA223D7B6b63C", decimals: 8, issuer: "Coinbase", multiplier: 1.0000399883233386, isin: "US68389X1054" },
  { teamId: 13, ticker: "CRM", name: "Salesforce, Inc.", tokenSymbol: "CRMc", contractAddress: "0xB2000000000000000000006432a3a7991e718DBB", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US79466L3024" },
  { teamId: 14, ticker: "JPM", name: "JPMorgan Chase & Co.", tokenSymbol: "JPMc", contractAddress: "0xB200000000000000000000FDe956536A25725156", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US46625H1005" },
  { teamId: 15, ticker: "V", name: "Visa Inc.", tokenSymbol: "Vc", contractAddress: "0xB20000000000000000000054b11Fd279a4f7D4EF", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US92826C8394" },
  { teamId: 16, ticker: "LLY", name: "Eli Lilly & Co", tokenSymbol: "LLYc", contractAddress: "0xB200000000000000000000f1a0F91e34892E4718", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US5324571083" },
  { teamId: 17, ticker: "DIS", name: "The Walt Disney Company", tokenSymbol: "DISc", contractAddress: "0xb2000000000000000000000bD75bF439A38bF7DF", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US2546871060" },
  { teamId: 18, ticker: "HOOD", name: "Robinhood Markets, Inc.", tokenSymbol: "HOODc", contractAddress: "0xb2000000000000000000006F944897540579D3f2", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US7707001027" },
  { teamId: 19, ticker: "CRCL", name: "Circle Internet Group Inc.", tokenSymbol: "CRCLc", contractAddress: "0xB20000000000000000000019f6E7C675b73C2e4D", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US1725731079" },
  { teamId: 20, ticker: "GME", name: "GameStop Corp.", tokenSymbol: "GMEc", contractAddress: "0xb2000000000000000000007790ed6E48e06eD935", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US36467W1099" },
  { teamId: 21, ticker: "AMC", name: "AMC Entertainment Holdings, Inc.", tokenSymbol: "AMCc", contractAddress: "0xB200000000000000000000CD7e6b8042cb7c2BB5", decimals: 8, issuer: "Coinbase", multiplier: 1, isin: "US00165C3025" },
];

export const STOCK_TEAM_COUNT = STOCK_TEAMS.length; // 22

/** Single round-robin: each team plays every other team once. */
export const STOCK_MATCHES_PER_TEAM = STOCK_TEAM_COUNT - 1; // 21
export const STOCK_TOTAL_FIXTURES = (STOCK_TEAM_COUNT * STOCK_MATCHES_PER_TEAM) / 2; // 231

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
