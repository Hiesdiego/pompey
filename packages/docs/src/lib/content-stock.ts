/**
 * TICKR Stock League docs content.
 *
 * 12-TEAM REVISION, locked Nov 18 2026. Supersedes the Nov 16 2026 22-team
 * version. Season 1: 12 teams, double round-robin, 22 rounds, 6 fixtures
 * per round, 132 fixtures, 21 matchdays, Nov 26 to Dec 16 2026. The Dec 16
 * finale hosts rounds 21 and 22 in two waves (morning and evening), 12
 * fixtures that day.
 *
 * MERGE INSTRUCTIONS
 * ------------------
 * 1. This file is modelled on the docs content module shape
 *    (packages/docs/src/lib/content.ts in the docs package). The tickr-stock
 *    branch now has packages/docs/src/lib/content-stock.ts: merge this file
 *    there, do not create a second copy. Adapt the import paths below to
 *    match the branch.
 * 2. Copy this file to packages/docs/src/lib/content-stock.ts, or merge its
 *    exports into the existing content.ts if one exists by then. Do not paste
 *    it over the crypto league content. The stock sections are additive.
 * 3. Wire the new sections into the docs navigation and the docs index page,
 *    under a "Stock League" group, in this order: Scoring, How to Play, FAQ,
 *    Glossary.
 * 4. Wire the scoring constants into the frontend from the same source of
 *    truth as the contracts: BPS_PER_GOAL = 5, MAX_GOALS_PER_TEAM = 10,
 *    VOLATILE_CAP_BPS = 300, CIRCUIT_BREAKER_SPIKE_BPS = 3000.
 * 5. No em dash anywhere in user-facing copy. Use commas, periods, or colons.
 * 6. The copy below is locked to the Nov 18 2026 decisions. If a locked value
 *    changes (threshold, cap, dates, roster), update stock-scoring.md,
 *    stock-how-to-play.md, and stock-faq.md first, then update this file to
 *    match. Never edit this file alone.
 * 7. The deployed 22-team StockMatchRegistry
 *    0xc3a04de16ec15947d39ac1c27914c67e480ba019 (fixtureCount 231) CANNOT be
 *    reused for the 12-team season. The redo path is a fresh StockTeamRegistry
 *    (12 teams) plus a fresh StockMatchRegistry, then generate the 22-round
 *    schedule and seed it.
 */

export interface DocsSection {
  slug: string;
  title: string;
  group: "stock-league";
  updated: string;
  body: string;
}

export interface StockTeam {
  teamId: number;
  name: string;
  ticker: string;
  symbol: string;
  sector: string;
}

export interface ScoringBand {
  minMoveBps: number;
  maxMoveBps: number;
  goals: number;
}

/** 1 goal = 0.05% = 5 bps. Locked Nov 18 2026. */
export const STOCK_BPS_PER_GOAL = 5;
/** Half-goal value in bps, integer math: 5 / 2 = 2. */
export const STOCK_HALF_GOAL_BPS = 2;
/** Max goals per team per match, applied to the final scoreline. */
export const STOCK_MAX_GOALS_PER_TEAM = 10;
/** Raw volatile cap: 3% = 300 bps. Above this, circuit breaker review. */
export const STOCK_VOLATILE_CAP_BPS = 300;
/** Hard circuit breaker, same as crypto: plus or minus 30%. */
export const STOCK_CIRCUIT_BREAKER_SPIKE_BPS = 3000;
/** Points for a win, a draw, a loss. */
export const STOCK_POINTS_WIN = 3;
export const STOCK_POINTS_DRAW = 1;
export const STOCK_POINTS_LOSS = 0;
/** Forfeit scoreline when one team has no performance. */
export const STOCK_FORFEIT_HOME_GOALS = 0;
export const STOCK_FORFEIT_AWAY_GOALS = 3;
/** Pool economics, same as the crypto league. */
export const STOCK_POOL_FEE_BPS = 700;
export const STOCK_FIXTURE_SEED_TICK = 250;
export const STOCK_MIN_STAKE_TICK = 10;
/** Season window. */
export const STOCK_SEASON_START = "2026-11-26";
export const STOCK_SEASON_END = "2026-12-16";
export const STOCK_TEAM_COUNT = 12;
export const STOCK_ROUND_COUNT = 22;
export const STOCK_FIXTURES_PER_ROUND = 6;
export const STOCK_FIXTURE_COUNT = 132;
export const STOCK_MATCHDAY_COUNT = 21;
/** Dec 16 finale hosts rounds 21 and 22 in two waves, 12 fixtures. */
export const STOCK_FINALE_DATE = "2026-12-16";
export const STOCK_FINALE_FIXTURES = 12;
/** Last-NAV rule, approved Nov 18 2026: last NAV no older than the 24h
 * heartbeat plus a short grace allowance, feed healthy but quiet. The exact
 * grace length is backend config; every use of a carried-over NAV is logged.
 * The rule never fabricates a price and does not fix a team with no NAV. */
export const STOCK_LAST_NAV_MAX_AGE_HOURS = 24;
/** Price feed. */
export const STOCK_NAV_ORACLE_REGISTRY =
  "0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD";
export const STOCK_TICK_TOKEN =
  "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b";
/** Deployed 22-team StockMatchRegistry, fixtureCount 231. Superseded, it
 * CANNOT be reused for the 12-team season. Kept here so no one wires the
 * new season to it by mistake. */
export const STOCK_LEGACY_22_TEAM_MATCH_REGISTRY =
  "0xc3a04de16ec15947d39ac1c27914c67e480ba019";
/** Table tiebreak order, same as the crypto league. */
export const STOCK_TIEBREAK_ORDER = [
  "points",
  "goal difference",
  "goals scored",
  "wins",
  "fewest losses",
] as const;

/**
 * Season 1 roster, teamId 0 to 11, in locked order. All Coinbase B20,
 * symbol is the ticker plus `c`. All 12 verified with a live NAV on
 * Nov 18 2026. INTC, SNDK, and SPCX are new, not in the 22-team roster.
 */
export const STOCK_ROSTER: StockTeam[] = [
  { teamId: 0, name: "NVIDIA", ticker: "NVDA", symbol: "NVDAc", sector: "Semiconductors" },
  { teamId: 1, name: "Apple", ticker: "AAPL", symbol: "AAPLc", sector: "Consumer electronics" },
  { teamId: 2, name: "Microsoft", ticker: "MSFT", symbol: "MSFTc", sector: "Software" },
  { teamId: 3, name: "Amazon", ticker: "AMZN", symbol: "AMZNc", sector: "E-commerce and cloud" },
  { teamId: 4, name: "Alphabet", ticker: "GOOGL", symbol: "GOOGLc", sector: "Internet" },
  { teamId: 5, name: "Meta", ticker: "META", symbol: "METAc", sector: "Social media" },
  { teamId: 6, name: "Tesla", ticker: "TSLA", symbol: "TSLAc", sector: "Electric vehicles" },
  { teamId: 7, name: "Strategy", ticker: "MSTR", symbol: "MSTRc", sector: "Bitcoin treasury" },
  { teamId: 8, name: "Circle", ticker: "CRCL", symbol: "CRCLc", sector: "Stablecoins" },
  { teamId: 9, name: "Intel", ticker: "INTC", symbol: "INTCc", sector: "Semiconductors" },
  { teamId: 10, name: "SanDisk", ticker: "SNDK", symbol: "SNDKc", sector: "Data storage" },
  { teamId: 11, name: "SpaceX", ticker: "SPCX", symbol: "SPCXc", sector: "Space exploration" },
];

/**
 * The 13 sidelined teams from the superseded 22-team plan. They return for
 * Season 2. GameStop and AMC headline the Meme Arena later. Recorded here
 * so the Season 2 roster and the future price-target market list (all 22
 * stocks, not just the 12 league teams) start from one list.
 */
export const STOCK_SIDELINED_TEAMS: StockTeam[] = [
  { teamId: -1, name: "AMD", ticker: "AMD", symbol: "AMDc", sector: "Semiconductors" },
  { teamId: -1, name: "Netflix", ticker: "NFLX", symbol: "NFLXc", sector: "Streaming" },
  { teamId: -1, name: "Broadcom", ticker: "AVGO", symbol: "AVGOc", sector: "Semiconductors" },
  { teamId: -1, name: "Palantir", ticker: "PLTR", symbol: "PLTRc", sector: "Software" },
  { teamId: -1, name: "Oracle", ticker: "ORCL", symbol: "ORCLc", sector: "Software" },
  { teamId: -1, name: "Salesforce", ticker: "CRM", symbol: "CRMc", sector: "Software" },
  { teamId: -1, name: "JPMorgan", ticker: "JPM", symbol: "JPMc", sector: "Banking" },
  { teamId: -1, name: "Visa", ticker: "V", symbol: "Vc", sector: "Payments" },
  { teamId: -1, name: "Eli Lilly", ticker: "LLY", symbol: "LLYc", sector: "Pharmaceuticals" },
  { teamId: -1, name: "Disney", ticker: "DIS", symbol: "DISc", sector: "Entertainment" },
  { teamId: -1, name: "Robinhood", ticker: "HOOD", symbol: "HOODc", sector: "Brokerage" },
  { teamId: -1, name: "GameStop", ticker: "GME", symbol: "GMEc", sector: "Retail, meme" },
  { teamId: -1, name: "AMC", ticker: "AMC", symbol: "AMCc", sector: "Cinemas, meme" },
];

/**
 * Goal bands for positive moves, from the on-chain integer math:
 * goals = (moveBps + 2) / 5. Negative moves mirror these bands.
 * The price move truncates to integer basis points; a 0.025% move truncates
 * to 2 bps and scores 0, while 0.03% (3 bps) scores the first goal.
 */
export const STOCK_SCORING_BANDS: ScoringBand[] = [
  { minMoveBps: -2, maxMoveBps: 2, goals: 0 },
  { minMoveBps: 3, maxMoveBps: 7, goals: 1 },
  { minMoveBps: 8, maxMoveBps: 12, goals: 2 },
  { minMoveBps: 13, maxMoveBps: 17, goals: 3 },
  { minMoveBps: 18, maxMoveBps: 22, goals: 4 },
  { minMoveBps: 23, maxMoveBps: 27, goals: 5 },
  { minMoveBps: 28, maxMoveBps: 32, goals: 6 },
  { minMoveBps: 33, maxMoveBps: 37, goals: 7 },
  { minMoveBps: 38, maxMoveBps: 42, goals: 8 },
  { minMoveBps: 43, maxMoveBps: 47, goals: 9 },
  { minMoveBps: 48, maxMoveBps: 52, goals: 10 },
];

/**
 * Convert a raw percentage move in basis points to raw goals, half-up
 * rounding, mirroring the on-chain integer math (BPS_PER_GOAL = 5,
 * half-goal value 2 bps). Negative moves round away from zero.
 */
export function stockRawGoals(moveBps: number): number {
  const bps = Math.trunc(moveBps);
  if (bps >= 0) {
    return Math.floor((bps + STOCK_HALF_GOAL_BPS) / STOCK_BPS_PER_GOAL);
  }
  return Math.ceil((bps - STOCK_HALF_GOAL_BPS) / STOCK_BPS_PER_GOAL);
}

/**
 * No-negative scoreline, exactly like the crypto league. A team's fall
 * counts as goals for its opponent. Returns [homeGoals, awayGoals],
 * capped at STOCK_MAX_GOALS_PER_TEAM per team.
 */
export function stockScoreline(rawHome: number, rawAway: number): [number, number] {
  const home = Math.max(0, rawHome) + Math.max(0, -rawAway);
  const away = Math.max(0, rawAway) + Math.max(0, -rawHome);
  return [
    Math.min(home, STOCK_MAX_GOALS_PER_TEAM),
    Math.min(away, STOCK_MAX_GOALS_PER_TEAM),
  ];
}

/** Points for a result: "W" win, "D" draw, "L" loss. */
export function stockPoints(result: "W" | "D" | "L"): number {
  if (result === "W") return STOCK_POINTS_WIN;
  if (result === "D") return STOCK_POINTS_DRAW;
  return STOCK_POINTS_LOSS;
}

export const STOCK_SCORING_SECTION: DocsSection = {
  slug: "stock-league/scoring",
  title: "Stock League scoring",
  group: "stock-league",
  updated: "2026-11-18",
  body: [
    "A stock league match lasts 1 hour. Each team scores 1 goal for every 0.05% its tokenized stock price moves in that hour. The team with more goals wins the match.",
    "",
    "The goal rule: 1 goal = 0.05% (5 basis points, BPS_PER_GOAL = 5), half-up rounding. The price move truncates to integer basis points first, so a move of 0.03% scores the first goal, 0.08% the second, 0.13% the third, and so on. Moves from -0.02% to +0.02% score 0 goals.",
    "",
    "No-negative scorelines, exactly like the crypto league: G_home = max(0, r_h) + max(0, -r_a), G_away = max(0, r_a) + max(0, -r_h). A team's fall counts as goals for its opponent, so no scoreline ever goes below zero.",
    "",
    "Max 10 goals per team per match, applied to the final scoreline. Raw volatile moves are capped at 3%, with circuit breaker review above that line. The hard circuit breaker is the same as crypto: a raw price spike of plus or minus 30% by either team inside the match window pauses settlement.",
    "",
    "Points: 3 for a win, 1 for a draw, 0 for a loss. Table tiebreak, in order: points, then goal difference, then goals scored, then wins, then fewest losses.",
    "",
    "Forfeit: if a stock has no performance for the match period, that team forfeits and the opponent wins 3-0, marked FORFEIT. If both teams have no performance, the match is void and stakes are refunded 1:1 in full.",
    "",
    "Last-NAV rule, approved Nov 18 2026: when the feed is healthy but quiet, the backend accepts the last NAV as the end price, as long as that NAV is no older than 24 hours plus a short grace allowance (the 24-hour heartbeat). The backend never fabricates a price, it only reuses a real, published NAV, and every use of a carried-over NAV is logged. The rule does not fix a team with no NAV at all, which is why the roster shrank from 22 teams to 12.",
    "",
    "Price feed: Chainlink NAV via the Base Tokenized Stocks API, oracle registry 0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD. If the last NAV is older than 24 hours plus grace, or the feed is unhealthy, the snapshot is blocked, exactly like the crypto league. CoinGecko is the last resort only, and only if it has a price. Dinari is not a fallback: its API is enterprise and key-gated, and it is used only if the user supplies a DINARI_API_KEY_ID.",
    "",
    "Season 1: 12 teams, double round-robin, 22 rounds, 6 fixtures per round, 132 fixtures, 21 matchdays, Nov 26 to Dec 16 2026. The Dec 16 finale hosts rounds 21 and 22 in two waves (morning and evening), 12 fixtures that day. 1-hour matches, staggered randomly across each matchday.",
    "",
    "Season setup: the deployed 22-team StockMatchRegistry 0xc3a04de16ec15947d39ac1c27914c67e480ba019 (fixtureCount 231) cannot be reused. The redo path is a fresh StockTeamRegistry with the 12 teams plus a fresh StockMatchRegistry, then generate the 22-round schedule and seed it.",
    "",
    "How it differs from crypto: only the goal threshold changed, 0.05% instead of 0.5%, because stocks move about ten times less than crypto in an hour. The rounding, the no-negative formula, the points, the tiebreak order, the 7% pool fee, and the treasury rule are all the same.",
  ].join("\n"),
};

export const STOCK_HOW_TO_PLAY_SECTION: DocsSection = {
  slug: "stock-league/how-to-play",
  title: "Stock League: how to play",
  group: "stock-league",
  updated: "2026-11-18",
  body: [
    "If you already play the crypto league, you already know this game. The stock league is the same game with different teams: tokenized stocks on Base instead of cryptocurrencies.",
    "",
    "1. Sign in and get TICK. TICK is the same ERC-20 staking token used across all of TICKR, and your balance is shared between the crypto league and the stock league. Minimum stake is 10 TICK.",
    "",
    "2. Pick a match. Fixtures default to all matches for the day, crypto and stock together, with an All / Crypto / Stocks switcher. Pick a stock match that has not kicked off yet. Staking closes at kickoff. A matchday has 6 stock fixtures, except the Dec 16 finale, which hosts rounds 21 and 22 in two waves (morning and evening), 12 fixtures that day.",
    "",
    "3. Choose your outcome, home win, draw, or away win, enter your TICK amount, and confirm. Every match pool is seeded with 250 TICK.",
    "",
    "4. Watch the match live. 1 goal equals 0.05% of price movement, so scores move more often than in the crypto league. The live score is cumulative price movement, so goals can appear and disappear as prices move.",
    "",
    "5. Claim after settlement. At full time the backend submits the end prices on chain and the match settles. Winners share the total pool minus a 7% fee, in proportion to stake. If nobody backed the winning outcome, the whole pool goes to the Tickr treasury.",
    "",
    "Forfeit and void: if one stock has no performance for the match period, that team forfeits and the opponent wins 3-0, marked FORFEIT. If both stocks have no performance, the match is void and every stake is refunded 1:1 in full.",
    "",
    "Stale prices and the last-NAV rule: when the feed is healthy but quiet, the backend accepts the last NAV as the end price, as long as that NAV is no older than 24 hours plus a short grace allowance. The backend never fabricates a price, and every use of a carried-over NAV is logged. The rule does not fix a team with no NAV at all, which is why the roster shrank from 22 teams to 12.",
    "",
    "TickrPoints (TP): one unified leaderboard for all of TICKR. Stock league results count toward the same TP total as crypto league results. There is no separate stock leaderboard, because the crypto PlayerStats contract has a one-time setter for its prediction pool and it is already set to the crypto pool, so the stock pool cannot write to it. The backend aggregates crypto and stock results off chain into one unified TP total.",
  ].join("\n"),
};

export const STOCK_FAQ_SECTION: DocsSection = {
  slug: "stock-league/faq",
  title: "Stock League FAQ",
  group: "stock-league",
  updated: "2026-11-18",
  body: [
    "Why is 1 goal 0.05% for stocks and not 0.5% like crypto? Stocks move far less than crypto in an hour. A large-cap stock moves about 0.04% to 0.15% in a typical hour. At 0.5% per goal, almost every stock match would end 0-0. The 0.05% threshold keeps stock matches live.",
    "",
    "Why are stock matches 1 hour and not 24 hours? The 1-hour format is proven in the crypto league, and the finer 0.05% threshold makes 1-hour stock matches live. Keeping 1-hour matches means one match engine shape, one staking flow, and one live experience across both leagues.",
    "",
    "Why 12 teams? The Nov 16 plan had 22 teams, but on Nov 17 the Coinbase tokenized stocks API returned far fewer live NAV prices, and 13 of the 22 rostered teams had no usable NAV at all. The roster was cut on Nov 18 to the 12 teams with a live NAV. 12 teams gives a double round-robin, 22 rounds, 6 fixtures per round, 132 fixtures, Nov 26 to Dec 16 2026. Nov 26 to Dec 16 inclusive is 21 days, so the Dec 16 finale hosts rounds 21 and 22 in two waves (morning and evening), 12 fixtures that day.",
    "",
    "What is NAV? Net Asset Value: the reference value of the tokenized stock, based on the underlying share price. The Base Tokenized Stocks API returns nav_price, nav_price_updated_at, and the current multiplier per token. The on-chain oracle registry is 0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD.",
    "",
    "What happens if the NAV is stale? Under the last-NAV rule, approved Nov 18 2026, when the feed is healthy but quiet the backend accepts the last NAV as the end price, as long as that NAV is no older than 24 hours plus a short grace allowance. The backend never fabricates a price, and every use of a carried-over NAV is logged. If the last NAV is older than 24 hours plus grace, or the feed is unhealthy, the snapshot is blocked. The rule does not fix a team with no NAV at all, which is why the roster shrank from 22 teams to 12.",
    "",
    "What is a forfeit? If a stock has no performance for the match period, that team forfeits and the opponent wins 3-0, marked FORFEIT. If both teams have no performance, the match is void and stakes are refunded 1:1 in full. A stock that falls hard still played the match. Only a missing price, not a bad price, causes a forfeit.",
    "",
    "Can the deployed 22-team StockMatchRegistry be reused? No. The deployed registry 0xc3a04de16ec15947d39ac1c27914c67e480ba019 already has fixtureCount 231 for the 22-team season and cannot be reused. The redo path is a fresh StockTeamRegistry with the 12 teams plus a fresh StockMatchRegistry, then generate the 22-round schedule and seed it.",
    "",
    "What is Dinari? The other issuer of tokenized stocks on Base, issuing dShares with plain ticker symbols. Its API is enterprise and key-gated, not a free public price feed, so it is not a drop-in fallback. It is used only if the user supplies a DINARI_API_KEY_ID. Dinari-only stocks sit out Season 1.",
    "",
    "Can every stock appear in price-target markets? Not in Season 1. No price-target markets are built in this revision. It is a noted future requirement that every stock (all 22, not just the 12 league teams) can appear in the market list for price-target creation, to be brainstormed and built later.",
    "",
    "Why is there no separate stock leaderboard? The crypto PlayerStats contract has a one-time setter for its prediction pool, and it is already set to the crypto pool, so the stock pool cannot write to it. The backend aggregates crypto and stock results off chain into one unified TP leaderboard.",
    "",
    "Are the stock contracts upgradeable? Yes. The stock stack uses the UUPS upgradeable pattern, so logic contracts can be upgraded through the proxy without redeploying the whole stack or losing state. That is a change from the crypto league and cup, where one-time setters forced a full fresh stack redeploy for any scoring or logic change.",
    "",
    "Will the stock league use more data? No more than the crypto league. The backend runs on a hard cap of 1GB of bandwidth per month, and the stock loop follows the same pattern as crypto: live polling with a hot/idle pattern, no backend WebSocket price feed.",
  ].join("\n"),
};

export const STOCK_GLOSSARY_SECTION: DocsSection = {
  slug: "stock-league/glossary",
  title: "Stock League glossary",
  group: "stock-league",
  updated: "2026-11-18",
  body: [
    "See stock-glossary.md for the full glossary. Terms covered: NAV, B20, Dinari, double round-robin, forfeit, void, TP, UUPS, checkpoint, snapshot, basis point, circuit breaker, outright pool, parimutuel, staking window, last-NAV rule, round, and matchday.",
  ].join("\n"),
};

/** All stock league docs sections, in navigation order. */
export const STOCK_DOCS_SECTIONS: DocsSection[] = [
  STOCK_SCORING_SECTION,
  STOCK_HOW_TO_PLAY_SECTION,
  STOCK_FAQ_SECTION,
  STOCK_GLOSSARY_SECTION,
];

/**
 * Stock league versus crypto league, for the docs comparison table.
 * Only the goal threshold, the feed, the goal cap, the volatile cap, and the
 * forfeit and void rules differ. Everything else is the same game.
 */
export const STOCK_VS_CRYPTO = [
  { label: "Goal threshold", crypto: "1 goal = 0.5% (50 bps)", stock: "1 goal = 0.05% (5 bps)" },
  { label: "Match window", crypto: "1 hour", stock: "1 hour" },
  { label: "Price feed", crypto: "Coinbase, Binance, CoinGecko", stock: "Chainlink NAV via Base API, CoinGecko last resort" },
  { label: "Rounding", crypto: "Half-up", stock: "Half-up, truncated to integer bps first" },
  { label: "No-negative scorelines", crypto: "Yes", stock: "Yes, same formula" },
  { label: "Points", crypto: "3 / 1 / 0", stock: "3 / 1 / 0" },
  { label: "Table tiebreak", crypto: "Points, GD, GF, wins, fewest losses", stock: "Same order" },
  { label: "Goal cap", crypto: "None stated", stock: "10 per team per match" },
  { label: "Volatile cap", crypto: "None stated", stock: "3% raw, plus circuit breaker review" },
  { label: "Circuit breaker", crypto: "Plus or minus 30% raw spike", stock: "Same" },
  { label: "Forfeit", crypto: "None stated", stock: "No performance, 0-3, marked FORFEIT" },
  { label: "Void", crypto: "None stated", stock: "Both no performance, stakes refunded 1:1" },
  { label: "Pool fee", crypto: "7%", stock: "7%" },
  { label: "Fixture seed", crypto: "250 TICK", stock: "250 TICK" },
  { label: "Minimum stake", crypto: "10 TICK", stock: "10 TICK" },
  { label: "Staking token", crypto: "TICK", stock: "TICK, same token" },
  { label: "TP leaderboard", crypto: "Unified", stock: "Unified, same leaderboard" },
] as const;
