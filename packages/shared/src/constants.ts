/**
 * TICKR v0.1 protocol constants — shared across contracts, backend, frontend.
 * Keep these in sync with PredictionPool.sol / MatchRegistry.sol once written.
 */

export const TICKR_V01_CONFIG = {
  // Match engine
  MATCH_DURATION_SECONDS: 45 * 60, // 45 min default match length
  KICKOFF_REVEAL_MIN_SECONDS: 30 * 60, // earliest reveal: 30 min before kickoff
  KICKOFF_REVEAL_MAX_SECONDS: 120 * 60, // latest reveal: 120 min before kickoff

  // Draw rule: round each coin's % change to nearest whole integer.
  // Equal rounded integers => draw. (Implemented in PriceOracle.sol)
  SCORE_ROUNDING: "nearest-integer" as const,

  // Staking
  STAKE_TOKEN_SYMBOL: "TICK",
  MIN_STAKE_TICK: 10, // $10-equivalent minimum, denominated in TICK for v0.1
  PLATFORM_FEE_BPS: 700, // 7% (5-10% range agreed) — basis points, 700 = 7.00%

  // League scoring
  POINTS_WIN: 3,
  POINTS_DRAW: 1,
  POINTS_LOSS: 0,

  // Matchday cadence
  MATCHES_PER_DAY: 3,
} as const;

export const OUTCOME = {
  WIN_HOME: 0,
  DRAW: 1,
  WIN_AWAY: 2,
} as const;

export type OutcomeType = (typeof OUTCOME)[keyof typeof OUTCOME];
