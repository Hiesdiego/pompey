/**
 * Stock League scoring and formatting helpers.
 *
 * Target location in the repo:
 *   packages/frontend/src/lib/stockFormat.ts
 *
 * Scoring, locked, document everywhere it is used:
 *   1 goal = 0.05% (5 bps), integer basis point math, no-negative
 *   scorelines exactly like crypto, max 10 goals per team per match,
 *   raw volatile cap 3% with circuit breaker review, 3 pts win / 1 draw
 *   / 0 loss, tiebreak points, GD, GF, wins, fewest losses.
 *   Forfeit: no performance for that period means 0-3, opponent wins
 *   3-0, marked FORFEIT. Both sides missing means void, stakes refunded.
 *
 * Crypto comparison, for reviewers: crypto is 1 goal = 0.5% (50 bps).
 * Stocks move far less in 1 hour, so the stock threshold is 10x finer:
 * 1 goal = 0.05% (5 bps). Integer math truncates the move to basis
 * points, and the on-chain half-up offset truncates 5 / 2 to 2 bps, so
 * 0.03% (3 bps) is the first scoring move, not 0.025%. The shape of
 * the math is identical, only the constant changes. Do not copy the
 * crypto 50/25 constants here, and do not restore a 2.5 bps threshold
 * in this file, the on-chain oracle cannot represent it.
 *
 * Price rule, user approved Nov 18 2026: accept the last NAV within
 * the 24h heartbeat as the end price when the feed is healthy but
 * quiet. That rule does NOT fix teams with no NAV at all, which is why
 * the roster is 12 teams. The rule lives in the backend and the
 * oracle, not in these helpers, which only convert a % move to goals.
 *
 * All timestamps in the stock league are UTC. The helpers below format
 * in UTC explicitly (timeZone: "UTC"), never in the device local zone.
 * There is no utcTime.ts in the repo at origin/main bad5ca6, so these
 * helpers are self-contained and do not import it.
 *
 * Worked examples (also shown in StockScoringExplainer):
 *   +0.15% over 1 hour = 15 bps = 3 goals.
 *   +0.05% = 5 bps = 1 goal. +0.02% = 2 bps = 0 goals.
 *   +0.03% = 3 bps = 1 goal, the first scoring move.
 *   Home -0.10% vs Away +0.05%: raw goals -2 vs +1, normalized 0-3.
 *   Home +0.12% vs Away -0.04%: raw goals +2 vs -1, normalized 3-0.
 *   Home +0.15% vs Away +0.15%: raw goals 3 vs 3, normalized 3-3, draw.
 *   +3.00% raw = 300 bps = 60 goals uncapped, capped to 10 goals, and
 *   flagged volatile for circuit breaker review.
 *   Forfeit: missing side scores 0, opponent scores 3, result 0-3.
 *
 * Rounds: 22 rounds, Nov 26 to Dec 16 2026. Nov 26 to Dec 16 inclusive
 * is 21 days, so 22 rounds need one double-header day. Round 21
 * (matchdayIndex 20) and round 22 (matchdayIndex 21) both fall on
 * Dec 16, morning and evening waves. stockMatchdayDate clamps the day
 * offset at 20, so round 22 maps to Dec 16, never Dec 17.
 */

export const STOCK_GOAL_PCT = 0.05;
export const STOCK_GOAL_BPS = 5;
// Solidity's integer half-up offset truncates 5 / 2 to 2 bps.
export const STOCK_HALF_UP_BPS = 2;
export const STOCK_MAX_GOALS = 10;
/** Raw move above this is capped and flagged for circuit breaker review. */
export const STOCK_VOLATILE_CAP_PCT = 3;
export const STOCK_POINTS_WIN = 3;
export const STOCK_POINTS_DRAW = 1;
export const STOCK_POINTS_LOSS = 0;

/** Season shape, locked Nov 18 2026: 12 teams, double round-robin. */
export const STOCK_TEAM_COUNT = 12;
export const STOCK_TOTAL_ROUNDS = 22;
export const STOCK_FIXTURES_PER_ROUND = 6;
export const STOCK_TOTAL_FIXTURES = 132;
export const STOCK_SEASON_FIRST_DAY = "2026-11-26";
export const STOCK_SEASON_LAST_DAY = "2026-12-16";
/** Dec 16 hosts rounds 21 and 22 in two waves, morning and evening. */
export const STOCK_DOUBLE_HEADER_DATE = "2026-12-16";

/** +0.15% / -0.10%, always with 2 decimals. */
export function formatSignedPctStock(pct: number, digits = 2): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}

/**
 * Round a raw % change to goals exactly like the stock oracle:
 * 1 goal = 0.05% (5 bps). The oracle first truncates the move to
 * integer basis points, then applies the integer half-up offset of
 * 2 bps, so 3 bps is the first scoring move. Returns a signed goal
 * count, negative when the price fell. The caller must clamp and
 * normalize (see stockScoreline below).
 */
export function roundPctLikeOracleStock(pct: number): number {
  // PriceOracle first truncates the move to integer basis points.
  const bps = Math.trunc(Math.abs(pct) * 100);
  const goals = Math.floor((bps + STOCK_HALF_UP_BPS) / STOCK_GOAL_BPS);
  return pct < 0 ? -goals : goals;
}

/** True when the raw % move exceeds the 3% volatile cap. */
export function isVolatileStock(pct: number): boolean {
  return Math.abs(pct) > STOCK_VOLATILE_CAP_PCT;
}

/**
 * Mirror of the oracle scoreline normalization: no negative scorelines.
 * Each side's negative goals become plus-goals for the opponent
 * (for example 0:-1 becomes 1:0). Margin-preserving, so winners are
 * unaffected. The 10-goal cap is applied after normalization, because
 * normalization can add goals (for example +10 vs -10 becomes 20-0
 * before the cap, and must end 10-0, not 20-0).
 */
export function normalizeScorelineStock(homeGoals: number, awayGoals: number): [number, number] {
  const home = Math.max(0, homeGoals) + Math.max(0, -awayGoals);
  const away = Math.max(0, awayGoals) + Math.max(0, -homeGoals);
  return [Math.min(STOCK_MAX_GOALS, home), Math.min(STOCK_MAX_GOALS, away)];
}

/**
 * Full stock scoreline from two raw % moves: round each side at
 * 0.05% per goal, clamp each raw side to 10, normalize, clamp again.
 * Returns [homeGoals, awayGoals] and whether either side was volatile.
 */
export function stockScoreline(
  homePct: number,
  awayPct: number
): { homeGoals: number; awayGoals: number; volatile: boolean } {
  const clamp = (g: number) => Math.max(-STOCK_MAX_GOALS, Math.min(STOCK_MAX_GOALS, g));
  const [homeGoals, awayGoals] = normalizeScorelineStock(
    clamp(roundPctLikeOracleStock(homePct)),
    clamp(roundPctLikeOracleStock(awayPct))
  );
  return {
    homeGoals,
    awayGoals,
    volatile: isVolatileStock(homePct) || isVolatileStock(awayPct),
  };
}

/** Forfeit scoreline: the missing side scores 0, the opponent scores 3. */
export function forfeitScoreline(forfeitingSide: "home" | "away"): [number, number] {
  return forfeitingSide === "home" ? [0, 3] : [3, 0];
}

/** "3-0", "0-3 (FORFEIT)", "void" for display on cards and tables. */
export function formatStockScoreline(
  homeGoals: number | null,
  awayGoals: number | null,
  opts?: { forfeit?: boolean; voided?: boolean }
): string {
  if (opts?.voided) return "void";
  if (homeGoals === null || awayGoals === null) return "–";
  const base = `${homeGoals}-${awayGoals}`;
  return opts?.forfeit ? `${base} (FORFEIT)` : base;
}

/** Outcome label from a scoreline: 0 home win, 1 draw, 2 away win. */
export function stockOutcome(homeGoals: number, awayGoals: number): 0 | 1 | 2 {
  if (homeGoals > awayGoals) return 0;
  if (homeGoals < awayGoals) return 2;
  return 1;
}

/** UTC date label, for example "Thu, Nov 26, 2026 (UTC)". No local zone. */
export function formatUtcDate(iso: string | null): string {
  if (!iso) return "TBA";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBA";
  return d.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** UTC time label, for example "14:00 UTC". No local zone. */
export function formatUtcTime(iso: string | null): string {
  if (!iso) return "TBA";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBA";
  return (
    d.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false }) +
    " UTC"
  );
}

/** UTC date and time, for example "Thu, Nov 26, 2026, 14:00 UTC". */
export function formatUtcDateTime(iso: string | null): string {
  if (!iso) return "TBA";
  return `${formatUtcDate(iso)}, ${formatUtcTime(iso)}`;
}

/**
 * UTC calendar day key, "2026-11-26". Used to group All-league fixtures
 * by the UTC day they kick off, so crypto and stock fixtures on the same
 * day sit together regardless of the viewer's timezone.
 */
export function utcDayKey(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Round n (0-based matchdayIndex) starts Nov 26 2026 UTC, one round per
 * day, except the double-header: round 21 (index 20) and round 22
 * (index 21) both fall on Dec 16. The day offset is clamped at 20, so
 * index 21 maps to Dec 16, never Dec 17. The fixtures pager and the
 * All-league day grouping both rely on this clamp.
 */
export function stockMatchdayDate(matchdayIndex: number): string {
  const dayOffset = Math.max(0, Math.min(matchdayIndex, STOCK_TOTAL_ROUNDS - 2));
  const start = Date.UTC(2026, 10, 26) + dayOffset * 24 * 60 * 60 * 1000;
  return new Date(start).toISOString().slice(0, 10);
}

/**
 * Double-header wave for a round, null for ordinary rounds. Round 21
 * (index 20) is the Dec 16 morning wave, round 22 (index 21) is the
 * Dec 16 evening wave.
 */
export function stockRoundWave(matchdayIndex: number): "morning" | "evening" | null {
  if (matchdayIndex === STOCK_TOTAL_ROUNDS - 2) return "morning";
  if (matchdayIndex === STOCK_TOTAL_ROUNDS - 1) return "evening";
  return null;
}

/** "Round 21, Dec 16 UTC, double-header, morning wave", used as the pager button title. */
export function stockRoundLabel(matchdayIndex: number): string {
  const round = matchdayIndex + 1;
  const date = stockMatchdayDate(matchdayIndex);
  const wave = stockRoundWave(matchdayIndex);
  if (wave) return `Round ${round}, ${date} UTC, double-header finale, ${wave} wave`;
  return `Round ${round}, ${date} UTC`;
}
