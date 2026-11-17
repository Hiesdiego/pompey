# TICKR Stock League: FAQ

Status: locked, Nov 16 2026. Season 1 runs Nov 26 to Dec 16 2026.

## Scoring

### Why is 1 goal 0.05% for stocks and not 0.5% like crypto?

Stocks move far less than crypto in an hour. A large-cap stock moves about
0.04% to 0.15% in a typical hour, while a crypto coin routinely moves 0.5% or
more. At the crypto threshold of 0.5% per goal, almost every stock match would
end 0-0. The 0.05% threshold (5 basis points, `BPS_PER_GOAL = 5`) keeps stock
matches live: a normal hour gives 1 to 3 goals per team, a big hour gives 3 to
6, and scores look like real football scores. The game is identical, only the
goal threshold changed, because the teams move about ten times less.

### How does the scoring actually work?

Each match is 1 hour. Take each team's price at kickoff and at full time, work
out the percentage move, and convert it to goals at 1 goal per 0.05%, with
half-up rounding. Then apply the no-negative formula, exactly like crypto:
`G_home = max(0, r_h) + max(0, -r_a)` and
`G_away = max(0, r_a) + max(0, -r_h)`. A team's fall counts as goals for its
opponent, so no scoreline ever goes below zero. Full explainer with worked
examples: stock-scoring.md.

### What is the smallest move that scores a goal?

0.03%. Moves from -0.02% to +0.02% score 0 goals. The first goal lands at
0.03%, the second at 0.08%, the third at 0.13%, and so on, 1 goal per
additional 0.05%. The exact half point, 0.025%, scores 0 goals under the
on-chain integer math.

### Is there a limit on goals in a match?

Yes. Max 10 goals per team per match, applied to the final scoreline after the
no-negative conversion. A team that rises 0.60% in an hour would score 12 raw
goals, but the scoreline is capped at 10. The cap stops one extreme hour from
wrecking the goal difference column for the whole season.

### What is the 3% volatile cap?

Raw volatile moves are capped at 3%. At 3% a team is already at 60 raw goals,
so the 10-goal cap binds first for scoring. The 3% line matters as a review
threshold: any single-team raw move above 3% inside the match window is flagged
for circuit breaker review. The hard circuit breaker is the same as crypto: a
raw price spike of plus or minus 30% by either team inside the match window
pauses settlement.

### How are points and the table decided?

3 points for a win, 1 for a draw, 0 for a loss. Table tiebreak, in order:
points, then goal difference, then goals scored, then wins, then fewest
losses. The same order as the crypto league.

## Match timing

### Why are stock matches 1 hour and not 24 hours?

Two reasons. First, the crypto league already proved the 1-hour format works,
and the stock league is built to look and feel exactly like the crypto league,
with the scoring difference clear to users. Keeping 1-hour matches means one
match engine shape, one staking flow, and one live experience across both
leagues. Second, the finer 0.05% threshold makes 1-hour matches live. The
earlier daily-match idea existed only because the threshold was still 0.5%.
Once the threshold was rescaled to 0.05%, the window could stay at 1 hour.

### When do matches kick off?

Kickoffs are staggered randomly across the matchday, like the crypto league.
A matchday lasts 1 day, has 11 fixtures, and all of them end the same day.
Fixtures are spread across the day rather than all starting at once.

### Do stock matches pause when the stock market is closed?

No. Tokenized stocks on Base trade 24/7, so there is no market-hours gating.
The NAV reference feed can go quiet outside traditional market hours, and that
is handled by the staleness rule, not by pausing matches. If the NAV is stale
at snapshot time, the snapshot is blocked.

## Teams and format

### Why 22 teams?

The original 20-team roster was extended by 2, GameStop and AMC, the highest
recognition retail names with real 1-hour volatility, both Coinbase B20, and a
natural derby pair. 22 teams gives a single round-robin of 21 matchdays, 11
fixtures per matchday, 231 fixtures, running Nov 26 to Dec 16 2026, ending the
same day as the crypto league season.

### Who are the 22 teams?

NVIDIA, Apple, Microsoft, Amazon, Alphabet, Meta, Tesla, AMD, Netflix,
Broadcom, Palantir, Strategy, Oracle, Salesforce, JPMorgan, Visa, Eli Lilly,
Disney, Robinhood, Circle, GameStop, and AMC. All Coinbase B20 tokenized
stocks, symbols with a `c` suffix (NVDAc, AAPLc).

### Why only Coinbase B20 stocks in Season 1?

A team needs exactly one price feed. Season 1 runs on one issuer and one feed,
Chainlink NAV via the Base Tokenized Stocks API, so every team is priced the
same way. Dinari-only stocks (SPY, QQQ, BABA, TSM, ASML, COST, COIN and the
rest) sit out Season 1. They are Season 2 material, when a second feed is
wired in.

### Is this Season 3 of the crypto league?

No. The stock league is a separate, parallel league with its own fresh contract
stack, cup-style. It is not Season 3 of the crypto league, and the crypto
league is untouched. The two leagues run side by side and share TICK and the
TP leaderboard.

## Price feed

### What is NAV?

NAV is Net Asset Value: the reference value of the tokenized stock, based on
the underlying share price. The Base Tokenized Stocks API returns `nav_price`,
the most recent Chainlink-based NAV, plus `nav_price_updated_at` and the
current `multiplier` per token. The on-chain oracle registry, a single contract
at `0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD`, returns the multiplier and a
pause flag per token in one call. TICKR reads NAV prices for kickoff and
full-time snapshots. TICKR never holds the stock tokens, it only reads their
prices and stakes TICK.

### What happens if the NAV is stale?

The snapshot is blocked, exactly like the crypto league blocks on a stale
price. NAV feeds update on deviation or heartbeat and can hold their last value
for a stretch, so every snapshot checks `nav_price_updated_at` before trusting
a price. TICKR never settles a match on a guessed price. If a blocked snapshot
leaves a team with no performance for the period, the forfeit rule applies.

### What is the fallback if NAV fails?

CoinGecko is the last resort, and only if it has a price for that token. A
snapshot pair prefers the same source for both teams. There is no other
automatic fallback.

### What is Dinari, and why is it not the fallback?

Dinari is the other issuer of tokenized stocks on Base, issuing dShares with
plain ticker symbols (NVDA, AAPL). Its API is enterprise and key-gated, not a
free public price feed, so it is not 100% worthy as a drop-in fallback. It is
used only if the user supplies a `DINARI_API_KEY_ID`. It is never used
automatically. Dinari-only tickers are not in the Season 1 roster at all.

### Can I buy the actual stocks on TICKR?

No. TICKR is a prediction league, not a brokerage. You stake TICK on which
stock will outperform, you never hold the stock tokens.

## Forfeit and void

### What is a forfeit?

If a stock has no performance for the match period, meaning no usable price at
kickoff or at full time, or no NAV update inside the window, that team
forfeits. The opponent wins 3-0 automatically, and the result is marked
FORFEIT wherever it appears. If you backed the opponent, you win. If you backed
the forfeiting team or the draw, you lose.

### What is the difference between a forfeit and a void?

A forfeit is one team with no performance: the other team wins 3-0. A void is
both teams with no performance: no winner, no points, no goals, and every stake
is refunded 1:1 in full. A void is the only case where stakes come back.

### Does a stock crashing count as a forfeit?

No. A stock that falls hard still played the match and loses on goals. Only a
missing price, not a bad price, causes a forfeit.

## Staking, pools, and payouts

### What do I stake?

TICK, the same ERC-20 staking token used across all of TICKR. Your TICK balance
is shared between the crypto league and the stock league. Minimum stake is 10
TICK per match.

### What are the fees?

7% of the total pool, taken before winners are paid. Winners share the
remaining 93% in proportion to what they staked. Every match pool is seeded
with 250 TICK by the protocol.

### What happens if nobody backed the winner?

The entire pool goes to the Tickr treasury. That is the treasury rule, and it
is the same in every TICKR pool. No refunds in that case.

### When can I stake, and when does staking close?

Staking opens when the fixture is listed and closes at kickoff. No stakes after
kickoff. The outright champion pool stays open until the season's final
matchday kicks off.

### How do I claim winnings?

After a match settles on chain, claim from the match page or your Claims page.
Winnings are TICK, paid to your wallet when you claim.

## TickrPoints and the leaderboard

### Why is there no separate stock leaderboard?

Because the crypto PlayerStats contract cannot take the stock pool. Its
`setPredictionPool` is a one-time setter and it is already set to the crypto
pool, so the stock pool cannot write to it. Rather than build a second
leaderboard, the backend aggregates crypto and stock results off chain into
one unified TP total. Every correct call, in either league, counts toward the
same score.

### Do stock results count toward my TP?

Yes. Stock league play counts toward the same unified TP total as crypto league
play. There is one TP leaderboard for all of TICKR.

## Contracts

### Are the stock league contracts new?

Yes. A separate, fresh stack, built cup-style and parallel to the crypto
league. The crypto contracts are untouched. TICK is reused: same token,
`0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b`.

### What does upgradeable mean here?

The stock stack uses the UUPS upgradeable pattern, so the logic contracts can
be upgraded by the owner through the proxy without redeploying the whole stack
or losing state. That is a change from the crypto league and cup, where
one-time setters forced a full fresh stack redeploy for any scoring or logic
change. Upgradeability is for maintenance and fixes. It does not change the
game rules mid-season: scoring changes still need a proper decision and
announcement, they just no longer need a full redeploy ceremony.

### Why a separate stack instead of adding stocks to the crypto league?

The crypto league's one-time setters make that impossible without breaking the
live season. A new PriceOracle forces a new ResultEngine, which forces a new
PredictionPool and a new PlayerStats, and the MatchRegistry holding the
380-fixture crypto schedule can never pair with a new engine. A parallel stack
is the only clean path, and it is the same approach the cup already proved.

## App and bandwidth

### Where do I find the stock league in the app?

Fixtures default to All matches for the day, with an All / Crypto / Stocks
switcher. Standings and match pages have the same switcher. Stock Standings is
also in the header navigation. The stock league looks exactly like the crypto
league, with the scoring difference shown clearly.

### Will the stock league use more data or battery?

No more than the crypto league does. The backend runs on a hard cap of 1GB of
bandwidth per month, and the stock loop follows the same pattern as crypto:
live polling with a hot/idle pattern, no backend WebSocket price feed. The
stock addition was designed inside that cap, not on top of it.

### Do stocks trade 24/7 on Base?

Yes. Tokenized stocks on Base trade around the clock. That is why there is no
market-hours gating on stock matches. The NAV reference feed can still go
stale outside traditional market hours, and the staleness rule covers that.

## Season

### When does Season 1 run?

Nov 26 to Dec 16 2026. 22 teams, 21 matchdays, 231 fixtures, 11 per matchday.
1-hour matches, staggered randomly across each matchday.

### What happens after Season 1?

Season 2 is undecided. Dinari-only stocks (SPY, QQQ, BABA, TSM, ASML, COST,
COIN) are the natural Season 2 material, once a second feed is wired in. Any
Season 2 decision will be announced before it is built.
