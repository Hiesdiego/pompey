/**
 * StockScoringExplainer, the scoring explainer shown on stock pages.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/StockScoringExplainer.tsx
 *
 * Copy rules for this component: no em dash anywhere, use commas,
 * periods, or colons. All times are UTC. The explainer states the full
 * scoring set: the banded goal scale (revised 2026-11-27, no goal
 * cap), 1-hour window, NAV feed, 3% volatile flag, 3-0 forfeit rule,
 * with worked examples.
 *
 * Price rule, user approved Nov 18 2026: when the feed is healthy but
 * quiet, the last NAV within the 24h heartbeat counts as the end price.
 * NAV only publishes on a 0.5% move or a 24h heartbeat, so a quiet
 * 1-hour match may have no fresh NAV. That rule does NOT fix teams with
 * no NAV at all, which is why the roster shrank from 22 teams to 12.
 * Say both parts in plain language, here and on the match page audit
 * card, so users never read the last-NAV rule as a fix for missing NAV.
 *
 * Worked examples, verified against stockFormat.ts:
 *   +0.50% = 2 goals (the 25 to 74 bps band; one full NAV print).
 *   +0.10% = 1 goal, the first scoring move. +0.09% = 0 goals.
 *   Home -0.57% vs Away 0.00%: raw goals -2 vs 0, normalized 0-2.
 *   Home +1.68% vs Away +0.50%: raw goals 4 vs 2, final score 4-2.
 *   Home +0.30% vs Away +0.30%: 2-2, a draw.
 *   +5.63% raw = 5 goals, flagged volatile (over 3%).
 *   +12.00% raw = 8 goals: the tail never caps.
 */

"use client";

export const STOCK_SCORING_COPY = {
  headline: "How stock matches are scored",
  goalRule: "Goals come from a band table, not a fixed rate. A move under 0.10% scores 0; 0.10% scores 1 goal, 0.25% scores 2, 0.75% scores 3, 1.50% scores 4, 3.00% scores 5, and 6.00% scores 6.",
  window: "1-hour window, staggered randomly like crypto, one round lasts 1 day.",
  feed: "Prices come from Chainlink NAV for the tokenized stock. NAV only publishes on a 0.5% move or a 24h heartbeat, so a quiet 1-hour match may have no fresh NAV.",
  lastNav:
    "When the feed is healthy but quiet, the last NAV within the 24h heartbeat counts as the end price. That rule does not fix a team with no NAV at all, which is why Season 1 has 12 teams, not 22.",
  cap: "There is no goal cap. Past 6.00%, each full extra 3.00% adds one more goal, so 9.00% scores 7 and 12.00% scores 8. A raw move above 3% is flagged for circuit breaker review.",
  forfeit:
    "Forfeit: if a stock has no performance for that period, the opponent wins 3-0 automatically, marked FORFEIT. If neither side has performance, the match is void and stakes are refunded.",
  points: "3 points for a win, 1 for a draw, 0 for a loss. Tiebreak: points, then goal difference, then goals scored, then wins, then fewest losses.",
} as const;

const EXAMPLES: { title: string; body: string }[] = [
  {
    title: "+0.50% in 1 hour",
    body: "50 bps lands in the 2-goal band. One full NAV print is worth 2 goals.",
  },
  {
    title: "+0.10% in 1 hour",
    body: "10 bps is the first move that scores, 1 goal. A stock up 0.09% scores 0.",
  },
  {
    title: "Home -0.57% vs Away 0.00%",
    body: "Raw goals are -2 vs 0. Negative goals become goals for the opponent, so the final score is 0-2 to the away side.",
  },
  {
    title: "Home +1.68% vs Away +0.50%",
    body: "Raw goals are 4 vs 2, so the home side wins 4-2. A clear performance gap reads as a clear win.",
  },
  {
    title: "Home +0.30% vs Away +0.30%",
    body: "Both sides score 2, so the match is a 2-2 draw, 1 point each.",
  },
  {
    title: "+5.63% raw move",
    body: "563 bps lands in the 5-goal band (3.00% to 5.99%) and is flagged volatile for circuit breaker review.",
  },
  {
    title: "+12.00% raw move",
    body: "8 goals. Past 6.00% the scale keeps climbing at 1 goal per full extra 3.00%, with no cap.",
  },
];

export function StockScoringExplainer({ compact = false }: { compact?: boolean }) {
  return (
    <section
      aria-label="How stock matches are scored"
      className="glass rounded-2xl p-5"
    >
      <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-zinc-900 dark:text-white">
        {STOCK_SCORING_COPY.headline}
      </h3>
      <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Goal: </span>
          {STOCK_SCORING_COPY.goalRule}
        </li>
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Window: </span>
          {STOCK_SCORING_COPY.window}
        </li>
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Feed: </span>
          {STOCK_SCORING_COPY.feed}
        </li>
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Last NAV: </span>
          {STOCK_SCORING_COPY.lastNav}
        </li>
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Big moves: </span>
          {STOCK_SCORING_COPY.cap}
        </li>
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Forfeit: </span>
          {STOCK_SCORING_COPY.forfeit}
        </li>
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Points: </span>
          {STOCK_SCORING_COPY.points}
        </li>
      </ul>
      {!compact && (
        <div className="mt-4 border-t border-black/8 pt-4 dark:border-white/8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Worked examples
          </p>
          <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
            {EXAMPLES.map((e) => (
              <li key={e.title}>
                <span className="font-display font-bold tabular-nums text-zinc-900 dark:text-white">
                  {e.title}:{" "}
                </span>
                {e.body}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Crypto scoring is different: a fixed 1 goal = 0.5% there. Stocks move less in 1 hour, so the stock scale starts finer and compresses as moves grow.
      </p>
    </section>
  );
}
