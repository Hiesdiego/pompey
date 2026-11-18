/**
 * StockScoringExplainer, the scoring explainer shown on stock pages.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/StockScoringExplainer.tsx
 *
 * Copy rules for this component: no em dash anywhere, use commas,
 * periods, or colons. All times are UTC. The explainer states the full
 * locked scoring set: 0.05% per goal, 1-hour window, NAV feed, 10-goal
 * cap, 3% volatile cap, 3-0 forfeit rule, with worked examples.
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
 *   +0.15% = 3 goals (15 bps / 5 bps per goal).
 *   +0.03% = 1 goal, the first scoring move (integer basis point math).
 *   +0.02% = 0 goals.
 *   Home -0.10% vs Away +0.05%: raw goals -2 vs +1, normalized 0-3.
 *   Home +0.12% vs Away -0.04%: raw goals +2 vs -1, normalized 3-0.
 *   Home +0.15% vs Away +0.15%: 3-3, a draw.
 *   +3.00% raw would be 60 goals uncapped, capped to 10 and flagged
 *   for circuit breaker review.
 */

"use client";

export const STOCK_SCORING_COPY = {
  headline: "How stock matches are scored",
  goalRule: "1 goal = 0.05% price move (5 bps). Integer basis point math makes 0.03% the first scoring move, 0.02% scores 0.",
  window: "1-hour window, staggered randomly like crypto, one round lasts 1 day.",
  feed: "Prices come from Chainlink NAV for the tokenized stock. NAV only publishes on a 0.5% move or a 24h heartbeat, so a quiet 1-hour match may have no fresh NAV.",
  lastNav:
    "When the feed is healthy but quiet, the last NAV within the 24h heartbeat counts as the end price. That rule does not fix a team with no NAV at all, which is why Season 1 has 12 teams, not 22.",
  cap: "Max 10 goals per team per match. A raw move above 3% is capped at 10 goals and flagged for circuit breaker review.",
  forfeit:
    "Forfeit: if a stock has no performance for that period, the opponent wins 3-0 automatically, marked FORFEIT. If neither side has performance, the match is void and stakes are refunded.",
  points: "3 points for a win, 1 for a draw, 0 for a loss. Tiebreak: points, then goal difference, then goals scored, then wins, then fewest losses.",
} as const;

const EXAMPLES: { title: string; body: string }[] = [
  {
    title: "+0.15% in 1 hour",
    body: "15 bps divided by 5 bps per goal is 3 goals. A stock up 0.15% scores 3.",
  },
  {
    title: "+0.03% in 1 hour",
    body: "3 bps is the first move that scores, 1 goal. A stock up 0.02% scores 0.",
  },
  {
    title: "Home -0.10% vs Away +0.05%",
    body: "Raw goals are -2 vs +1. Negative goals become goals for the opponent, so the final score is 0-3 to the away side.",
  },
  {
    title: "Home +0.12% vs Away -0.04%",
    body: "Raw goals are +2 vs -1. The away fall adds a goal to the home side, so the final score is 3-0 to the home side.",
  },
  {
    title: "Home +0.15% vs Away +0.15%",
    body: "Both sides score 3, so the match is a 3-3 draw, 1 point each.",
  },
  {
    title: "+3.00% raw move",
    body: "That would be 60 goals uncapped. It is capped to 10 goals and flagged for circuit breaker review.",
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
          <span className="font-semibold text-zinc-900 dark:text-white">Cap: </span>
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
        Crypto scoring is different: 1 goal = 0.5% there, 10 times coarser. Stocks move less in 1 hour, so the stock threshold is finer.
      </p>
    </section>
  );
}
