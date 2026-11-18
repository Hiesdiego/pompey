/**
 * Stock League roster (Season 1, locked, 12-team revision Nov 18 2026).
 *
 * Target location in the repo:
 *   packages/frontend/src/lib/stockTeams.ts
 *
 * 12 teams, teamId 0 to 11, double round-robin, home and away, 22 rounds,
 * 6 fixtures per round, 132 fixtures, Nov 26 to Dec 16 2026. Nov 26 to
 * Dec 16 inclusive is 21 days, so 22 rounds need one double-header day:
 * the Dec 16 finale hosts rounds 21 and 22 in two waves, morning and
 * evening. See stockFormat.ts for the round-to-date mapping.
 *
 * Season 1 is Coinbase B20 only. The 13 sidelined teams (AMD, NFLX,
 * AVGO, PLTR, ORCL, CRM, JPM, V, LLY, DIS, HOOD, GME, AMC) return for
 * Season 2. INTC, SNDK and SPCX are new in this 12-team roster, they
 * were not in the 22-team roster. All 12 teams were verified with live
 * NAV on Nov 18 2026.
 *
 * Symbols carry the "c" suffix for the Coinbase tokenized form, for
 * example NVDAc. Names are the full company names, used on cards and
 * tables. No CoinGecko dependency anywhere in this file. Logos are
 * remote brand logos, verified live Nov 18 2026: DuckDuckGo favicons
 * for 10 teams, Simple Icons for Strategy (microstrategy) and Circle
 * (circle). Every URL below answered HTTP 200 on Nov 18 2026. The
 * local /public/stock-logos/ folder was never shipped, so never point
 * a logo there. StockTeamBadge still falls back to a letter avatar if
 * a logo fails to load, so a missing logo never blocks the table or a
 * fixture.
 *
 * Token contract addresses are intentionally blank here. Do not invent
 * them. Fill tokenContract after the Coinbase B20 token list is verified
 * against the deployed TeamRegistry. An empty string means "not verified
 * yet", and StockTeamBadge treats it as logo-only, never as an error.
 *
 * Decimals: 8, matching the StockPriceOracle NAV scale (1e8).
 *
 * TeamId overlap warning: stock teamIds 0 to 11 overlap crypto teamIds,
 * so live prices must be namespaced per league, never keyed by bare
 * teamId alone. Stock prices arrive through useStockLiveFeed, keyed by
 * stock teamId only, and are never merged into the crypto price map.
 */

export interface StockTeam {
  teamId: number;
  name: string;
  shortName: string;
  symbol: string;
  /** Coinbase B20 token contract address, "" until verified on-chain. */
  tokenContract: string;
  decimals: 8;
  /** Remote brand logo URL (verified live Nov 18 2026); letter-avatar fallback on error. */
  logoPath: string;
}

export const STOCK_TEAMS: StockTeam[] = [
  { teamId: 0, name: "NVIDIA Corporation", shortName: "NVIDIA", symbol: "NVDAc", tokenContract: "", decimals: 8, logoPath: "https://icons.duckduckgo.com/ip3/nvidia.com.ico" },
  { teamId: 1, name: "Apple Inc.", shortName: "Apple", symbol: "AAPLc", tokenContract: "", decimals: 8, logoPath: "https://icons.duckduckgo.com/ip3/apple.com.ico" },
  { teamId: 2, name: "Microsoft Corporation", shortName: "Microsoft", symbol: "MSFTc", tokenContract: "", decimals: 8, logoPath: "https://icons.duckduckgo.com/ip3/microsoft.com.ico" },
  { teamId: 3, name: "Amazon.com, Inc.", shortName: "Amazon", symbol: "AMZNc", tokenContract: "", decimals: 8, logoPath: "https://icons.duckduckgo.com/ip3/amazon.com.ico" },
  { teamId: 4, name: "Alphabet Inc.", shortName: "Alphabet", symbol: "GOOGLc", tokenContract: "", decimals: 8, logoPath: "https://icons.duckduckgo.com/ip3/google.com.ico" },
  { teamId: 5, name: "Meta Platforms, Inc.", shortName: "Meta", symbol: "METAc", tokenContract: "", decimals: 8, logoPath: "https://icons.duckduckgo.com/ip3/meta.com.ico" },
  { teamId: 6, name: "Tesla, Inc.", shortName: "Tesla", symbol: "TSLAc", tokenContract: "", decimals: 8, logoPath: "https://icons.duckduckgo.com/ip3/tesla.com.ico" },
  { teamId: 7, name: "Strategy Inc.", shortName: "Strategy", symbol: "MSTRc", tokenContract: "", decimals: 8, logoPath: "https://cdn.simpleicons.org/microstrategy" },
  { teamId: 8, name: "Circle Internet Group, Inc.", shortName: "Circle", symbol: "CRCLc", tokenContract: "", decimals: 8, logoPath: "https://cdn.simpleicons.org/circle" },
  { teamId: 9, name: "Intel Corporation", shortName: "Intel", symbol: "INTCc", tokenContract: "", decimals: 8, logoPath: "https://icons.duckduckgo.com/ip3/intel.com.ico" },
  { teamId: 10, name: "SanDisk Corporation", shortName: "SanDisk", symbol: "SNDKc", tokenContract: "", decimals: 8, logoPath: "https://icons.duckduckgo.com/ip3/sandisk.com.ico" },
  { teamId: 11, name: "SpaceX", shortName: "SpaceX", symbol: "SPCXc", tokenContract: "", decimals: 8, logoPath: "https://icons.duckduckgo.com/ip3/spacex.com.ico" },
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
