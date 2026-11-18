# TICKR Stock League: How to Play

Status: locked, Nov 18 2026. 12-team revision, supersedes the Nov 16 2026
22-team spec. Season 1 runs Nov 26 to Dec 16 2026.
If you already play the crypto league, you already know this game. The stock
league is the same game with different teams: tokenized stocks on Base instead
of cryptocurrencies. Price performance is the score, stakes are TICK,
everything settles on chain.

## The game in one paragraph

12 tokenized stocks play a league season, 22 rounds, 132 matches. Each match
lasts 1 hour. In that hour, every 0.05% a stock's price moves is worth 1 goal.
Pick a match, back the team you think will move more, stake TICK, and if your
team wins or draws the way you backed it, you share the pool with the other
winners. If the stock is on Base, you can predict its next move.

## The teams

NVIDIA, Apple, Microsoft, Amazon, Alphabet, Meta, Tesla, Strategy, Circle,
Intel, SanDisk, and SpaceX. All 12 are Coinbase B20 tokenized stocks, trading
24/7 on Base. Their symbols carry a `c`, NVDAc, AAPLc, and so on. Intel,
SanDisk, and SpaceX are new to the roster.

The 13 teams from the earlier 22-team plan (AMD, Netflix, Broadcom, Palantir,
Oracle, Salesforce, JPMorgan, Visa, Eli Lilly, Disney, Robinhood, GameStop,
and AMC) sit out Season 1 and return for Season 2. GameStop and AMC headline
the Meme Arena later.

## Step 1: sign in and get TICK

1. Open tickrbase.top and sign in. The stock league uses the same account as
   the crypto league.
2. You need TICK to stake. TICK is the same ERC-20 staking token used across
   all of TICKR. Your TICK balance is shared between the crypto league and the
   stock league.
3. The minimum stake on a match is 10 TICK.

## Step 2: pick a match

1. Go to Fixtures. By default you see all matches for the day, crypto and
   stock together.
2. Use the switcher at the top of the page to filter: All, Crypto, or Stocks.
3. Pick a stock match that has not kicked off yet. Staking closes at kickoff.
4. Each match card shows the two teams, the kickoff time, the pool size so far,
   and the live split of stakes across the three outcomes: home win, draw, away
   win.

A matchday has 6 stock fixtures, spread across the day at randomly staggered
kickoff times, so there is almost always a match coming up. The exception is
the Dec 16 finale, which hosts rounds 21 and 22 in two waves (morning and
evening), 12 fixtures that day.

## Step 3: choose your outcome and stake TICK

A stock match has three outcomes, exactly like a crypto match:

- Home win: the home stock outperforms the away stock on goals.
- Draw: both teams finish level on goals.
- Away win: the away stock outperforms the home stock on goals.

Pick your outcome, enter your TICK amount (minimum 10 TICK), and confirm. Your
stake goes into that match's pool. Every match pool is seeded with 250 TICK by
the protocol, so every pool starts with something in it.

How much you can win depends on the pool. Winners share the total pool minus a
7% fee, split in proportion to what each winner staked. If few people backed
your outcome, your share is bigger. If many people backed it, your share is
smaller. The card shows live multipliers while staking is open, so you can see
the payout on offer before you commit.

## Step 4: watch the match live

Once the match kicks off, the score updates live as prices move. 1 goal equals
0.05% of price movement, so scores move more often than in the crypto league:
a normal hour gives 1 to 3 goals per team, and a busy hour gives more.

The live score is cumulative price movement, so goals can appear and disappear
as prices move. A team leading 2-1 at minute 30 can be pegged back to 2-2 by
full time. Nothing is final until the full-time whistle and the on-chain
settlement.

What to watch:

- The scoreline, updated as NAV prices move.
- Each team's raw percentage move, so you can see how close the next goal is.
- The pool split, which freezes at kickoff. No new stakes after kickoff.

## Step 5: settlement and claiming

At full time, the backend submits the end prices on chain and the match
settles. The scoreline is final, the winners are decided, and the pool pays out.

1. Go to the match page or your Claims page after settlement.
2. If you backed the winning outcome, claim your share. Winners share the
   total pool minus the 7% fee, in proportion to stake.
3. If nobody staked on the winning outcome, the entire pool goes to the Tickr
   treasury. That is the treasury rule, and it is the same in every TICKR pool.
   No refunds in that case.
4. If you backed a losing outcome, your stake stays in the pool and goes to the
   winners.

Claims are on chain. Your winnings are TICK, paid to your wallet when you claim.

## The outright champion pool

As well as per-match pools, there is an outright pool: back the team you think
will win the league. The outright pool stays open until the season's final
matchday kicks off. The champion is decided on points, then goal difference,
then goals scored, then wins, then fewest losses. Winners share the outright
pool minus the 7% fee, in proportion to stake. The same treasury rule applies:
if nobody backed the champion, the whole pool goes to the treasury.

## Scoring, in short

- 1 goal = 0.05% price move in the 1-hour match window.
- Half-up rounding. A move of 0.03% scores the first goal.
- A team's fall counts as goals for its opponent. No scoreline ever goes below
  zero.
- Max 10 goals per team per match.
- Points: 3 for a win, 1 for a draw, 0 for a loss.
- Table tiebreak: points, then goal difference, then goals scored, then wins,
  then fewest losses.
- Full scoring explainer, with worked examples: stock-scoring.md.

## Forfeit and void

Sometimes a price feed goes quiet. The rules for that are written down, so
there are no surprises:

- If one stock has no performance for the match period, meaning no usable price
  at kickoff or full time, that team forfeits. The opponent wins 3-0. The result
  is marked FORFEIT wherever it appears. If you backed the opponent, you win.
  If you backed the forfeiting team or the draw, you lose.
- If both stocks have no performance, the match is void. No winner, no points,
  no goals. Every stake is refunded 1:1, in full.

A stock that falls hard still played the match. Only a missing price, not a bad
price, causes a forfeit.

## Stale prices and the last-NAV rule

The stock league prices come from Chainlink NAV. NAV updates on price deviation
or heartbeat, so it can go stale. When the feed is healthy but quiet, the
backend accepts the last NAV as the end price, as long as that NAV is no older
than 24 hours plus a short grace allowance (the 24-hour heartbeat). In plain
language: a stock that barely moved, so Chainlink published no fresh NAV
during the hour, still gets a price, the most recent NAV, and the match plays
on. The backend never fabricates a price. It only reuses a real, published
NAV, and every use of a carried-over NAV is logged.

That rule does not fix a team with no NAV at all. A stock that has never
published a NAV, or whose feed is down rather than quiet, still has no price,
and the forfeit rule above applies. That is why the roster shrank from 22
teams to 12.

If the last NAV is older than 24 hours plus grace, or the feed is unhealthy,
the snapshot is blocked, exactly like the crypto league blocks on a stale
price. TICKR never settles a match on a guessed price. A blocked snapshot that
leaves a team with no performance for the period leads to the forfeit rule
above.

## TickrPoints (TP): one leaderboard for everything

Your play earns TickrPoints, TP. There is one unified TP leaderboard across all
of TICKR. Stock league results count toward the same TP total as your crypto
league results. There is no separate stock leaderboard.

Why one leaderboard: the crypto PlayerStats contract has a one-time setter for
its prediction pool, and it is already set to the crypto pool, so the stock pool
cannot write to it. Rather than build a second leaderboard, the backend
aggregates crypto and stock results off chain into a single unified TP total.
Every correct call, in either league, counts toward the same score.

## Pools, fees, and the treasury

- Per-match pools: seeded with 250 TICK, minimum stake 10 TICK.
- Fee: 7% of the total pool, taken before winners are paid.
- Winners share the remaining 93% in proportion to stake.
- If nobody backed the winning outcome, the whole pool goes to the Tickr
  treasury. No refunds.
- If a match is void, stakes are refunded 1:1 in full. That is the only case
  where stakes come back.

## Finding stock content in the app

- Fixtures: defaults to All matches for the day, with an All / Crypto / Stocks
  switcher.
- Standings: the stock table has the same switcher. Stock Standings is also in
  the header navigation.
- Match pages: every stock match page has the same switcher, so you can jump
  between the stock and crypto fixtures for the day.
- Leaderboard: one unified TP leaderboard. Stock and crypto results count
  together.

## Tips for new stock players

- Stocks move less than crypto in an hour, so small moves matter. A 0.05%
  edge is a goal. Watch the raw percentage moves, not just the scoreline, to
  see how close the next goal is.
- Earnings and news move stocks fast. A stock reporting earnings can swing
  several percent in an hour, which is a lot of goals, capped at 10 per team.
  Check the calendar before you stake.
- Strategy and Tesla are the volatile pair in the league. They move more in an
  hour than the large caps, which makes them fun and dangerous in equal
  measure.
- Draws are common in quiet hours. If both stocks barely move, 0-0 and 1-1
  results are on the table.
- Staking closes at kickoff. If you want in, stake before the hour starts.
- Your TICK and your TP carry across both leagues. Play where your edge is.

## The season

- Season 1: Nov 26 to Dec 16 2026.
- 12 teams, double round-robin, 22 rounds, 6 fixtures per round, 132 fixtures.
- 21 matchdays. The Dec 16 finale hosts rounds 21 and 22 in two waves
  (morning and evening), 12 fixtures that day.
- 1-hour matches, staggered randomly across each matchday.
- Champion decided on points, then goal difference, then goals scored, then
  wins, then fewest losses.

## Questions

See stock-faq.md for the common questions: why 0.05% and not 0.5%, why 1-hour
matches and not 24-hour matches, what NAV is, what happens when the feed goes
stale, what a forfeit is, and why there is one TP leaderboard instead of two.
