/**
 * TICKR Stock Meme Arena docs content.
 *
 * Step 3 of the STOCK BUILD, locked Nov 20 2026. Companion to the stock
 * league docs content (content-stock.ts) and the stock price target
 * markets docs content (content-stock-markets.ts). The stock league is a
 * season of 1-hour matches with a fixed roster and a table. The Arena is
 * different: open outperform clashes plus a Weekly Meme Cup, with no
 * table and no fixed roster.
 *
 * MERGE INSTRUCTIONS
 * ------------------
 * 1. This file follows the same shape as content-stock.ts,
 *    which is modelled on packages/docs/src/lib/content.ts in the docs
 *    package and lives on main as
 *    packages/docs/src/lib/content-stock.ts. Merge this file beside it as
 *    packages/docs/src/lib/content-arena.ts, or merge its exports
 *    into the docs content module. Do not paste it over the stock league
 *    or stock markets content. The Arena sections are additive.
 * 2. Wire the new sections into the docs navigation under a "Stock Meme
 *    Arena" group, in this order: Arena Overview, How Clashes Work,
 *    Weekly Meme Cup, Rankings, Arena FAQ.
 * 3. Wire the fee, seed, liquidity, window, breaker, and ranking
 *    constants into the frontend from the same source of truth as the
 *    contracts: treasury 300 bps, creator 200 bps, resolver 100 bps,
 *    seed 250 TICK, liquidity floor 5000 USD, breaker 3000 bps.
 * 4. No em dash anywhere in user-facing copy. Use commas, periods, or
 *    colons.
 * 5. The copy below is locked to the Nov 20 2026 Arena decisions. If a
 *    locked value changes (fees, seed, liquidity floor, window lengths,
 *    breaker threshold, tie rule, cup qualification, K values), update
 *    meme-arena-guide.md and meme-arena-faq.md first, then update this
 *    file to match. Never edit this file alone.
 * 6. Winner rule warning for implementers: a clash winner is always the
 *    strict percent comparison, never the rounded display scoreline. An
 *    exact percent tie resolves to No. In a cup tie, the percent tie is
 *    broken by window volume, then by seed. Do not reuse the display
 *    scoreline to settle a clash.
 */

export interface ArenaDocsSection {
  slug: string;
  title: string;
  group: "stock-meme-arena";
  updated: string;
  body: string;
}

/** Fee split at resolution, taken from stakes only. Locked Nov 20 2026. */
export const ARENA_TREASURY_FEE_BPS = 300;
export const ARENA_CREATOR_FEE_BPS = 200;
export const ARENA_RESOLVER_FEE_BPS = 100;
/** Total fees: 600 bps, 6%. Winners share the remaining 94% of stakes,
 * plus the seed. */
export const ARENA_TOTAL_FEE_BPS = 600;
/** TICKR seeds each clash with 250 TICK, paid into the winners pool. */
export const ARENA_SEED_TICK = 250;
/** Creation requires a live pool with liquidity at or above this floor. */
export const ARENA_LIQUIDITY_FLOOR_USD = 5000;
/** Window starts 1 hour after creation. Staking closes at window start. */
export const ARENA_WINDOW_DELAY_HOURS = 1;
/** Standard clash length. */
export const ARENA_STANDARD_WINDOW_HOURS = 24;
/** Blitz clash length. */
export const ARENA_BLITZ_WINDOW_HOURS = 1;
/** Circuit breaker: a raw move of plus or minus 30% on either side
 * inside the window voids the clash automatically. */
export const ARENA_CIRCUIT_BREAKER_BPS = 3000;
export const ARENA_CIRCUIT_BREAKER_PERCENT = 30;
/** Display scoreline only: 1 goal per 0.5% of price movement. The
 * scoreline never decides the winner. */
export const ARENA_PERCENT_PER_GOAL = 0.5;
/** Weekly Meme Cup qualification. */
export const ARENA_CUP_FIELD_MAX = 32;
export const ARENA_CUP_FIELD_MIN = 8;
export const ARENA_CUP_MIN_AGE_HOURS = 48;
export const ARENA_CUP_VOLUME_WINDOW_DAYS = 7;
/** Rankings: Elo-style, from cup matches only. */
export const ARENA_RANKING_START_POINTS = 1000;
export const ARENA_RANKING_MAX_LISTED = 140;
export const ARENA_RANKING_K_BY_ROUND = {
  roundOf32: 20,
  roundOf16: 25,
  quarterFinal: 30,
  semiFinal: 40,
  final: 60,
} as const;
/** The staking token, the same TICK used across all of TICKR. */
export const ARENA_TICK_TOKEN =
  "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b";

/**
 * The worked payout example from meme-arena-guide.md, kept as constants
 * so the docs, the frontend explainer, and any test fixture agree.
 * Clash pool: Yes 800 TICK, No 1,200 TICK, total stakes 2,000 TICK.
 * Fees on stakes only: treasury 60 TICK, creator 40 TICK, resolver
 * 20 TICK, total 120 TICK. Distributable from stakes 1,880 TICK, plus
 * the 250 TICK seed, so winners share 2,130 TICK. A 200 TICK stake on
 * Yes is 25% of the 800 TICK winning side and pays 532.50 TICK.
 */
export const ARENA_EXAMPLE = {
  yesTotalTick: 800,
  noTotalTick: 1200,
  totalStakesTick: 2000,
  treasuryFeeTick: 60,
  creatorFeeTick: 40,
  resolverFeeTick: 20,
  totalFeesTick: 120,
  distributableFromStakesTick: 1880,
  seedTick: 250,
  winnersPoolTick: 2130,
  exampleStakeTick: 200,
  examplePayoutTick: 532.5,
  exampleSharePercent: 25,
} as const;

/**
 * The worked scoreline examples from meme-arena-guide.md. The scoreline
 * is display only, at 1 goal per 0.5%. The winner is always the strict
 * percent comparison.
 */
export const ARENA_SCORELINE_EXAMPLES = [
  {
    memeMovePercent: 3,
    opponentMovePercent: 1,
    memeGoals: 6,
    opponentGoals: 2,
    winner: "Yes",
    note: "3% is strictly greater than 1%, so Yes wins. Display shows 6-2.",
  },
  {
    memeMovePercent: 1,
    opponentMovePercent: 1,
    memeGoals: 2,
    opponentGoals: 2,
    winner: "No",
    note: "Exact percent tie, so No wins, even though the display shows 2-2.",
  },
] as const;

/**
 * The worked ranking examples from meme-arena-guide.md, verified by
 * calculation. Example 1: two memes at 1000 meet in a semi-final,
 * K = 40, expected 0.5 each, winner gains 20 to 1020, loser drops to
 * 980. Example 2: a 1200 meme beats a 1000 meme in a quarter-final,
 * K = 30, expected for the favourite is about 0.7597, gain is about
 * 7.21, so the ratings become 1207.21 and 992.79.
 */
export const ARENA_RANKING_EXAMPLES = [
  {
    label: "Level semi-final",
    round: "semi-final",
    k: 40,
    winnerBefore: 1000,
    loserBefore: 1000,
    expectedWinner: 0.5,
    gain: 20,
    winnerAfter: 1020,
    loserAfter: 980,
  },
  {
    label: "Favourite wins quarter-final",
    round: "quarter-final",
    k: 30,
    winnerBefore: 1200,
    loserBefore: 1000,
    expectedWinner: 0.7597,
    gain: 7.21,
    winnerAfter: 1207.21,
    loserAfter: 992.79,
  },
] as const;

/**
 * Distributable pool from stakes after fees, mirroring the locked fee
 * split: 3% treasury, 2% creator, 1% resolver, taken from stakes only.
 * Integer math, truncation per fee, matching the MarketFactory fee
 * pattern. The seed is not charged a fee: it is added in full to the
 * winners pool by arenaWinnersPool.
 */
export function arenaDistributableFromStakes(totalStakes: number): number {
  const pool = Math.trunc(totalStakes);
  const treasury = Math.floor((pool * ARENA_TREASURY_FEE_BPS) / 10_000);
  const creator = Math.floor((pool * ARENA_CREATOR_FEE_BPS) / 10_000);
  const resolver = Math.floor((pool * ARENA_RESOLVER_FEE_BPS) / 10_000);
  return pool - treasury - creator - resolver;
}

/**
 * Total paid to the winning side: the distributable pool from stakes
 * plus the 250 TICK seed. If the winning side has no stakers, this
 * amount is not paid to stakers at all: the treasury rule applies and
 * the entire pool goes to the treasury.
 */
export function arenaWinnersPool(totalStakes: number): number {
  return arenaDistributableFromStakes(totalStakes) + ARENA_SEED_TICK;
}

/**
 * Payout for a winning stake: the stake share of the winning side
 * times the winners pool. Returns 0 when the winning side is empty.
 * The empty winning side case is the treasury rule in practice: if
 * nobody staked on the winning side, the entire pool goes to the
 * treasury and this function is never used to pay anyone.
 */
export function arenaPayout(
  stake: number,
  winningSideTotal: number,
  totalStakes: number,
): number {
  if (stake <= 0 || winningSideTotal <= 0 || totalStakes <= 0) return 0;
  return (stake / winningSideTotal) * arenaWinnersPool(totalStakes);
}

/**
 * Live multiplier for one side: what 1 TICK on that side returns if
 * that side wins and the pool freezes now, including the seed in the
 * winners pool. It moves as stakes arrive, so it is an estimate, not
 * a promise.
 */
export function arenaMultiplier(
  sideTotal: number,
  totalStakes: number,
): number | null {
  if (sideTotal <= 0 || totalStakes <= 0) return null;
  return arenaWinnersPool(totalStakes) / sideTotal;
}

/**
 * The clash winner rule. Yes wins only if the meme percent move is
 * strictly greater than the opponent percent move. An exact tie
 * resolves to No. In a derby, No is the second meme. This function
 * uses the raw percent moves, never the rounded display scoreline.
 */
export function arenaYesWins(
  memeMovePercent: number,
  opponentMovePercent: number,
): boolean {
  return memeMovePercent > opponentMovePercent;
}

/**
 * Display goals for one side, at 1 goal per 0.5%. Display only. The
 * result of this function must never be used to settle a clash.
 */
export function arenaDisplayGoals(movePercent: number): number {
  return Math.round(movePercent / ARENA_PERCENT_PER_GOAL);
}

/**
 * Circuit breaker check: true when either side moved by plus or minus
 * 30% or more inside the window. A true result voids the clash
 * automatically, with 1:1 refunds and no winner.
 */
export function arenaBreakerTripped(
  memeMovePercent: number,
  opponentMovePercent: number,
): boolean {
  return (
    Math.abs(memeMovePercent) >= ARENA_CIRCUIT_BREAKER_PERCENT ||
    Math.abs(opponentMovePercent) >= ARENA_CIRCUIT_BREAKER_PERCENT
  );
}

/**
 * Elo expected score for the first meme against the second:
 * expected = 1 / (1 + 10^(-(Ra - Rb) / 400)).
 */
export function arenaExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, -(ratingA - ratingB) / 400));
}

/**
 * Zero-sum Elo update for a cup match. The winner gains
 * K x (1 - expected) and the loser loses the same amount. Returns the
 * two new ratings. Open clashes must never call this function: only
 * cup matches change rankings.
 */
export function arenaEloUpdate(
  winnerRating: number,
  loserRating: number,
  k: number,
): { winnerAfter: number; loserAfter: number; gain: number } {
  const expected = arenaExpectedScore(winnerRating, loserRating);
  const gain = k * (1 - expected);
  return {
    winnerAfter: winnerRating + gain,
    loserAfter: loserRating - gain,
    gain,
  };
}

export const ARENA_OVERVIEW_SECTION: ArenaDocsSection = {
  slug: "stock-meme-arena/overview",
  title: "Stock Meme Arena overview",
  group: "stock-meme-arena",
  updated: "2026-11-20",
  body: [
    "The Stock Meme Arena is where stock-paired memecoins launched on BaseStonk meet TICKR. Every meme in the Arena is paired to a tokenized stock. The Arena asks one question in two formats: can the meme outperform its opponent over a short window? If the stock is on Base, you can predict its next move, and now you can predict whether its meme can beat it.",
    "",
    "The Arena has two parts. Open clashes are single Yes or No markets anyone can create and stake on: Will [MEME] outperform [OPPONENT] over the window? The Weekly Meme Cup is a fully automatic knockout tournament, seeded every Monday, where the top memes meet head to head across the week. There is no league table, no fixed roster, and no season. New memes join when they launch on BaseStonk, and the cup field is decided fresh every week.",
    "",
    "A league, not a casino: the Arena keeps score. Clashes settle on recorded prices stored on chain, the cup produces a champion every week, and the rankings on the data page record who won cup matches over time. The scorekeeping is the product.",
    "",
    "Where clashes live: meme clashes appear in the fixtures page with their own filter and inside All, on the homepage like the stock sections, and in Markets under a new create template. The clash detail page mirrors the stock match page, but it links to BaseStonk instead of a TradingView chart. Cup history and rankings live on the data page at /arena.",
    "",
    "The registry is dynamic. TICKR polls the BaseStonk token list, so every launch on BaseStonk with a paired stock appears in the Arena automatically. A meme is listed as soon as it is indexed. Whether it can be picked for a new clash depends on the liquidity floor: creation requires a live pool with liquidity at or above 5000 USD. Below that floor a meme is listed but cannot be picked.",
    "",
    "The debut loop: every new BaseStonk launch with a paired stock automatically gets a debut clash against its paired stock, created by the system. Nobody has to create the first clash for a new meme. After the debut, anyone can create further clashes on that meme, subject to the liquidity floor.",
    "",
    "Commentary is selective in the Arena. It appears only on cup semi-finals, the cup final, and featured clashes. Open clashes and early cup rounds run without commentary.",
  ].join("\n"),
};

export const ARENA_CLASH_SECTION: ArenaDocsSection = {
  slug: "stock-meme-arena/clashes",
  title: "How clashes work",
  group: "stock-meme-arena",
  updated: "2026-11-20",
  body: [
    "A clash is one question with two answers: Will [MEME] outperform [OPPONENT] over the window? You answer Yes or No. Staking is parimutuel, in TICK, the same staking token used across all of TICKR.",
    "",
    "The opponent: by default the opponent is the meme's BaseStonk paired stock, so Yes means the meme beats its own stock. If you pick another meme paired to the same stock as the opponent instead, the clash is a derby: meme against meme, both paired to the same stock. In a derby, Yes is the first meme and No is the second meme. One factory and one flow cover both forms.",
    "",
    "Step 1, create: pick the meme, confirm the opponent (the paired stock by default, or another meme on the same stock for a derby), and choose the window length, 24 hours standard or 1 hour blitz. Creation requires a live pool for the meme with liquidity at or above 5000 USD. Below that floor the meme is listed but cannot be picked. The creator earns a 2% creator fee at resolution.",
    "",
    "Step 2, stake: staking opens at creation. Every stake goes into one pool split across Yes and No. Staking closes at window start, 1 hour after creation. No stakes are taken once the window is running, so the price race itself cannot be staked on after it begins.",
    "",
    "Step 3, the window: the window starts 1 hour after creation and runs for 24 hours, or 1 hour for a blitz clash. At the start, snapshots are taken on both sides. At the end, snapshots are taken again. The meme price comes from BaseStonk. The stock price comes from the Coinbase NAV, the same NAV feed as the stock league and the stock price target markets. In a derby, both sides use BaseStonk meme prices.",
    "",
    "Step 4, resolution: resolution is submitted by the TICKR backend resolver, and the four snapshot prices are stored on chain: meme start, meme end, opponent start, and opponent end. The resolver compares the two percent moves. Yes wins only if the meme percent move is strictly greater than the opponent percent move. An exact tie means No wins. In a derby, No is the second meme, so a tie means the second meme wins. The resolver earns a 1% resolver fee.",
    "",
    "Live display and the scoreline: while a clash is live, the page shows both percent moves and a scoreline at 1 goal per 0.5% of movement. The scoreline is display only. The winner is always the strict percent comparison, never the rounded score. Example: meme +3% against stock +1% shows 6-2, and Yes wins because 3% is strictly greater than 1%. Example: meme +1% against stock +1% shows 2-2, and No wins, because an exact percent tie resolves to No even though the scoreline is level.",
    "",
    "Circuit breaker: a raw move of plus or minus 30% on either side inside the window voids the clash automatically. There is no winner, no fee is taken, and every stake is refunded 1:1. This is an automatic void, not a vote. It differs from the crypto cup, which used a dispute vote for its breaker cases: the Arena default is automatic void, with no ballot and no waiting period.",
    "",
    "Missing price: if a price is missing on either side at a snapshot, the clash is void. A void clash has no winner and every stake is refunded 1:1 in full, with no fee taken. TICKR never fabricates a price to settle a clash.",
    "",
    "Fees at resolution: 3% to the TICKR treasury, 2% to the clash creator, 1% to the resolver, 6% in total, taken from stakes only. Winners share the remaining 94% of stakes, plus the 250 TICK seed, which goes into the winners pool in full. No fee is taken on a void clash, because stakes are refunded 1:1.",
    "",
    "Treasury rule: if the winning side has no stakers, the entire pool goes to the TICKR treasury, with no refunds. That is the same treasury rule as every other TICKR pool. A void is different: a void means there was no valid result, so everyone is refunded.",
    "",
    "Worked example: Yes holds 800 TICK, No holds 1,200 TICK, total stakes 2,000 TICK. The meme finishes strictly ahead, so Yes wins. Fees on stakes only: treasury 60 TICK, creator 40 TICK, resolver 20 TICK, total 120 TICK. Winners share 1,880 TICK from stakes plus the 250 TICK seed, 2,130 TICK in total. A 200 TICK stake on Yes is 25% of the winning side and pays 532.50 TICK.",
    "",
    "Claiming: after a clash resolves, claim from the clash page. Winnings are TICK, paid to your wallet when you claim. If the clash is void, claim your 1:1 refund from the same place.",
  ].join("\n"),
};

export const ARENA_CUP_SECTION: ArenaDocsSection = {
  slug: "stock-meme-arena/weekly-cup",
  title: "Weekly Meme Cup",
  group: "stock-meme-arena",
  updated: "2026-11-20",
  body: [
    "The Weekly Meme Cup is a fully automatic knockout tournament for Arena memes. The system seeds it every Monday at 00:00 UTC, creates every tie, advances every winner, and completes the final by Sunday. Nobody enters by hand and nobody seeds by hand.",
    "",
    "Qualification: a meme qualifies only if all three conditions hold at seeding time. First, it launched at least 48 hours before seeding. Second, its live pool liquidity is at or above the floor, 5000 USD. Third, it ranks in the top 32 by total trading volume over the 7 days before seeding. Volume decides the field, and volume decides the seeds: the highest volume meme is seed 1.",
    "",
    "A smaller field, never a padded field: if fewer than 32 memes qualify, the bracket shrinks rather than padding. 16 qualifiers make a 16 bracket, 8 qualifiers make an 8 bracket, and when the qualifier count sits between bracket sizes the field is cut to the lower size, so 20 qualifiers means the top 16 play and the rest miss out that week. There are no byes. If fewer than 8 memes qualify, there is no cup that week. The cup never invents entrants to fill a bracket.",
    "",
    "Seeding and ties: the bracket is seeded, 1 against 32 style, so the top seed meets the lowest seed in the first round. Every tie is a 24 hour meme against meme clash created by the system, with the same snapshot, resolution, breaker, and fee rules as an open clash. Winners advance automatically to the next round. Rounds run across the week and the final completes by Sunday, when the champion is decided.",
    "",
    "Cup tiebreak: an exact percent tie in a cup tie does not resolve to No the way an open clash does. The meme with the higher trading volume during the window advances. If window volume is also tied, the higher seed advances. The tiebreak exists so a cup tie always produces a winner to advance.",
    "",
    "Voids and replays in the cup: if a cup tie is voided by the circuit breaker or by a missing price, the tie is replayed once. If the replay is also void, the higher seed advances. A meme cannot be eliminated by two voids in a row, and the bracket cannot stall on a void.",
    "",
    "Commentary scope: commentary appears only on cup semi-finals, the cup final, and featured clashes. First rounds, quarter-finals that are not featured, and open clashes run without commentary.",
    "",
    "What the cup is not: cup results feed the rankings on the /arena data page, but rankings never feed back into the cup. Qualification and seeding are always the trailing 7-day volume, the age check, and the liquidity floor. A high ranking does not qualify a meme, and a low ranking does not exclude one.",
  ].join("\n"),
};

export const ARENA_RANKINGS_SECTION: ArenaDocsSection = {
  slug: "stock-meme-arena/rankings",
  title: "Arena rankings",
  group: "stock-meme-arena",
  updated: "2026-11-20",
  body: [
    "Rankings are an Elo-style points table for Arena memes, shown on the data page at /arena. A meme starts at 1000 points at its first cup appearance. Points persist across weeks, with no decay: a rating earned in one week is the rating the meme carries into the next cup it qualifies for.",
    "",
    "Cup matches only: only Weekly Meme Cup matches change rankings. Open clashes never count, no matter how large the pool. A meme that wins open clashes all week and never plays a cup match keeps its previous rating unchanged.",
    "",
    "The formula: for a match between meme A rated Ra and meme B rated Rb, the expected score for A is expected = 1 / (1 + 10^(-(Ra - Rb) / 400)). The winner gains K x (1 - expected), calculated with the winner expected score, and the loser loses the same amount. The update is zero-sum: every point the winner gains comes from the loser, so the total points across both memes do not change.",
    "",
    "K by round: the later the round, the more a win is worth. Round of 32: K = 20. Round of 16: K = 25. Quarter-final: K = 30. Semi-final: K = 40. Final: K = 60. A final win between two level memes is worth three times a Round of 32 win between two level memes.",
    "",
    "Worked example 1, level semi-final: two memes both at 1000 meet in a semi-final, K = 40. Expected for each is 1 / (1 + 10^0) = 0.5. The winner gains 40 x (1 - 0.5) = 40 x 0.5 = 20 points, going to 1020. The loser drops by the same 20 points, to 980. Check: 1020 + 980 = 2000, the same total as 1000 + 1000 before the match.",
    "",
    "Worked example 2, favourite wins a quarter-final: a 1200 meme beats a 1000 meme in a quarter-final, K = 30. Expected for the favourite is 1 / (1 + 10^(-200 / 400)) = 1 / (1 + 10^-0.5), which is about 0.7597. The gain is 30 x (1 - 0.7597) = 30 x 0.2403, which is about 7.21 points. The favourite goes to 1207.21 and the loser drops to 992.79. Check: 1207.21 + 992.79 = 2200, the same total as 1200 + 1000 before the match. Beating a weaker meme pays less, because the result was expected.",
    "",
    "What rankings do not do: rankings never affect qualification or seeding. A meme qualifies for the cup on age, liquidity, and trailing 7-day volume only, and it is seeded on that volume only. The rankings table is a record of cup results, up to 140 memes on the /arena page, not a route into the cup.",
    "",
    "The data page: /arena shows two things. First, cup history: past cup winners and runner-ups, week by week. Second, the rankings table: every ranked meme with its current points, up to 140 memes. If you want to know who the cup has rewarded over time, the rankings are the record. If you want to know who plays next week, check volume, age, and liquidity instead.",
  ].join("\n"),
};

export const ARENA_FAQ_SECTION: ArenaDocsSection = {
  slug: "stock-meme-arena/faq",
  title: "Stock Meme Arena FAQ",
  group: "stock-meme-arena",
  updated: "2026-11-20",
  body: [
    "Is this a league? No. The Arena has open clashes plus a Weekly Meme Cup. There is no table, no fixed roster, and no season. New memes join when they launch on BaseStonk, and the cup field is decided fresh every Monday on trailing 7-day volume.",
    "",
    "What happens on an exact tie? In an open clash, an exact percent tie means No wins. Yes wins only on a strictly greater percent move. In a cup tie, an exact percent tie is broken by higher trading volume during the window, then by higher seed.",
    "",
    "Who creates the debut clash? The system does. Every new BaseStonk launch with a paired stock automatically gets a debut clash against its paired stock. Nobody has to create a meme's first clash.",
    "",
    "What if a price is missing? The clash is void. Every stake is refunded 1:1 in full, with no fee taken. In the cup, a void tie is replayed once, and a second void advances the higher seed.",
    "",
    "What does the 30% breaker do? A raw move of plus or minus 30% on either side inside the window voids the clash automatically, with 1:1 refunds and no winner. There is no vote. That differs from the crypto cup, which used a dispute vote: the Arena default is automatic void.",
    "",
    "Do rankings help a meme qualify? No. Rankings never affect qualification or seeding. Qualification is age at least 48 hours, liquidity at or above 5000 USD, and top 32 by trailing 7-day volume. Seeding is that volume order only.",
    "",
    "Do open clashes change rankings? No. Rankings come from cup matches only. Open clashes never count toward points.",
    "",
    "What is a derby? A clash where the opponent is another meme paired to the same stock, instead of the stock itself. Yes is the first meme, No is the second meme, and an exact tie means the second meme wins.",
    "",
    "How is the live score worked out, and does it decide the winner? The live scoreline shows 1 goal per 0.5% of movement for each side. It is display only and it never decides the winner. The winner is always the strict percent comparison. A 2-2 scoreline on an exact 1% against 1% tie still resolves to No.",
  ].join("\n"),
};

/** All Stock Meme Arena docs sections, in navigation order. */
export const ARENA_DOCS_SECTIONS: ArenaDocsSection[] = [
  ARENA_OVERVIEW_SECTION,
  ARENA_CLASH_SECTION,
  ARENA_CUP_SECTION,
  ARENA_RANKINGS_SECTION,
  ARENA_FAQ_SECTION,
];

/**
 * Stock Meme Arena versus the rest of TICKR, for the docs comparison
 * table. The pool model, token, fees, seed, and treasury rule are
 * shared. The question, the registry, the winner rule, and the cup
 * are Arena specific.
 */
export const ARENA_VS_REST = [
  { label: "Format", rest: "League seasons and single markets", arena: "Open clashes plus a weekly knockout cup, no table" },
  { label: "Question", rest: "Fixture outcome or price target, Yes or No templates vary", arena: "Will [MEME] outperform [OPPONENT] over the window? Yes or No" },
  { label: "Underlying list", rest: "Fixed league rosters, dynamic stock list for targets", arena: "Dynamic: every BaseStonk launch with a paired stock" },
  { label: "Creation", rest: "Anyone can create markets, fixtures are scheduled", arena: "Anyone can create clashes, liquidity floor applies, debut clash is automatic" },
  { label: "Winner rule", rest: "Scoreline or target comparison, template specific", arena: "Strict percent comparison only, exact tie resolves to No" },
  { label: "Display score", rest: "Scoreline settles league fixtures", arena: "Scoreline at 1 goal per 0.5% is display only, never settles" },
  { label: "Window", rest: "1 hour fixtures, deadline targets", arena: "Starts 1 hour after creation, 24 hours or 1 hour blitz" },
  { label: "Resolution prices", rest: "Oracle snapshots or deadline NAV", arena: "Four snapshots stored on chain: BaseStonk meme price, Coinbase NAV for stocks" },
  { label: "Breaker", rest: "Crypto cup used a dispute vote", arena: "Plus or minus 30% on either side voids automatically, refunds 1:1" },
  { label: "Staking token", rest: "TICK", arena: "TICK, same token" },
  { label: "Pool model", rest: "Parimutuel", arena: "Parimutuel" },
  { label: "Fees", rest: "3% treasury, 2% creator, 1% resolver on stock markets", arena: "3% treasury, 2% creator, 1% resolver, on stakes only" },
  { label: "Seed", rest: "250 TICK featured seed", arena: "250 TICK into the winners pool" },
  { label: "Treasury rule", rest: "Empty winning side pays the treasury", arena: "Same: entire pool to the treasury, no refunds" },
  { label: "Rankings", rest: "League tables and TP leaderboards", arena: "Elo-style, cup matches only, never affects qualification" },
] as const;
