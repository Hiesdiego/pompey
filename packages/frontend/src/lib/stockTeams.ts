/**
 * Stock League roster (Season 1, locked).
 *
 * Target location in the repo:
 *   packages/frontend/src/lib/stockTeams.ts
 *
 * 22 teams, teamId 0 to 21, single round-robin, 21 matchdays.
 * Season 1 is Coinbase B20 only. SPY, QQQ, BABA, TSM, ASML, COST and COIN
 * are Dinari-only and sit out Season 1. GME and AMC are the two added
 * teams, the meme pair, highest retail recognition and 1-hour volatility,
 * both Coinbase B20 (GMEc, AMMc), a natural derby.
 *
 * Symbols carry the "c" suffix for the Coinbase tokenized form, for
 * example NVDAc. Names are the full company names, used on cards and
 * tables. No CoinGecko dependency anywhere in this file: logos resolve
 * from local static assets under /public/stock-logos/ first, then fall
 * back to a letter avatar. Add one SVG per symbol there before launch,
 * for example /public/stock-logos/nvdac.svg. If a logo file is missing,
 * the UI still renders, it never blocks the table or a fixture.
 *
 * Token contract addresses are intentionally blank here. Do not invent
 * them. Fill tokenContract after the Coinbase B20 token list is verified
 * against the deployed TeamRegistry. An empty string means "not verified
 * yet", and StockTeamBadge treats it as logo-only, never as an error.
 *
 * Decimals: 8, matching the StockPriceOracle NAV scale (1e8).
 */

export interface StockTeam {
  teamId: number;
  name: string;
  shortName: string;
  symbol: string;
  /** Coinbase B20 token contract address, "" until verified on-chain. */
  tokenContract: string;
  decimals: 8;
  /** Local logo path, /public/stock-logos/<symbol-lowercase>.svg. */
  logoPath: string;
}

export const STOCK_TEAMS: StockTeam[] = [
  { teamId: 0, name: "NVIDIA Corporation", shortName: "NVIDIA", symbol: "NVDAc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/nvdac.svg" },
  { teamId: 1, name: "Apple Inc.", shortName: "Apple", symbol: "AAPLc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/aaplc.svg" },
  { teamId: 2, name: "Microsoft Corporation", shortName: "Microsoft", symbol: "MSFTc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/msftc.svg" },
  { teamId: 3, name: "Amazon.com, Inc.", shortName: "Amazon", symbol: "AMZNc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/amznc.svg" },
  { teamId: 4, name: "Alphabet Inc.", shortName: "Alphabet", symbol: "GOOGLc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/googlc.svg" },
  { teamId: 5, name: "Meta Platforms, Inc.", shortName: "Meta", symbol: "METAc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/metac.svg" },
  { teamId: 6, name: "Tesla, Inc.", shortName: "Tesla", symbol: "TSLAc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/tslac.svg" },
  { teamId: 7, name: "Advanced Micro Devices, Inc.", shortName: "AMD", symbol: "AMDc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/amdc.svg" },
  { teamId: 8, name: "Netflix, Inc.", shortName: "Netflix", symbol: "NFLXc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/nflxc.svg" },
  { teamId: 9, name: "Broadcom Inc.", shortName: "Broadcom", symbol: "AVGOc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/avgoc.svg" },
  { teamId: 10, name: "Palantir Technologies Inc.", shortName: "Palantir", symbol: "PLTRc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/pltrc.svg" },
  { teamId: 11, name: "Strategy Inc.", shortName: "Strategy", symbol: "MSTRc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/mstrc.svg" },
  { teamId: 12, name: "Oracle Corporation", shortName: "Oracle", symbol: "ORCLc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/orclc.svg" },
  { teamId: 13, name: "Salesforce, Inc.", shortName: "Salesforce", symbol: "CRMc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/crmc.svg" },
  { teamId: 14, name: "JPMorgan Chase and Co.", shortName: "JPMorgan", symbol: "JPMc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/jpmc.svg" },
  { teamId: 15, name: "Visa Inc.", shortName: "Visa", symbol: "Vc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/vc.svg" },
  { teamId: 16, name: "Eli Lilly and Company", shortName: "Eli Lilly", symbol: "LLYc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/llyc.svg" },
  { teamId: 17, name: "The Walt Disney Company", shortName: "Disney", symbol: "DISc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/disc.svg" },
  { teamId: 18, name: "Robinhood Markets, Inc.", shortName: "Robinhood", symbol: "HOODc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/hoodc.svg" },
  { teamId: 19, name: "Circle Internet Group, Inc.", shortName: "Circle", symbol: "CRCLc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/crclc.svg" },
  { teamId: 20, name: "GameStop Corp.", shortName: "GameStop", symbol: "GMEc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/gmec.svg" },
  { teamId: 21, name: "AMC Entertainment Holdings, Inc.", shortName: "AMC", symbol: "AMCc", tokenContract: "", decimals: 8, logoPath: "/stock-logos/amcc.svg" },
];

export function stockTeamById(teamId: number): StockTeam | undefined {
  return STOCK_TEAMS.find((t) => t.teamId === teamId);
}

export function stockTeamBySymbol(symbol: string): StockTeam | undefined {
  return STOCK_TEAMS.find((t) => t.symbol === symbol);
}

/** "NVDAc" style display symbol for a teamId, "Team #n" when unknown. */
export function stockSymbol(teamId: number): string {
  return stockTeamById(teamId)?.symbol ?? `Team #${teamId}`;
}

/** Full company name for a teamId, used on cards and match pages. */
export function stockName(teamId: number): string {
  return stockTeamById(teamId)?.name ?? `Team #${teamId}`;
}
