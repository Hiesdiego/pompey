# TICKR Stock League: Scoring Explained

Status: locked, Nov 16 2026. Season 1 runs Nov 26 to Dec 16 2026.
Applies to: the TICKR Stock League only. Crypto league scoring is unchanged.

## The one line version

A stock league match lasts 1 hour. Each team scores 1 goal for every 0.05% its
tokenized stock price moves in that hour. The team with more goals wins the match.

## The season at a glance

- 22 teams, single round-robin. Every team plays every other team once.
- 21 matchdays, 11 fixtures per matchday, 231 fixtures in total.
- Season dates: Nov 26 to Dec 16 2026.
- Matches last 1 hour, staggered randomly across the matchday, exactly like the
  crypto league. A matchday lasts 1 day and all of its matches end the same day.
- Points: 3 for a win, 1 for a draw, 0 for a loss.
- League table tiebreak, in order: points, then goal difference, then goals
  scored, then wins, then fewest losses.

## The roster

Team IDs 0 to 21, in this order:

| Team ID | Team | Token |
| --- | --- | --- |
| 0 | NVIDIA | NVDAc |
| 1 | Apple | AAPLc |
| 2 | Microsoft | MSFTc |
| 3 | Amazon | AMZNc |
| 4 | Alphabet | GOOGLc |
| 5 | Meta | METAc |
| 6 | Tesla | TSLAc |
| 7 | AMD | AMDc |
| 8 | Netflix | NFLXc |
| 9 | Broadcom | AVGOc |
| 10 | Palantir | PLTRc |
| 11 | Strategy | MSTRc |
| 12 | Oracle | ORCLc |
| 13 | Salesforce | CRMc |
| 14 | JPMorgan | JPMc |
| 15 | Visa | Vc |
| 16 | Eli Lilly | LLYc |
| 17 | Disney | DISc |
| 18 | Robinhood | HOODc |
| 19 | Circle | CRCLc |
| 20 | GameStop | GMEc |
| 21 | AMC | AMCc |

All 22 are Coinbase B20 tokenized stocks on Base. The symbol is the ticker plus
`c`. Season 1 is Coinbase B20 only. Dinari-only stocks (SPY, QQQ, BABA, TSM,
ASML, COST, COIN and the rest) sit out Season 1.

## The goal rule: 1 goal = 0.05%

The scoring constant is `BPS_PER_GOAL = 5`. One basis point is 0.01%, so 5 basis
points is 0.05%. Every 0.05% of price movement in the 1-hour match window is
worth 1 goal.

Why 0.05% and not the crypto league's 0.5%? Stocks move far less than crypto in
an hour. A large-cap stock moves about 0.04% to 0.15% in a typical hour. At the
crypto threshold of 0.5% per goal, almost every stock match would end 0-0. The
0.05% threshold keeps stock matches live: a normal hour gives each team 1 to 3
goals of movement, a big hour gives 3 to 6, and scores look like real football
scores, 1-0, 2-1, 1-1, 3-2.

## Step 1: the raw move

For each team, take the price at kickoff and the price at full time, both from
the Chainlink NAV feed (see "The price feed" below), and compute the percentage
move in basis points:

```
move_bps = (end_price - start_price) * 10,000 / start_price
```

Then convert the move into raw goals with half-up rounding:

```
raw_goals = round_half_up(move_bps / 5)
```

On chain this is integer math, identical in form to the crypto league's
`CupEngine._roundedPercentChange`, with `BPS_PER_GOAL = 5` instead of 50 and a
half-goal value of 2 basis points (`5 / 2`, integer division). The price move
is first truncated to integer basis points; 3 bps is the first move that
scores a goal. A 2.5 bps move truncates to 2 bps and scores zero.

In practice that gives these bands:

| Price move in the hour | Raw goals |
| --- | --- |
| -0.02% to +0.02% | 0 |
| +0.03% to +0.07% | +1 |
| +0.08% to +0.12% | +2 |
| +0.13% to +0.17% | +3 |
| +0.18% to +0.22% | +4 |
| +0.23% to +0.27% | +5 |
| -0.03% to -0.07% | -1 |
| -0.08% to -0.12% | -2 |
| -0.13% to -0.17% | -3 |

And so on, 1 goal per additional 0.05%. A move of exactly 0.025% sits on the
half-goal boundary and scores 0 goals under the on-chain integer math. A move
needs to reach 0.03% to score its first goal.

## Step 2: no-negative scorelines

A football scoreline never shows negative goals. The raw goals are converted
with the exact same no-negative formula as the crypto league:

```
G_home = max(0, r_h) + max(0, -r_a)
G_away = max(0, r_a) + max(0, -r_h)
```

Where `r_h` and `r_a` are the home and away raw goals. A team's fall counts as
goals for its opponent. This is margin-preserving: the goal difference and the
winner are the same as they would be with raw signed goals, but no scoreline
ever goes below zero.

## Worked examples

### Example 1: a winner and a loser

NVDA (home) rises 0.12% in the hour. AAPL (away) falls 0.04%.

- NVDA raw: 12 bps, (12 + 2) / 5 = 2 goals.
- AAPL raw: -4 bps, (-4 - 2) / 5 = -1 goal.
- G_home = max(0, 2) + max(0, 1) = 3.
- G_away = max(0, -1) + max(0, -2) = 0.
- Final score: NVDA 3, AAPL 0. NVDA wins, 3 points.

### Example 2: both teams rise, the bigger mover wins

MSFT (home) rises 0.06%. TSLA (away) rises 0.09%.

- MSFT raw: 6 bps, (6 + 2) / 5 = 1 goal.
- TSLA raw: 9 bps, (9 + 2) / 5 = 2 goals.
- G_home = 1 + 0 = 1. G_away = 2 + 0 = 2.
- Final score: MSFT 1, TSLA 2. TSLA wins, 3 points.

### Example 3: a draw

GOOGL (home) rises 0.04%. META (away) rises 0.04%.

- Both raw: 4 bps, (4 + 2) / 5 = 1 goal each.
- G_home = 1, G_away = 1.
- Final score: 1-1. Draw, 1 point each.

### Example 4: both teams fall

JPM (home) falls 0.06%. V (away) falls 0.11%.

- JPM raw: -6 bps, (-6 - 2) / 5 = -1 goal.
- V raw: -11 bps, (-11 - 2) / 5 = -2 goals.
- G_home = max(0, -1) + max(0, 2) = 2.
- G_away = max(0, -2) + max(0, 1) = 1.
- Final score: JPM 2, V 1. JPM wins, 3 points. The team that fell less wins
  the match, because its smaller fall concedes fewer goals.

### Example 5: a quiet hour, 0-0

DIS (home) rises 0.01%. NFLX (away) falls 0.02%.

- DIS raw: 1 bp, (1 + 2) / 5 = 0 goals.
- NFLX raw: -2 bps, (-2 - 2) / 5 = 0 goals.
- Final score: 0-0. Draw, 1 point each.

### Example 6: the 10-goal cap

MSTR (home) rises 0.60% in a wild hour. GME (away) falls 0.60%.

- MSTR raw: 60 bps, (60 + 2) / 5 = 12 goals.
- GME raw: -60 bps, (-60 - 2) / 5 = -12 goals.
- Uncapped: G_home = 12 + 12 = 24, G_away = 0.
- Capped at 10 goals per team per match: final score MSTR 10, GME 0.
- MSTR wins, 3 points. No team can score more than 10 goals in one match,
  however large the move.

## The 10-goal cap

Max 10 goals per team per match. The cap applies to the final scoreline, after
the no-negative conversion. It stops a single extreme hour from wrecking the
goal difference column for the whole season. A 10-0 win still counts as a 10-0
win for points and goal difference, it just cannot run further.

## The 3% volatile cap and the circuit breaker

Raw volatile moves are capped at 3%. At 3% a team is already at 60 raw goals,
so the 10-goal cap binds first for scoring. The 3% line matters as a review
threshold: any single-team raw move above 3% inside the match window is
flagged for circuit breaker review.

The hard circuit breaker is the same as the crypto league: a raw price spike of
plus or minus 30% by either team inside the match window pauses settlement.
Scorelines alone never trigger it. When the breaker trips, settlement waits for
review, exactly as in the crypto league and cup.

## Forfeit: no performance means 0-3

If a stock has no performance for the match period, meaning no usable price at
kickoff or at full time, or no NAV update inside the window, that team forfeits.
The opponent wins 3-0 automatically. The result is marked FORFEIT on the
fixture, the table, and the match page, so a forfeit win is always visible as a
forfeit, never mistaken for a played 3-0.

- One team with no performance: the other team wins 3-0, 3 points to the
  winner, 0 to the forfeiting team, goal difference plus 3 and minus 3.
- Both teams with no performance: the match is void. No winner, no points, no
  goals on the table. Stakes are refunded 1:1, every staker gets their full
  stake back.

A forfeit is a data failure, not a price move. A stock that falls 2% still
played the match and loses on goals. Only a missing price, not a bad price,
causes a forfeit.

## Points and the table

- Win: 3 points. Draw: 1 point. Loss: 0 points.
- Table tiebreak, in order: points, then goal difference, then goals scored,
  then wins, then fewest losses.
- Goal difference and goals scored include forfeit results (3-0) but never void
  matches. A void match leaves no trace on the table.

## The 1-hour window

Each match is a 1-hour window. The kickoff price is snapshotted at the start of
the hour and the full-time price at the end. Only movement inside that hour
counts. What the stock did before kickoff or after full time is irrelevant.

Kickoffs are staggered randomly across the matchday, like the crypto league, so
fixtures are spread across the day rather than all starting at once. A matchday
lasts 1 day and all 11 of its matches end the same day.

## The price feed and staleness

Primary feed: Chainlink NAV via the Base Tokenized Stocks API. The API returns
`nav_price` (the most recent Chainlink-based NAV/reference value),
`nav_price_updated_at`, and the current `multiplier` per token. The on-chain
oracle registry is a single contract at
`0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD`, which returns the multiplier and a
pause flag per token in one call.

NAV feeds update only on price deviation or heartbeat, and can hold their last
value for a stretch. Every snapshot checks staleness against
`nav_price_updated_at` before trusting a price.

- If the NAV is stale at snapshot time, the snapshot is BLOCKED, exactly like
  the crypto league blocks on a stale price. No snapshot, no settlement, no
  guessed price.
- If a blocked snapshot leaves a team with no performance for the period, the
  forfeit rule above applies.
- CoinGecko is the last resort only, and only if it has a price for that token.
  A snapshot pair prefers the same source for both teams.
- Dinari is NOT a fallback. The Dinari API is enterprise and key-gated, not a
  free public price feed, so it is not 100% worthy as a drop-in fallback. It is
  used only if the user supplies a `DINARI_API_KEY_ID`. It is never used
  automatically.

B20 tokens are native precompiles on Base, not separately deployed contracts.
There is no per-token bytecode on Basescan. That does not block the league: the
league only reads prices and stakes TICK, it never holds the stock tokens.

## How stock scoring differs from crypto scoring

| | Crypto league | Stock league |
| --- | --- | --- |
| Goal threshold | 1 goal = 0.5% (50 bps) | 1 goal = 0.05% (5 bps) |
| Match window | 1 hour | 1 hour |
| Price feed | Coinbase, Binance, CoinGecko | Chainlink NAV via Base API, CoinGecko last resort |
| Rounding | Half-up | Half-up |
| No-negative scorelines | Yes | Yes, same formula |
| Points | 3 / 1 / 0 | 3 / 1 / 0 |
| Table tiebreak | Points, GD, GF, wins, fewest losses | Same order |
| Goal cap | None stated | 10 per team per match |
| Volatile cap | None stated | 3% raw, plus circuit breaker review |
| Forfeit | None stated | No performance, 0-3, marked FORFEIT |
| Void | None stated | Both no performance, stakes refunded 1:1 |
| Circuit breaker | Plus or minus 30% raw spike | Same |

## How stock scoring is the same as crypto scoring

The game is identical. Price performance is the score, stakes are TICK,
everything settles on chain. The same half-up rounding, the same no-negative
formula, the same points, the same tiebreak order, the same 7% pool fee, the
same treasury rule, the same 1-hour match. Only the goal threshold changed,
because stocks move about ten times less than crypto in an hour, and the
forfeit, void, goal cap, and volatile cap rules were written down for stocks
because a stock feed can go quiet in ways a crypto feed rarely does.

## Quick reference

- 1 goal = 0.05% = 5 bps. `BPS_PER_GOAL = 5`.
- Half-up rounding, integer math, half-goal value 2 bps.
- `G_home = max(0, r_h) + max(0, -r_a)`, `G_away = max(0, r_a) + max(0, -r_h)`.
- Max 10 goals per team per match.
- Raw volatile cap 3%, circuit breaker review above it, hard pause at plus or
  minus 30%.
- Forfeit: one team with no performance loses 0-3, marked FORFEIT.
- Void: both teams with no performance, stakes refunded 1:1.
- Points 3 / 1 / 0. Tiebreak: points, GD, GF, wins, fewest losses.
- Season: 22 teams, 21 matchdays, 231 fixtures, Nov 26 to Dec 16 2026.
