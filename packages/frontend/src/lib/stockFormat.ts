/**
 * Stock League scoring and formatting helpers.
 *
 * Target location in the repo:
 *   packages/frontend/src/lib/stockFormat.ts
 *
 * Scoring, document everywhere it is used:
 *   Banded goal scale (revised 2026-11-27): the absolute price move
 *   over the 1-hour window lands in a band, and the band is the goal
 *   count. Under 0.10% scores 0; 0.10% / 0.25% / 0.75% / 1.50% /
 *   3.00% / 6.00% score 1 / 2 / 3 / 4 / 5 / 6 goals; each full extra
 *   3.00% beyond 6.00% adds one more goal, with NO cap. No-negative
 *   scorelines exactly like crypto, raw volatile cap 3% with circuit
 *   breaker review, 3 pts win / 1 draw / 0 loss, tiebreak points, GD,
 *   GF, wins, fewest losses.
 *   Forfeit: no performance for that period means 0-3, opponent wins
 *   3-0, marked FORFEIT. Both sides missing means void, stakes refunded.
 *
 * Crypto comparison, for reviewers: crypto converts linearly at
 * 1 goal = 0.5% (50 bps). The stock scale was linear too until
 * 2026-11-27 (1 goal = 0.05% with a 10-goal cap), but Matchday 2
 * showed the flaw: routine in-session moves saturated the cap and a
 * +1.68% vs +0.50% match was recorded as a 10-10 draw. The banded
 * scale keeps normal matches in football range while still
 * respecting extreme moves, because the tail never caps. Do not copy
 * the crypto constants here, and do not restore the linear
 * conversion: the on-chain oracle converts with these exact bands,
 * in integer basis points.
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
 *   +0.50% over 1 hour = 50 bps = 2 goals (one full NAV print).
 *   +0.10% = 10 bps = 1 goal, the first scoring move. +0.09% = 0.
 *   +0.15% = 15 bps = 1 goal.
 *   Home -0.57% vs Away 0.00%: raw goals -2 vs 0, normalized 0-2.
 *   Home +1.68% vs Away +0.50%: raw goals 4 vs 2, final score 4-2.
 *   Home +0.30% vs Away +0.30%: raw goals 2 vs 2, normalized 2-2, draw.
 *   +5.63% raw = 563 bps = 5 goals, and flagged volatile (over 3%).
 *   +12.00% raw = 8 goals: the tail adds 1 per full extra 3.00%.
 *   Forfeit: missing side scores 0, opponent scores 3, result 0-3.
 *
 * Rounds: 22 rounds, Nov 26 to Dec 16 2026. Nov 26 to Dec 16 inclusive
 * is 21 days, so 22 rounds need one double-header day. Round 21
 * (matchdayIndex 20) and round 22 (matchdayIndex 21) both fall on
 * Dec 16, morning and evening waves. stockMatchdayDate clamps the day
 * offset at 20, so round 22 maps to Dec 16, never Dec 17.
 */

/** Band edges in bps over the absolute move: reaching an edge scores
 * that band's goals (10 bps = 1 goal, 25 = 2, 75 = 3, 150 = 4,
 * 300 = 5, 600 = 6). Mirrors StockConstants on-chain exactly. */
export const STOCK_GOAL_BAND_EDGES_BPS = [10, 25, 75, 150, 300, 600] as const;
/** Beyond the last band edge there is no cap: each full extra step of
 * this size adds one more goal (900 bps = 7, 1200 bps = 8). */
export const STOCK_GOAL_TAIL_STEP_BPS = 300;
/** Raw move above this is flagged for circuit breaker review. */
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

/** Goals for an absolute move in integer basis points, on the banded
 * scale. Shared by the scoreline mirror below and any display that
 * needs the raw conversion. */
export function stockGoalsForBps(absBps: number): number {
  const edges = STOCK_GOAL_BAND_EDGES_BPS;
  for (let i = 0; i < edges.length; i++) {
    if (absBps < edges[i]) return i;
  }
  const last = edges[edges.length - 1];
  return edges.length + Math.floor((absBps - last) / STOCK_GOAL_TAIL_STEP_BPS);
}

/**
 * Convert a raw % change to goals exactly like the stock oracle: the
 * oracle first truncates the move to integer basis points, then the
 * absolute value's band decides the goals. Returns a signed goal
 * count, negative when the price fell. The caller must normalize (see
 * stockScoreline below). There is no cap at any step.
 */
export function roundPctLikeOracleStock(pct: number): number {
  // The oracle first truncates the move to integer basis points.
  const bps = Math.trunc(Math.abs(pct) * 100);
  const goals = stockGoalsForBps(bps);
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
 * unaffected. No cap is applied: normalization can add goals (for
 * example +4 vs -4 becomes 8-0), and the final score keeps them all.
 */
export function normalizeScorelineStock(homeGoals: number, awayGoals: number): [number, number] {
  const home = Math.max(0, homeGoals) + Math.max(0, -awayGoals);
  const away = Math.max(0, awayGoals) + Math.max(0, -homeGoals);
  return [home, away];
}

/**
 * Full stock scoreline from two raw % moves: convert each side on the
 * banded scale, then normalize. No cap at any step.
 * Returns [homeGoals, awayGoals] and whether either side was volatile.
 */
export function stockScoreline(
  homePct: number,
  awayPct: number
): { homeGoals: number; awayGoals: number; volatile: boolean } {
  const [homeGoals, awayGoals] = normalizeScorelineStock(
    roundPctLikeOracleStock(homePct),
    roundPctLikeOracleStock(awayPct)
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
