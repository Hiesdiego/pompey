export type Doc = { slug: string; title: string; description: string; group: string; readTime: string; sections: { id: string; title: string; paragraphs: string[]; note?: string; code?: string; bullets?: string[]; links?: { label: string; address: string; description: string }[] }[] };

export const docs: Doc[] = [
  { slug: "overview", title: "What is Tickr?", description: "A crypto prediction league, explained from first principles.", group: "Start here", readTime: "3 min", sections: [
    { id: "the-idea", title: "The idea", paragraphs: ["Tickr turns cryptocurrency price performance into a football-style season. Coins are teams, fixtures are timed head-to-head contests, and price moves become goals.", "Players stake TICK on a home win, draw, or away win. A fixture's official result is computed from recorded prices and settled through smart contracts on Base Sepolia in the current testnet build."] },
    { id: "the-season", title: "The season", paragraphs: ["The league has 20 teams and a 38-matchday schedule. A win earns a team three table points; a draw earns one. The table also tracks goal difference."], note: "Tickr is currently a testnet product. Testnet TICK has no monetary value." },
    { id: "what-to-read-next", title: "Choose your path", paragraphs: ["New player? Start with Your first prediction, then Match rules and Payouts. Want to verify a result? Read Price sources, Settlement, and Smart contracts."] }
  ] },
  { slug: "first-prediction", title: "Your first prediction", description: "From signing in to claiming a result.", group: "Start here", readTime: "4 min", sections: [
    { id: "sign-in", title: "1. Sign in", paragraphs: ["Sign in with email or Google. The app creates a smart wallet for your account. Pick a username and favourite team."] },
    { id: "get-tick", title: "2. Get testnet TICK", paragraphs: ["Use the in-app faucet to claim testnet TICK. TICK is the staking unit; it is not a price-tracked team coin."] },
    { id: "choose", title: "3. Choose a fixture", paragraphs: ["Open a fixture and review the two teams, kickoff time, current prices, pool and available outcomes. Select home win, draw or away win, enter a TICK stake and confirm the transaction."], note: "Stakes can remain open during play, but close five minutes before full time. Check the fixture's displayed deadline before staking." },
    { id: "finish", title: "4. Follow and claim", paragraphs: ["Live scores are indicative until the official end snapshots settle onchain. If your outcome wins, use Claim payout on the match page. A voided fixture uses a separate refund claim."] }
  ] },
  { slug: "match-rules", title: "Match rules", description: "Fixtures, goals, outcomes and the league table.", group: "The game", readTime: "5 min", sections: [
    { id: "window", title: "Fixture window", paragraphs: ["Every fixture has a start and end window. Kickoff and end price snapshots anchor each team's performance. The official score is based on those submitted prices, rather than the live chart alone."] },
    { id: "goals", title: "From price movement to goals", paragraphs: ["The scoring unit is 50 basis points, or 0.5%, per goal. Price changes are converted to integer basis points and rounded to goals by the contract. Negative movement is handled by the contract's score normalization, so read the final onchain result when a match is settled."], code: "1% = 100 bps   ·   1 goal unit = 50 bps" },
    { id: "outcome", title: "Outcome and table", paragraphs: ["The final goal counts determine home win, draw or away win. Teams earn three table points for a win and one each for a draw. Goal difference is a tiebreaking input."] }
  ] },
  { slug: "staking-payouts", title: "Staking & payouts", description: "Pool mechanics, fees, claims and voids.", group: "The game", readTime: "4 min", sections: [
    { id: "pool", title: "How the pool works", paragraphs: ["Fixture staking is parimutuel: stakes on all three outcomes form one pool. After settlement, the distributable pool is shared among people who backed the winning outcome, in proportion to their stake on that outcome."], code: "your payout = your winning stake / total winning stakes × distributable pool" },
    { id: "fee", title: "Treasury fee", paragraphs: ["The pool contract applies its configured treasury fee before distributing winner payouts. The contract caps that fee at 10%; the active fee can change within that cap, so inspect the pool or contract for the current value."], note: "A displayed potential payout is an estimate. New stakes can change pool shares before betting closes." },
    { id: "edge-cases", title: "Claims and exceptional outcomes", paragraphs: ["Winning stakes are claimed after settlement. Losing stakes are not refunded. If nobody staked the winning outcome, the contract sends the entire pool to the treasury.", "If a fixture is voided, stakers can reclaim their stakes 1:1 through the void claim path, with no fee."] }
  ] },
  { slug: "price-sources", title: "Price sources", description: "The exact source priority, freshness checks and cross-feed validation.", group: "Prices & trust", readTime: "6 min", sections: [
    { id: "sources", title: "Source order", paragraphs: ["Coinbase Exchange is the primary price source for configured teams. The default order is Coinbase, then Binance as a fallback, then CoinGecko as the final fallback. A team without a configured Coinbase pair starts with its next available source.", "The current backend polls Coinbase Exchange and Binance through REST. Binance also provides a cross-check when its quote is fresh; it is not the default primary source. League end snapshots can prefer the source used at kickoff for consistency. If that source is unavailable, the feed falls back to the normal priority order."], bullets: ["Coinbase Exchange: primary source", "Binance: fallback source and cross-check", "CoinGecko: final fallback source"] },
    { id: "freshness", title: "Freshness and availability", paragraphs: ["Each candidate must pass a source-specific age limit. A stale or missing candidate is ignored. If no fresh candidate remains, the snapshot is withheld and retried rather than fabricated.", "The checked-in backend example sets Coinbase's stale limit to 180,000 ms and the maximum cross-feed deviation to 200 basis points. Runtime configuration may differ; these are example values, not a promise about every deployment."] },
    { id: "validation", title: "Cross-feed validation", paragraphs: ["The chosen price is compared with every other fresh candidate. If any available candidate differs beyond the configured deviation threshold, validation fails and the snapshot is blocked. If only one source is fresh, no cross-source comparison is possible."], note: "A live chart or third-party widget is context. The official result uses the prices submitted to the oracle and accepted by the contracts." },
    { id: "audit", title: "What to audit", paragraphs: ["For a settled fixture, compare its recorded kickoff and end snapshots, price source metadata where available, onchain oracle submissions, and the final result. Source failover and validation are backend controls; the chain records the accepted submission, not every discarded tick."] }
  ] },
  { slug: "settlement", title: "Settlement & verification", description: "How a live fixture becomes an official result.", group: "Prices & trust", readTime: "5 min", sections: [
    { id: "lifecycle", title: "The lifecycle", paragraphs: ["The backend watches fixture windows, obtains validated price snapshots, and submits kickoff and end prices to the oracle. The contracts compute and record the outcome after the required data arrives. A result is final when the onchain settlement completes."], bullets: ["Fixture scheduled", "Kickoff snapshot submitted", "Live score shown in the app", "End snapshot validated and submitted", "Onchain result settled", "Winning claims enabled"] },
    { id: "verification", title: "Pre-submit verification", paragraphs: ["Before submitting end prices, the backend independently recomputes the expected outcome with contract-equivalent integer math and simulates the oracle call. It aborts submission if the simulated contract result and independent calculation disagree."], note: "A failed or delayed data source can delay settlement. Live UI prices should not be treated as the final result." },
    { id: "limits", title: "Trust model", paragraphs: ["Onchain contracts make submissions and payouts inspectable. The backend still selects, validates and submits source prices, so its oracle role is material. The source-priority policy and deviation guard help make that role explicit; they do not make the price feed fully trustless."] }
  ] },
  { slug: "markets", title: "Prediction markets", description: "Additional ways to predict beyond fixtures.", group: "The game", readTime: "3 min", sections: [
    { id: "types", title: "Market templates", paragraphs: ["Tickr supports market templates for matchday top gainer, season champion, head-to-head performance, price targets and fixture spreads. Each template has its own resolution rule and deadline."], note: "Read a market's displayed terms and resolution rule before staking. Fixture pool rules do not automatically describe every market." },
    { id: "resolution", title: "Resolution", paragraphs: ["Markets are created and resolved through their contracts. Some may be voided under their encoded conditions; a voided market follows its refund path. Check the individual market page for state, odds, settlement and claims."] }
  ] },
  { slug: "world-cup", title: "World Cup", description: "The cup competition alongside the league.", group: "The game", readTime: "3 min", sections: [
    { id: "overview", title: "Cup overview", paragraphs: ["The Crypto Price World Cup is a 64-team knockout competition alongside the league. Its 63 matches progress through the Round of 64, Round of 32, Round of 16, quarter-finals, semi-finals and Final. It has its own bracket, cup fixtures, staking surfaces and DEE/REKT commentary in the Tickr app."], note: "Tournament rounds and active pools are deployment-specific. Use the live cup page for the current bracket, deadlines and contract state." },
    { id: "where", title: "Where to follow it", paragraphs: ["Open World Cup in the app to see qualified teams, round progression, open markets and claimable results. Cup-specific contract rules should be checked on the relevant pool before staking."] },
    { id: "wc-points", title: "World Cup Tickr points", paragraphs: ["TP means Tickr points. WC points are a separate leaderboard score for World Cup match, spread and outright predictions; they are not TICK tokens, payouts or league table points.", "Each wallet earns 1 TP for each distinct Cup market backed, 5 TP if any backed outcome wins, 2 TP if its combined stake ranks in the top quarter of wallets in that market, 1 conviction TP if it backs only one outcome with at least 10 TICK, and 1 TP for one submitted X post URL about that market. Repeated stakes in the same market combine into one prediction. Tied point totals share a rank.", "Every registered profile is ranked, starting at 0 TP. The public leaderboard displays all registered profiles with rank, player and TP total, along with the total number of Tickr users; every profile also shows its own WC total.", "X post URLs are submitted by players. Tickr checks the URL shape and that the wallet backed the Cup market; without X API verification, a submitted URL does not prove the post's content or continued availability. The private regular market predictor rank remains separate."] }
  ] },
  {
    "slug": "ai-commentators",
    "title": "AI commentators",
    "description": "Meet DEE and REKT: World Cup previews, live commentary and honest post-match verdicts.",
    "group": "The game",
    "readTime": "4 min",
    "sections": [
      {
        "id": "voices",
        "title": "Two voices in the booth",
        "paragraphs": [
          "DEE and REKT are Tickr's AI agentic commentators for the Crypto Price World Cup. DEE leads with precise, conversational analysis. REKT adds dry humour, sharp criticism and self-roasts. They react to supplied match facts and each other's actual remarks.",
          "The booth uses full coin names and supplied nicknames, with the same standards for both teams. A tentative prediction is an opinion, not an official result or a recommendation to trade."
        ]
      },
      {
        "id": "previews",
        "title": "Five minutes before kickoff",
        "paragraphs": [
          "For scheduled matches with both teams known, previews begin within the final five minutes before kickoff. DEE speaks first and asks REKT for his view; REKT can agree or disagree. Completed tournament matches, opponents and prior results provide context.",
          "Both voices know the round and stakes, from the Round of 64 to the championship Final. They may offer tentative winner predictions while acknowledging uncertainty. If the service was offline before kickoff, an earlier preview may be absent."
        ]
      },
      {
        "id": "live",
        "title": "Following the match",
        "paragraphs": [
          "The booth follows kickoff, goals, goals chalked off after price retraces, near misses, pressure, stalemates, half-time and full-time. Live scores are computed from validated prices against the recorded start snapshot. The backend observes matches on a 30-second interval; not every observation produces a line.",
          "Live scores can change until settlement. Comments, jokes and predicted winners do not settle a pool or change the contract result."
        ]
      },
      {
        "id": "verdicts",
        "title": "Post-match accountability",
        "paragraphs": [
          "After the official match settles, DEE gives his verdict and hands over to REKT. Each voice receives its actual pre-match lines to compare expectations with the result, admit an overhyped pick or call out a performance that fell short.",
          "If no preview exists, they are instructed to avoid inventing an earlier prediction. The Final is a championship result, rather than another round of advancement. REKT's post-match direction includes a reminder to follow TICKR on X."
        ]
      },
      {
        "id": "news",
        "title": "Current news with sources",
        "paragraphs": [
          "An optional editorial feed provides up to three recent headlines with HTTPS source links and publication timestamps from the last 24 hours. The commentators are instructed to cite the supplied source and discuss potential price effects conditionally.",
          "News requires a trusted feed configured in the deployment. Without it, or when the feed is unavailable, previews rely on tournament form. Date and link checks do not independently verify a headline's truth."
        ]
      },
      {
        "id": "sharing",
        "title": "Share a commentary moment",
        "paragraphs": [
          "Use Share beside a line to preview its card. Save a PNG, copy its permanent link, share the link on X, or share the image through supported device sharing.",
          "The X action shares a link with a card preview. To attach the image directly to an X post, save the PNG and add it yourself. Shared lines are archived commentary, rather than a fresh prediction about today's price."
        ]
      },
      {
        "id": "availability",
        "title": "When a template speaks",
        "paragraphs": [
          "When model generation is disabled, unavailable, rejected or outside its token budget, the service publishes a template instead. Templates cover match events, form summaries and post-match callbacks. The commentary database must still be available.",
          "Commentary is entertainment and analysis. Use the settled onchain result for outcomes and payouts."
        ]
      }
    ]
  },
  {
    "slug": "commentary-setup",
    "title": "Commentary setup",
    "description": "Configure the Cup commentary database, voice models, token budgets and optional news feed.",
    "group": "Developers",
    "readTime": "5 min",
    "sections": [
      {
        "id": "database",
        "title": "Database and lifecycle",
        "paragraphs": [
          "Configure the backend Supabase connection and apply packages/backend/sql/cup-commentary.sql before starting the service. It creates cup_commentary_lines and cup_momentum_samples with row-level security. Existing installations must rerun the SQL update that raises the commentary text limit to 700 characters.",
          "The backend starts commentary alongside the Cup lifecycle when the Cup service is configured. Missing Supabase or an unavailable commentary table disables commentary. Missing momentum storage disables its archive while allowing commentary to continue. Restart the backend after changing its environment."
        ]
      },
      {
        "id": "models",
        "title": "Enable both voice models",
        "paragraphs": [
          "Set COMMENTARY_ENABLED=true and supply COMMENTARY_LLM_PRO_API_KEY for DEE and COMMENTARY_LLM_WITTY_API_KEY for REKT. COMMENTARY_LLM_BASE_URL selects the OpenAI-compatible completion endpoint; the checked-in example uses Groq. Keep keys in the backend environment only.",
          "COMMENTARY_LLM_PRO_MODEL and COMMENTARY_LLM_WITTY_MODEL select the models independently. The example uses openai/gpt-oss-120b for DEE and openai/gpt-oss-20b for REKT. COMMENTARY_LLM_PRO_MAX_COMPLETION_TOKENS and COMMENTARY_LLM_WITTY_MAX_COMPLETION_TOKENS set separate completion limits. These are deployment settings, not a guarantee of provider model availability."
        ]
      },
      {
        "id": "budgets",
        "title": "Budgets and fallback behaviour",
        "paragraphs": [
          "The example sets COMMENTARY_DAILY_TOKEN_BUDGET=30000, COMMENTARY_MATCH_TOKEN_BUDGET=5000 and COMMENTARY_MAX_LINES_PER_MATCH=24. The service reserves context and completion allowance before a model request. Completion limits also cover reasoning where applicable.",
          "The line cap limits lower-priority additions; essential exchanges and match events can exceed it. Budget limits stop further model requests, while templates can still be published. Requests have timeouts and provider backoff. Generated text is checked for length, score conflicts, ungrounded numbers, banned terms and repeated lines."
        ]
      },
      {
        "id": "news-feed",
        "title": "Optional editorial news feed",
        "paragraphs": [
          "Set COMMENTARY_NEWS_URL to a trusted endpoint returning a JSON array. Each item must contain a title of at most 240 characters, an HTTPS url and an ISO publication timestamp in publishedAt. The service uses at most three qualifying items from the previous 24 hours and excludes future timestamps.",
          "Leave the variable empty to use tournament form without news. A failed, timed-out or invalid feed also falls back to form. Choose and verify the editorial source yourself: structural validation does not establish accuracy. Headline text is supplied as source material, not as instructions."
        ],
        "code": "[{\"title\":\"Your verified headline\",\"url\":\"https://example.com/source\",\"publishedAt\":\"<current ISO-8601 publication timestamp>\"}]"
      },
      {
        "id": "read-api",
        "title": "Read commentary and momentum",
        "paragraphs": [
          "The backend exposes commentary lines and archived momentum samples for Cup match IDs 0 to 62. Commentary responses support ETags; clients can send If-None-Match and handle 304 without downloading the same lines again.",
          "Preview lines use eventType=preview and minute=0; the app labels them PRE. Post-match verdicts use eventType=review and minute=60. Stable event IDs prevent duplicate exchanges on retries. A missing preview is not recreated after kickoff."
        ],
        "code": "GET /api/cup/matches/:id/commentary\nGET /api/cup/matches/:id/momentum"
      }
    ]
  },
  { slug: "contracts", title: "Smart contracts", description: "The onchain components and where to verify them.", group: "Developers", readTime: "4 min", sections: [
    { id: "network", title: "Network", paragraphs: ["The current public build runs on Base Sepolia. Confirm the network and active addresses in the app before sending any transaction. The backend and frontend each carry deployment configuration, which can change between releases."] },
    { id: "components", title: "Core components", paragraphs: ["SeasonRegistry defines the fixture schedule and records settlement state. PriceOracle accepts price snapshots. ResultEngine derives scorelines and outcomes. PredictionPool holds TICK stakes, settles pools and handles claims. TeamRegistry and TickToken support team metadata and the staking token."], bullets: ["SeasonRegistry — fixtures and season state", "PriceOracle — submitted prices", "ResultEngine — match scoring", "PredictionPool — stakes, fees, claims and refunds", "TickToken — TICK balances"] },
    { id: "addresses", title: "Essential Base Sepolia addresses", paragraphs: ["These addresses match the checked-in frontend and backend deployment examples. Only contracts needed to trace the token, prices, result calculation and fixture payouts are listed here. The active app configuration is the final reference before a transaction."], links: [
      { label: "TICK token", address: "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b", description: "Token used for fixture staking and claims" },
      { label: "PriceOracle", address: "0x2814bd64f7774eccd5dc11a792f15fecdfebdf90", description: "Kickoff and end price submissions" },
      { label: "ResultEngine", address: "0x82e00f543ddf320eec4447fd16810852bda4ec12", description: "Official score and outcome computation" },
      { label: "PredictionPool", address: "0xc47358e69d145f94728796a337ec14401641700f", description: "Fixture stakes, settlement, payouts and void claims" }
    ] },
    { id: "verify", title: "Verifying a result", paragraphs: ["Start at the fixture page and note the fixture ID and chain. Open the relevant verified contract on the chain explorer, inspect its recorded prices and settlement events, then compare the contract result with the app's final score."] }
  ] },
  { slug: "api", title: "Read API", description: "Public backend endpoints for fixtures, teams and prices.", group: "Developers", readTime: "4 min", sections: [
    { id: "endpoints", title: "Endpoints", paragraphs: ["The frontend uses a backend read API. These endpoints are useful for building read-only views; responses and availability may evolve while Tickr is on testnet."], code: "GET /api/cup/matches/:id/commentary\nGET /api/cup/matches/:id/momentum\nGET /api/teams\nGET /api/fixtures\nGET /api/fixtures/:id\nGET /api/fixtures/:id/pool\nGET /api/table\nGET /api/prices\nGET /api/price-history/:symbol" },
    { id: "behavior", title: "Reading data responsibly", paragraphs: ["Fixture and price responses are cached for short periods. Use the chain as the authority for final settlement and claims; API data is a convenient projection for interfaces. Avoid polling more often than the data changes."] }
  ] },
];

export const groups = ["Start here", "The game", "Prices & trust", "Developers"];
export function getDoc(slug: string) { return docs.find((doc) => doc.slug === slug); }
