# TICKR Stock Meme Arena: FAQ

Status: step 3 of the STOCK BUILD, locked Nov 20 2026. Companion to
meme-arena-guide.md, which has the full rules and worked examples.

## The basics

### Is this a league?

No. The Arena has open clashes plus a Weekly Meme Cup. There is no
table, no fixed roster, and no season. New memes join when they
launch on BaseStonk, and the cup field is decided fresh every Monday
on trailing 7-day volume. The stock league and the crypto league are
leagues. The Arena is markets plus a weekly knockout cup.

### What is a clash?

A clash is one question: "Will [MEME] outperform [OPPONENT] over the
window?" You stake TICK on Yes or No. The window starts 1 hour after
creation and runs for 24 hours, or 1 hour for a blitz clash. Staking
opens at creation and closes at window start. Yes wins only if the
meme's percent move is strictly greater than the opponent's percent
move.

### What is a derby?

A derby is a clash where the opponent is another meme paired to the
same stock, instead of the stock itself. Yes is the first meme and No
is the second meme. An exact tie in a derby means the second meme
(No) wins. By default, without a derby pick, the opponent is the
meme's BaseStonk paired stock.

### Who creates the debut clash?

The system does. Every new BaseStonk launch with a paired stock
automatically gets a debut clash against its paired stock, created
by the system when the launch is picked up. Nobody has to create a
meme's first clash. After the debut, anyone can create further
clashes on that meme, subject to the liquidity floor.

## Ties, prices, and the breaker

### What happens on an exact tie?

In an open clash, an exact percent tie means No wins. Yes wins only
on a strictly greater percent move, so a tie is not enough for Yes.
In a derby, No is the second meme, so a tie means the second meme
wins. In a Weekly Meme Cup tie, an exact percent tie is broken
differently: the meme with the higher trading volume during the
window advances, and if window volume is also tied, the higher seed
advances.

### What if a price is missing?

The clash is void. Every stake is refunded 1:1, in full, with no fee
taken. Resolution needs a start and end price on both sides: meme
prices come from BaseStonk and stock prices come from the Coinbase
NAV, and the four snapshot prices are stored on chain. If any
required price is missing, there is no result to settle on, so
TICKR refunds everyone instead of fabricating a price. In the cup, a
void tie is replayed once, and a second void advances the higher
seed.

### What does the 30 percent breaker do?

A raw move of plus or minus 30% on either side inside the window
voids the clash automatically. There is no winner, no fee is taken,
and every stake is refunded 1:1. The void is automatic, with no vote
and no waiting period. That differs from the crypto cup, which used
a dispute vote for its breaker cases: the Arena default is automatic
void.

### How is the live score worked out, and does it decide the winner?

The live scoreline converts each side's percent move at 1 goal per
0.5%. Meme +3% shows 6 goals, stock +1% shows 2 goals, so the
scoreline shows 6-2. The scoreline is display only. It never decides
the winner. The winner is always the strict percent comparison.

No, the scoreline does not decide the winner. Example: meme +1%
against stock +1% shows 2-2, but the percent moves are exactly tied,
so No wins. A level scoreline can still have a No winner, because
Yes needed strictly more.

## The Weekly Meme Cup and rankings

### How does a meme qualify for the Weekly Meme Cup?

Three conditions at seeding time, every Monday at 00:00 UTC: it
launched at least 48 hours before seeding, its live pool liquidity
is at or above 5000 USD, and it ranks in the top 32 by total trading
volume over the 7 days before seeding. If fewer than 32 memes
qualify, the field is cut to 16 or 8, and qualifiers below the cut
miss out that week. There are no byes. Under 8 qualifiers, there is
no cup that week.

### Do rankings help a meme qualify?

No. Rankings never affect qualification or seeding. Qualification is
age, liquidity, and trailing 7-day volume only. Seeding is that
volume order only. A high ranking does not qualify a meme, does not
improve its seed, and a low ranking does not exclude it.

### Do open clashes change rankings?

No. Rankings come from cup matches only. Open clashes never count
toward points, no matter how large the pool. A meme starts at 1000
points at its first cup appearance, gains and loses points only in
cup ties under the Elo-style formula, and keeps its points across
weeks with no decay. The rankings table and past cup winners and
runner-ups are on the data page at /arena, up to 140 memes.

## Staking and payouts

### Why can I see a meme but not pick it?

The liquidity floor. Creation requires a live pool with liquidity at
or above 5000 USD. Below that floor a meme is listed in the Arena
but cannot be picked for a new clash. It becomes pickable when its
pool liquidity reaches the floor. The same floor applies to cup
qualification.

### What are the fees, and what happens if nobody backed the winner?

At resolution, fees are 3% to the TICKR treasury, 2% to the creator,
and 1% to the resolver, 6% in total, taken from stakes only. Winners
share the remaining 94% of stakes plus the 250 TICK seed, which goes
into the winners pool in full. If the winning side has no stakers,
the entire pool goes to the TICKR treasury, with no refunds. That is
the treasury rule, the same in every TICKR pool. A void is
different: a void means the breaker tripped or a price was missing,
so everyone is refunded 1:1.

### Where does commentary appear?

Only on selected matches: cup semi-finals, the cup final, and
featured clashes. Open clashes and early cup rounds run without
commentary.
