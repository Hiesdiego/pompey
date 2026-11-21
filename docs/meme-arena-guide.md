# TICKR Stock Meme Arena: The Full Guide

Status: step 3 of the STOCK BUILD, locked Nov 20 2026. Companion to the
stock league docs and the stock price target markets docs
(stock-price-target-markets.md). The stock league is a season with a
fixed roster and a table. The Arena is different: open clashes plus a
weekly knockout cup, built on BaseStonk launches. Applies to: the Stock
Meme Arena only. Stock league fixtures and stock price target markets
keep their own rules.

## The one line version

Pick a stock-paired memecoin from BaseStonk and ask whether it can
outperform its stock, or another meme on the same stock, over 24 hours
or 1 hour. Stake TICK on Yes or No. If the stock is on Base, you can
predict its next move, and in the Arena you can predict whether its
meme beats it.

## What the Arena is

The Stock Meme Arena is where stock-paired memecoins launched on
BaseStonk meet TICKR. BaseStonk is a launchpad for memecoins paired to
tokenized stocks: every launch has a pair stock. The Arena turns that
pairing into a prediction:

> Will [MEME] outperform [OPPONENT] over the window?

The Arena has two parts, and only two parts:

- Open clashes: single Yes or No markets anyone can create and stake
  on. This is the everyday Arena.
- The Weekly Meme Cup: a fully automatic knockout tournament, seeded
  every Monday, where the top memes meet head to head across the week.

There is no league table, no fixed roster, and no season. New memes
join when they launch on BaseStonk. The cup field is decided fresh
every week. That is deliberate: a league, not a casino, keeps score,
and the Arena keeps score through settled clashes, a weekly champion,
and a rankings record, without locking memes into a season they did
not choose.

Where the Arena lives in the app:

- Meme clashes appear in the fixtures page with their own filter, and
  inside All alongside crypto and stock fixtures.
- Meme clashes appear on the homepage like the stock sections.
- The clash detail page mirrors the stock match page, but it links to
  BaseStonk instead of a TradingView chart.
- Creating a clash is a template in Markets, under Create.
- Cup history and rankings live on the data page at /arena.

### The dynamic registry and the debut loop

The registry is dynamic. TICKR polls the BaseStonk token list, so
every launch on BaseStonk with a paired stock appears in the Arena
automatically. There are no webhooks, so polling is how new launches
arrive. A meme is listed as soon as it is indexed by BaseStonk and
picked up by the poll.

Every new BaseStonk launch with a paired stock automatically gets a
debut clash, created by the system, against its paired stock. Nobody
has to create a meme's first clash, and no meme launches quietly
without a market. After the debut, anyone can create further clashes
on that meme, subject to the liquidity floor below.

Listing is not the same as being pickable. The liquidity floor decides
whether a listed meme can be picked for a new clash.

### The liquidity floor

Creation requires a live pool with liquidity at or above 5000 USD.

- At or above 5000 USD: the meme can be picked, and a clash can be
  created on it.
- Below 5000 USD: the meme is listed in the Arena, but it cannot be
  picked for a new clash. It becomes pickable when its pool liquidity
  reaches the floor.

The floor exists so clashes settle on prices from pools with enough
liquidity to be meaningful. The same floor applies to Weekly Meme Cup
qualification (see the cup section below).

## The clash, step by step

A clash is one question with two answers: Will [MEME] outperform
[OPPONENT] over the window? You answer Yes or No. Staking is
parimutuel, in TICK, the same staking token used across all of TICKR.

### The opponent, and what a derby is

By default, the opponent is the meme's BaseStonk paired stock. Yes
means the meme beats its own stock over the window. No means it does
not: the stock matched or beat the meme, including an exact tie.

You can also pick another meme paired to the same stock as the
opponent. That clash is a derby: meme against meme, both paired to
the same stock. In a derby:

- Yes is the first meme.
- No is the second meme.
- Yes wins only if the first meme's percent move is strictly greater
  than the second meme's percent move. An exact tie means the second
  meme (No) wins.

One factory and one flow cover both forms. A stock clash and a derby
are created, staked, snapshotted, and resolved the same way. Only the
opponent, and therefore the second price feed, changes.

### Step 1: Create

1. Go to Markets, choose Create, and pick the Arena template.
2. Pick the meme. If the meme shows as not pickable, its pool
   liquidity is below 5000 USD. Pick another meme or check back when
   its liquidity reaches the floor.
3. Confirm the opponent: the paired stock by default, or another meme
   on the same stock for a derby.
4. Choose the window length: 24 hours (standard) or 1 hour (blitz).
   See the blitz section below.
5. Check the question reads the way you mean it: "Will [MEME]
   outperform [OPPONENT] over the window?" Then create it.

The clash is open for staking as soon as it is created. The creator
earns a creator fee at resolution (see Fees below), so a good clash
that draws stakes pays its creator.

The debut clash is the one exception to hand creation: the system
creates it automatically for every new launch, as described above.

### Step 2: Stake

Staking opens at creation and closes at window start.

- Every stake goes into one pool, split across Yes and No.
- Pick Yes or No, enter your TICK amount, and confirm. Your stake
  joins that side of the pool.
- Staking closes when the window starts, 1 hour after creation. No
  stakes are taken once the window is running, so nobody can stake on
  a race that has already begun.
- There is no bookmaker and no house odds. What you can win depends
  entirely on how the pool splits between Yes and No.

If your side wins, you share the winners pool with everyone else who
backed your side, in proportion to what each of you staked. If your
side loses, your stake stays in the pool and goes to the winners.
Live multipliers on the clash card work the same way as on stock
price target markets: each side shows what 1 TICK on that side would
return if that side won and the pool froze at that moment, including
the seed. Multipliers move as stakes arrive, so they are estimates,
not promises.

### Step 3: The window

The window starts 1 hour after creation.

- Standard clash: the window runs for 24 hours.
- Blitz clash: the window runs for 1 hour.

The 1 hour gap between creation and window start is the staking
window. It gives stakers time to find the clash and take a side
before any price movement counts. Price movement before the window
starts does not count, and price movement after the window ends does
not count. Only the movement inside the window decides the clash.

### Step 4: Snapshots

Snapshots are taken at the start of the window and at the end of the
window, on both sides. Four prices decide every clash:

- Meme start price and meme end price, from BaseStonk.
- Opponent start price and opponent end price. For a stock opponent,
  the price is the Coinbase NAV, the same NAV feed as the stock
  league and the stock price target markets. For a derby opponent,
  the price is the second meme's BaseStonk price.

Each side's percent move is its end price compared with its start
price over the window. Resolution is submitted by the TICKR backend
resolver, and the four snapshot prices are stored on chain, so anyone
can verify the result from the recorded prices.

### Step 5: Resolution

The resolver compares the two percent moves:

- Yes wins only if the meme's percent move is strictly greater than
  the opponent's percent move.
- Any other result means No wins, including an exact tie.

Worked winner examples:

- Meme +3% against stock +1%: 3% is strictly greater than 1%, so Yes
  wins.
- Meme +1% against stock +1%: the moves are exactly equal, so No
  wins. Yes needed strictly more and did not get it.
- Derby, first meme +2% against second meme +0.5%: 2% is strictly
  greater than 0.5%, so Yes (the first meme) wins.
- Derby, first meme +0.5% against second meme +2%: No (the second
  meme) wins.

After resolution, winners can claim (see Claiming below). The
resolver earns a resolver fee for submitting the resolution.

### Blitz clashes

A blitz clash is a standard clash with a 1 hour window instead of
24 hours. Everything else is the same:

- Same creation flow, same liquidity floor, same staking window (the
  window still starts 1 hour after creation, and staking still closes
  at window start).
- Same snapshots, same strict percent winner rule, same breaker, same
  fees, same seed, same treasury rule.

Blitz suits a fast call: a launch hour, a news hour, or a derby you
want settled today. Standard 24 hour clashes suit the full trading
day. Pick the window when you create the clash. It cannot be changed
after creation.

### The live scoreline: display only

While a clash is live, the page shows both percent moves and a
scoreline. The scoreline converts each side's percent move at 1 goal
per 0.5%:

- Meme +3% shows 6 goals. Stock +1% shows 2 goals. The scoreline
  shows 6-2.
- Meme +1% shows 2 goals. Stock +1% shows 2 goals. The scoreline
  shows 2-2.

The scoreline is display only. It never decides the winner. The
winner is always the strict percent comparison, never the rounded
score.

That distinction matters most on a tie. Meme +1% against stock +1%
shows 2-2, which looks like a draw. It is not a draw: an exact percent
tie resolves to No, and the No stakers win. If you read only the
scoreline, you would call that clash level. The percent moves, not
the goals, settle it.

## The circuit breaker

A raw move of plus or minus 30% on either side inside the window
voids the clash automatically.

- Either side counts: the meme moving +30% or -30%, or the opponent
  moving +30% or -30%, inside the window trips the breaker.
- A tripped breaker means the clash is void. There is no winner, no
  fee is taken, and every stake is refunded 1:1 in full.
- The void is automatic. There is no vote, no ballot, and no waiting
  period.

Note the difference from the crypto cup, which used a dispute vote
for its breaker cases. The Arena default is automatic void. A spike
that large means the price race was not a normal contest, so the
Arena refunds everyone and moves on instead of asking stakers to
adjudicate it.

The breaker is separate from the missing price rule below. The
breaker voids a clash because a price moved too far. A missing price
voids a clash because there was no price to settle on. Both end the
same way for an open clash: void, with 1:1 refunds.

## Missing prices and voids

If a price is missing on either side at a snapshot, the clash is
void.

- No winner is declared. Yes and No are both cancelled.
- Every stake is refunded 1:1. Every staker gets their full stake
  back, in full, with no fee taken.
- TICKR never fabricates a price to settle a clash.

A void is the only case where open clash stakes come back. It is
different from the treasury rule below: a void means there was no
valid result, while the treasury rule means there was a result but
nobody backed it.

Cup ties handle voids differently, with a replay. See the Weekly
Meme Cup section below.

## Fees and the treasury rule

Fees are taken from the pool at resolution. The split is the same as
stock price target markets:

| Fee | Share | Paid to |
| --- | --- | --- |
| Treasury fee | 3% | The TICKR treasury |
| Creator fee | 2% | The clash creator |
| Resolver fee | 1% | The TICKR backend resolver |

Total fees: 6%, taken from stakes only.

- Winners share the remaining 94% of stakes, in proportion to their
  stake on the winning side.
- The 250 TICK seed goes into the winners pool in full. It is not
  charged a fee. Winners share stakes minus fees, plus the seed.
- No fee is taken on a void clash, because stakes are refunded 1:1
  in full.
- The creator fee is paid to whoever created the clash, whether or
  not they staked on it. System-created clashes (debut clashes and
  cup ties) follow the same fee split at resolution.

### The treasury rule

If the winning side has no stakers, the entire pool goes to the
TICKR treasury. No refunds.

This is the same treasury rule as every other TICKR pool. It applies
when a clash resolves with a clear winner but the winning side is
empty: for example, everyone staked Yes, the clash resolves No, and
there is nobody to pay. The whole pool, stakes and seed together,
goes to the treasury.

The treasury rule is not the void rule. A resolved clash with an
empty winning side pays the treasury. A void clash, where the breaker
tripped or a price was missing, refunds everyone.

### Worked payout example

The clash: "Will [MEME] outperform [STOCK] over the window?" The meme
finishes strictly ahead, so Yes wins.

Stakes before the window starts:

- Yes: 800 TICK in total. You staked 200 TICK of it, other Yes
  stakers staked the remaining 600 TICK.
- No: 1,200 TICK in total.
- Total stakes: 800 + 1,200 = 2,000 TICK.

Fees, taken from the 2,000 TICK of stakes only:

- Treasury: 3% of 2,000 = 60 TICK.
- Creator: 2% of 2,000 = 40 TICK.
- Resolver: 1% of 2,000 = 20 TICK.
- Total fees: 60 + 40 + 20 = 120 TICK.
- Paid from stakes to winners: 2,000 - 120 = 1,880 TICK.
- Plus the seed: 1,880 + 250 = 2,130 TICK in the winners pool.

Your payout:

- Your share of the winning side: 200 / 800 = 25%.
- Your payout: 25% of 2,130 = 532.50 TICK.
- You staked 200 TICK and receive 532.50 TICK.
- The other Yes stakers share the remaining 2,130 - 532.50 =
  1,597.50 TICK, in proportion to their stakes.
- The No stakers receive nothing. Their 1,200 TICK stayed in the
  pool and funded the payout above.

Check the totals: 60 + 40 + 20 + 532.50 + 1,597.50 = 2,250 TICK,
which is the 2,000 TICK of stakes plus the 250 TICK seed. Every TICK
is accounted for.

If the percent moves had tied exactly instead, No would have won,
the No side would have shared the 2,130 TICK winners pool, and the
Yes stakers, including you, would have received nothing.

## Claiming

After a clash resolves, claim from the clash page.

1. Open the resolved clash.
2. If you backed the winning side, claim your share. Winnings are
   TICK, paid to your wallet when you claim.
3. If you backed the losing side, there is nothing to claim. Your
   stake went to the winners.
4. If the clash is void, claim your refund instead. Refunds are 1:1,
   your full stake back.

## The Weekly Meme Cup

The Weekly Meme Cup is a fully automatic knockout tournament for
Arena memes. The system seeds it every Monday at 00:00 UTC, creates
every tie, advances every winner, and completes the final by Sunday.
Nobody enters by hand and nobody seeds by hand.

### Qualification

A meme qualifies only if all three conditions hold at seeding time,
Monday 00:00 UTC:

1. Age: it launched at least 48 hours before seeding. A meme launched
   on Saturday morning cannot play in the cup seeded the following
   Monday if it is still under 48 hours old at 00:00 UTC.
2. Liquidity: its live pool liquidity is at or above the floor,
   5000 USD, the same floor as clash creation.
3. Volume: it ranks in the top 32 by total trading volume over the
   7 days before seeding.

All three conditions matter. A high volume meme under 48 hours old
does not qualify. An old meme below the liquidity floor does not
qualify. An old, liquid meme outside the top 32 on volume does not
qualify.

### Seeding and bracket size

Seeding is the trailing 7-day volume order. The highest volume
qualifier is seed 1, the next is seed 2, and so on. The bracket is
seeded, 1 against 32 style, so the top seed meets the lowest seed in
the first round, the second seed meets the second lowest, and so on.

The field shrinks rather than padding:

- 32 qualifiers: a full 32 bracket, Round of 32, Round of 16,
  quarter-finals, semi-finals, and the final.
- Fewer qualifiers: a 16 or 8 bracket. When the qualifier count
  sits between bracket sizes, the field is cut to the lower size,
  so 20 qualifiers means the top 16 play and seeds 17 to 20 miss
  out that week. There are no byes.
- Under 8 qualifiers: there is no cup that week. The cup never
  invents entrants, never lowers the floor, and never waives the age
  check to fill a bracket.

### How cup ties work

Every tie is a 24 hour meme against meme clash created by the
system, with the same snapshots, resolution, breaker, and fee rules
as an open clash. Both prices come from BaseStonk. Staking on cup
ties follows the clash rules: staking opens at creation and closes
at window start, 1 hour after creation.

Winners advance automatically to the next round. Rounds run across
the week, and the final completes by Sunday, when the champion is
decided. A meme that keeps winning keeps playing. A meme that loses
a tie is out of that week's cup. It can qualify again the next week
on the next week's volume.

### The cup tiebreak

An exact percent tie in a cup tie does not resolve to No the way an
open clash does, because a knockout tie must produce a winner to
advance. The cup tiebreak is:

1. Higher trading volume during the window advances. The two memes'
   trading volume over the tie's 24 hour window is compared, and the
   meme with the higher window volume goes through.
2. Still tied, the higher seed advances. If window volume is also
   exactly tied, the meme seeded higher at Monday seeding (the lower
   seed number, from higher trailing 7-day volume) goes through.

The tiebreak uses volume and seed only. It never uses rankings
points (see Rankings below).

### Voids and replays in the cup

If a cup tie is voided by the circuit breaker or by a missing price,
the tie is replayed once.

- First void: the system creates a replay tie between the same two
  memes.
- Second void: if the replay is also void, the higher seed advances.
  The bracket does not stall, and no meme is eliminated by two voids
  in a row.

This differs from an open clash, where a void simply refunds everyone
and ends the clash. Cup stakers on a void tie are refunded 1:1 under
the clash void rule, and the replay is a new tie with its own pool.

### Commentary scope

Commentary appears only on selected matches:

- Cup semi-finals.
- The cup final.
- Featured clashes.

Open clashes, cup first rounds, cup Round of 16 ties, and cup
quarter-finals that are not featured run without commentary. The
Arena does not commentate every clash.

## Rankings

Rankings are an Elo-style points table for Arena memes, shown on the
data page at /arena. They record who has won cup matches over time.

### The rules

- Start: a meme starts at 1000 points at its first cup appearance.
  A meme with no cup appearance has no rating yet.
- Cup matches only: only Weekly Meme Cup matches change rankings.
  Open clashes never count, no matter how large the pool.
- No decay: points persist across weeks. A rating earned in one week
  is the rating the meme carries into the next cup it qualifies for.
  Sitting out a week does not cost points.
- Zero-sum: every point the winner gains comes from the loser. The
  total points across both memes are the same before and after a
  match.
- Table size: the rankings table on /arena lists up to 140 memes.

### The formula

For a match between meme A rated Ra and meme B rated Rb, the
expected score for A is:

    expected = 1 / (1 + 10^(-(Ra - Rb) / 400))

The winner gains:

    gain = K x (1 - expected)

where expected is the winner's expected score, calculated from the
winner's rating and the loser's rating before the match. The loser
loses the same amount the winner gains.

K depends on the round:

| Round | K |
| --- | --- |
| Round of 32 | 20 |
| Round of 16 | 25 |
| Quarter-final | 30 |
| Semi-final | 40 |
| Final | 60 |

The later the round, the more a win is worth. A final win between two
level memes (gain 30 points at K = 60 and expected 0.5) is worth
three times a Round of 32 win between two level memes (gain 10 points
at K = 20 and expected 0.5).

### Worked example 1: level semi-final

Two memes both at 1000 meet in a semi-final. K = 40.

- Expected for each meme: 1 / (1 + 10^(-(1000 - 1000) / 400)) =
  1 / (1 + 10^0) = 1 / 2 = 0.5.
- Winner gain: 40 x (1 - 0.5) = 40 x 0.5 = 20 points.
- Winner: 1000 + 20 = 1020.
- Loser: 1000 - 20 = 980.
- Check: 1020 + 980 = 2000, the same total as 1000 + 1000 before the
  match. Zero-sum holds.

### Worked example 2: favourite wins a quarter-final

A 1200 meme beats a 1000 meme in a quarter-final. K = 30.

- Rating gap: 1200 - 1000 = 200.
- Expected for the favourite: 1 / (1 + 10^(-200 / 400)) =
  1 / (1 + 10^-0.5). 10^-0.5 is about 0.3162, so expected is
  1 / 1.3162, which is about 0.7597.
- Winner gain: 30 x (1 - 0.7597) = 30 x 0.2403, which is about 7.21
  points.
- Winner (the favourite): 1200 + 7.21 = 1207.21.
- Loser: 1000 - 7.21 = 992.79.
- Check: 1207.21 + 992.79 = 2200, the same total as 1200 + 1000
  before the match. Zero-sum holds.

Beating a weaker meme pays less, because the result was expected.
The same favourite losing that quarter-final would lose
30 x 0.7597, about 22.79 points, which is why upsets move the table
more than expected wins do. Check that upset case: winner (the 1000
meme) expected is 1 - 0.7597 = 0.2403, gain is 30 x (1 - 0.2403) =
30 x 0.7597, about 22.79, going to 1022.79, and the favourite drops
to 1177.21. Total: 1022.79 + 1177.21 = 2200. Zero-sum holds again.

### What rankings never do

Rankings never affect qualification or seeding.

- A high ranking does not qualify a meme for the cup.
- A low ranking does not exclude a meme from the cup.
- A high ranking does not improve a meme's seed.

Qualification is always age, liquidity, and trailing 7-day volume.
Seeding is always that volume order. The rankings table is a record
of cup results, not a route into the cup. If you want to know who
plays next week, check volume, age, and liquidity. If you want to
know who the cup has rewarded over time, check the rankings.

## The /arena data page

The data page at /arena holds the Arena's public record. It shows two
things:

- Cup history: past cup winners and runner-ups, week by week. Every
  completed Weekly Meme Cup adds its champion and its beaten finalist
  to the history.
- The rankings table: every ranked meme with its current Elo-style
  points, up to 140 memes, ordered by points. Points come from cup
  matches only, start at 1000, and never decay.

The page is a record, not a control panel. Nothing on /arena changes
who qualifies, who is seeded where, or how a clash settles. Those
rules are stated in full above, and the page simply shows their
results over time.

## Arena beside the rest of TICKR

- Same token: stakes are TICK, the same ERC-20 staking token used in
  the crypto league, the stock league, stock markets, and crypto
  markets. Your TICK balance is shared across all of TICKR.
- Same pool model: parimutuel staking, winners share the pool minus
  fees in proportion to stake, plus the seed in the Arena, and the
  same treasury rule if nobody backed the winner.
- Same fee split as stock price target markets: 3% treasury, 2%
  creator, 1% resolver, on stakes only.
- Different format: the leagues have tables and seasons. The Arena
  has open clashes and a weekly knockout cup, with no table and no
  fixed roster.
- Different breaker handling: the crypto cup used a dispute vote for
  breaker cases. The Arena voids automatically, with 1:1 refunds.
- Different score role: league scorelines settle fixtures. The Arena
  scoreline is display only, and the strict percent comparison
  settles every clash.

## Quick reference

- Question: "Will [MEME] outperform [OPPONENT] over the window?" Yes
  or No.
- Opponent: the meme's BaseStonk paired stock by default. Another
  meme on the same stock makes a derby, where No is the second meme.
- Registry: dynamic, polled from BaseStonk. Every launch with a
  paired stock is listed automatically.
- Debut clash: automatic for every new launch, created by the system
  against the paired stock.
- Liquidity floor: creation and cup qualification require a live pool
  at or above 5000 USD. Below the floor, a meme is listed but cannot
  be picked.
- Window: starts 1 hour after creation. 24 hours standard, 1 hour
  blitz. Staking opens at creation and closes at window start.
- Snapshots: start and end on both sides, four prices stored on
  chain. Meme price from BaseStonk, stock price from Coinbase NAV.
- Winner: Yes only on a strictly greater percent move. Exact tie
  means No wins in an open clash.
- Live scoreline: 1 goal per 0.5%, display only. It never decides
  the winner.
- Circuit breaker: plus or minus 30% on either side inside the
  window voids automatically, refunds 1:1, no winner, no vote.
- Missing price: void, refunds 1:1, no fee.
- Fees at resolution: 3% treasury, 2% creator, 1% resolver, 6% in
  total, on stakes only. Winners share 94% of stakes plus the 250
  TICK seed.
- Treasury rule: if nobody staked on the winning side, the entire
  pool goes to the treasury, no refunds.
- Weekly Meme Cup: seeded every Monday 00:00 UTC. Age at least 48
  hours, liquidity at or above the floor, top 32 by trailing 7-day
  volume. Field is cut to 16 or 8 when fewer qualify, no byes, no
  cup under 8 qualifiers. Final completes by Sunday.
- Cup tiebreak: exact percent tie advances higher window volume,
  then higher seed. A void tie is replayed once, a second void
  advances the higher seed.
- Commentary: only cup semi-finals, the cup final, and featured
  clashes.
- Rankings: Elo-style, cup matches only, start 1000, no decay,
  zero-sum. K: 20, 25, 30, 40, 60 by round. Rankings never affect
  qualification or seeding.
- Data page: /arena shows cup winners and runner-ups and the
  rankings table, up to 140 memes.
