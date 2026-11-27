/**
 * ArenaScoringExplainer, the scoring explainer shown on clash pages.
 *
 * Target location in the repo:
 *   packages/frontend/src/components/ArenaScoringExplainer.tsx
 *
 * This is the Arena mirror of StockScoringExplainer in
 * ./StockScoringExplainer.tsx: same component shape, same compact
 * prop, same list layout and styling. Only the copy differs, and only
 * where the locked Arena product content differs: the clash question
 * is Yes or No on outperformance, the display scoreline uses the
 * crypto league formula (1 goal = 0.5%), staking closes at window
 * start, the snapshot sources are BaseStonk and the Coinbase NAV, and
 * the plus or minus 30 percent breaker voids the clash with refunds.
 *
 * Copy rules for this component: no em dash anywhere, use commas,
 * periods, or colons. All times are UTC.
 *
 * Worked examples, verified against clashScoreline in
 * lib/arenaContracts.ts:
 *   Meme +3% vs stock +1%: raw goals 6 and 2, score 6-2, Yes wins.
 *   Meme -1% vs opponent +2%: raw goals -2 and +4, normalized 0-6.
 *   Meme +0.4% vs opponent +0.4%: level goals, and the raw moves are
 *   exactly tied, so No wins.
 *   Either side at +30% or beyond: the clash voids, stakes refund.
 */

"use client";

export const ARENA_SCORING_COPY = {
  headline: "How meme clashes are scored",
  goalRule:
    "1 goal = 0.5% price move, half-up, with no negative scores, exactly like the crypto league. The scoreline displays the moves. The winner is decided by the raw percent moves, not by the rounded goals.",
  window:
    "Standard window 24 hours, blitz window 1 hour. The window starts 1 hour after creation. Staking opens at creation and closes at window start, there is no in-play staking.",
  feed: "Meme prices come from BaseStonk priceUsd. A stock opponent is priced from the Coinbase NAV source. A meme opponent is priced from BaseStonk priceUsd.",
  breaker:
    "Breaker: a raw move of 30% or more on either side inside the window voids the clash, the scoreline is ignored and stakes are refunded 1:1 through claim. A missing snapshot price also voids the clash.",
  result:
    "Result: Yes wins only when the meme percent move is strictly greater than the opponent percent move. An exact tie is No.",
  fees: "Fees apply to staked volume only: 3% treasury, 2% creator, 1% resolver. The 250 TICK creation seed is never charged a fee and joins the winners pool at settlement.",
} as const;

const EXAMPLES: { title: string; body: string }[] = [
  {
    title: "Meme +3% vs stock +1%",
    body: "Raw goals are 6 and 2, so the score reads 6-2. The meme move is strictly greater, so Yes wins.",
  },
  {
    title: "Meme -1% vs opponent +2%",
    body: "Raw goals are -2 and +4. Negative goals become goals for the opponent, so the final score is 0-6 and No wins.",
  },
  {
    title: "Meme +0.4% vs opponent +0.4%",
    body: "The goals are level and the raw moves are exactly tied. An exact tie is No, so No wins.",
  },
  {
    title: "Either side moves 30% or more",
    body: "The breaker voids the clash before the result is read. The scoreline is ignored and every stake refunds 1:1.",
  },
];

export function ArenaScoringExplainer({ compact = false }: { compact?: boolean }) {
  return (
    <section
      aria-label="How meme clashes are scored"
      className="glass rounded-2xl p-5"
    >
      <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-zinc-900 dark:text-white">
        {ARENA_SCORING_COPY.headline}
      </h3>
      <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Goal: </span>
          {ARENA_SCORING_COPY.goalRule}
        </li>
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Window: </span>
          {ARENA_SCORING_COPY.window}
        </li>
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Feed: </span>
          {ARENA_SCORING_COPY.feed}
        </li>
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Breaker: </span>
          {ARENA_SCORING_COPY.breaker}
        </li>
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Result: </span>
          {ARENA_SCORING_COPY.result}
        </li>
        <li>
          <span className="font-semibold text-zinc-900 dark:text-white">Fees: </span>
          {ARENA_SCORING_COPY.fees}
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
        Stock scoring is different: a banded goal scale there, not a fixed rate. Meme clashes use the crypto league scale, 1 goal = 0.5%.
      </p>
    </section>
  );
}
