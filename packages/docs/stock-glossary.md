# TICKR Stock League: Glossary

Status: locked, Nov 16 2026. Season 1 runs Nov 26 to Dec 16 2026.

## B20

Coinbase's set of tokenized stocks on Base. B20 tokens carry the ticker plus a
`c` suffix (NVDAc, AAPLc), use 8 decimals, and have contract addresses starting
`0xb200...`. Season 1 of the stock league is Coinbase B20 only. B20 tokens are
native precompiles on Base, not separately deployed contracts, so there is no
per-token bytecode on Basescan. That does not block the league: TICKR only
reads prices and stakes TICK, it never holds the stock tokens.

## Basis point (bp)

One hundredth of a percent. 1 bp is 0.01%, 5 bps is 0.05%, 50 bps is 0.5%,
100 bps is 1%. The stock league scores 1 goal per 5 bps of price movement
(`BPS_PER_GOAL = 5`). The crypto league scores 1 goal per 50 bps.

## Checkpoint

A scheduled price read during a match window. The backend polls the NAV feed
at checkpoints so the live score, the momentum display, and the full-time
snapshot all have fresh prices. Checkpoints are reads only. They do not settle
anything. Only the kickoff and full-time snapshots decide the result.

## Circuit breaker

A safety pause on settlement. If either team's raw price moves plus or minus
30% inside the match window, settlement pauses for review. Scorelines alone
never trigger it. The same breaker applies in the crypto league and the cup.
In the stock league, any single-team raw move above 3% is also flagged for
circuit breaker review, under the volatile cap rule.

## Dinari

The other issuer of tokenized stocks on Base, alongside Coinbase. Dinari
issues dShares with plain ticker symbols (NVDA, AAPL) and 18 decimals. Its API
is enterprise and key-gated, not a free public price feed, so it is not a
drop-in fallback for the stock league. It is used only if the user supplies a
`DINARI_API_KEY_ID`. Dinari-only tickers (SPY, QQQ, BABA, TSM, ASML, COST,
COIN and the rest) sit out Season 1.

## Forfeit

A 3-0 loss awarded when a team has no performance for the match period,
meaning no usable price at kickoff or at full time, or no NAV update inside
the window. The opponent wins 3-0 and the result is marked FORFEIT wherever it
appears. A stock that falls hard still played the match. Only a missing price,
not a bad price, causes a forfeit.

## Goal cap

Max 10 goals per team per match in the stock league, applied to the final
scoreline after the no-negative conversion. It stops one extreme hour from
wrecking the goal difference column for the whole season.

## Half-up rounding

The rounding rule for converting a price move into goals. A move is divided by
the goal threshold (0.05%) and rounded to the nearest whole goal, with exact
halves rounding up for positive moves and away from zero for negative moves.
On chain this is integer math with a half-goal value of 2 bps
(`BPS_PER_GOAL / 2`). In practice: 0.03% scores the first goal, 0.08% the
second, 0.13% the third. The exact half point, 0.025%, scores 0 goals under
the integer math.

## Matchday

One day of the season. The stock league has 21 matchdays, 11 fixtures each,
231 fixtures in total. A matchday lasts 1 day and all of its matches end the
same day. Kickoffs are staggered randomly across the matchday.

## NAV (Net Asset Value)

The reference value of a tokenized stock, based on the underlying share price.
The Base Tokenized Stocks API returns `nav_price` (the most recent
Chainlink-based NAV), `nav_price_updated_at`, and the current `multiplier` per
token. The on-chain oracle registry at
`0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD` returns the multiplier and a pause
flag per token in one call. NAV is the stock league's primary price feed.
NAV feeds update on deviation or heartbeat and can go stale, which is why
every snapshot checks staleness before trusting a price.

## No-negative scoreline

The formula that turns raw signed goals into a football scoreline:
`G_home = max(0, r_h) + max(0, -r_a)` and
`G_away = max(0, r_a) + max(0, -r_h)`. A team's fall counts as goals for its
opponent. The formula is margin-preserving: the goal difference and the winner
are the same as with raw signed goals, but no scoreline ever goes below zero.
Identical in the crypto league and the stock league.

## Outright pool

The season-long pool on who wins the league. Back the team you think will be
champion. The outright pool stays open until the season's final matchday kicks
off. Winners share the pool minus the 7% fee, in proportion to stake. If nobody
backed the champion, the whole pool goes to the Tickr treasury.

## Parimutuel

The pool payout model used across TICKR. All stakes on a match go into one
pool. Winners share the total pool minus the 7% fee, split in proportion to
what each winner staked. There is no bookmaker setting odds. The payout
depends on how the pool is split: fewer winners on your outcome means a bigger
share each.

## Snapshot

A price read pinned to a match moment: the kickoff snapshot at the start of
the 1-hour window and the full-time snapshot at the end. Only movement between
the two snapshots counts toward the score. A snapshot is blocked if the NAV is
stale at that moment, exactly like the crypto league blocks on a stale price.
TICKR never settles on a guessed price.

## Staking window

The period during which stakes are accepted on a match: from when the fixture
is listed until kickoff. No stakes after kickoff. The outright pool's staking
window runs until the season's final matchday kicks off.

## TICK

The ERC-20 staking token used across all of TICKR, at
`0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b`. TICK is the only staking currency
in the stock league, the same token as the crypto league. Your TICK balance is
shared between both leagues. TICK has no price feed and is never priced
against any other token.

## TP (TickrPoints)

The points that track how well you play across all of TICKR. There is one
unified TP leaderboard. Stock league results count toward the same TP total as
crypto league results. There is no separate stock leaderboard, because the
crypto PlayerStats contract has a one-time setter for its prediction pool and
it is already set to the crypto pool, so the stock pool cannot write to it.
The backend aggregates crypto and stock results off chain into the single
unified TP total.

## Treasury rule

The rule that governs every TICKR pool: winners share the total pool minus the
7% fee. If nobody staked on the winning outcome, the entire pool goes to the
Tickr treasury, with no refunds. The only case where stakes come back is a
void match, where stakes are refunded 1:1 in full.

## UUPS (Universal Upgradeable Proxy Standard)

The upgradeable contract pattern used by the stock league stack. Logic
contracts sit behind a proxy, and the owner can upgrade the logic through the
proxy without redeploying the whole stack or losing state. That is a change
from the crypto league and cup, where one-time setters forced a full fresh
stack redeploy for any scoring or logic change. Upgradeability is for
maintenance and fixes. It does not change the game rules mid-season.

## Void

A match with no result because both teams had no performance for the period.
No winner, no points, no goals on the table, and every stake is refunded 1:1
in full. A void is the only case where stakes come back. One team with no
performance is a forfeit, not a void.

## Volatile cap

The stock league's 3% raw move cap. At 3% a team is already at 60 raw goals,
so the 10-goal cap binds first for scoring. The 3% line matters as a review
threshold: any single-team raw move above 3% inside the match window is
flagged for circuit breaker review.
