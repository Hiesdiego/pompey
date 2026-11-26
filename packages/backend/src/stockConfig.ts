/**
 * TICKR Stock League, backend configuration (STOCK_* env).
 *
 * Intended destination: packages/backend/src/stockConfig.ts (new file,
 * alongside the crypto config.ts). It deliberately does NOT import the
 * crypto config: the stock league is a parallel league with its own
 * contracts, its own season id, and its own env names, so a stock-only
 * misconfiguration must never be masked by crypto defaults, and a crypto
 * misconfiguration must never take the stock loop down with it.
 *
 * Copy packages/backend/.env.example to .env and fill in the STOCK_*
 * values. Contract addresses are OPTIONAL with empty defaults (unlike the
 * crypto config, which fails fast): the stock services stay idle until the
 * stock contracts are deployed, exactly like the cup's optional addresses.
 * The only value that fails fast is the backend signer key, and only when
 * a stock SUBMITTER is constructed (read-only services never need it).
 *
 * LOCKED SEASON, 12-TEAM REVISION (user decision 2026-11-18, revises the
 * 22-team season locked 2026-11-16):
 *   12 teams, double round-robin (home and away), 22 rounds, 6 fixtures
 *   per round, 132 fixtures, Nov 26 to Dec 16 2026, 1-hour matches
 *   staggered randomly, a matchday (round) lasts 1 day, all matches end
 *   the same day as the crypto league. Nov 26 to Dec 16 inclusive is 21
 *   days, so 22 rounds need ONE double-header day: the Dec 16 finale
 *   hosts rounds 21 and 22 (matchdayIndex 20 and 21) in two waves,
 *   morning and evening, 12 fixtures that day. The backend lifecycle
 *   groups fixtures by matchdayIndex, so two rounds sharing one calendar
 *   day need no special case beyond the overlap guard in
 *   stockMatchLifecycle.ts; the on-chain schedule MUST give the two
 *   finale rounds separate windows (morning wave and evening wave) so
 *   their kickoff slots cannot collide.
 *
 * FRESH CONTRACTS, READ THIS BEFORE DEPLOYING:
 *   The deployed 22-team StockMatchRegistry
 *   0xc3a04de16ec15947d39ac1c27914c67e480ba019 already has fixtureCount
 *   231 for the 22-team season and CANNOT be reused for the 12-team
 *   season. The redo path is a FRESH StockTeamRegistry (12 teams) plus a
 *   FRESH StockMatchRegistry, then generate the 22-round schedule and
 *   seed. The backend reads every stock contract address from STOCK_*
 *   env vars (fresh addresses to be filled in after deploy) and NEVER
 *   hardcodes a registry address. Do not point STOCK_* at the old
 *   231-fixture registry: the lifecycle would load 231 fixtures for 22
 *   teams that no longer exist.
 *
 * SCORING (locked 2026-11-16, unchanged by the 12-team revision):
 *   1 goal = 0.05% (5 bps), half-up rounding, no-negative scorelines
 *   exactly like crypto, max 10 goals per team per match, raw volatile
 *   cap 3% (300 bps). Crypto uses 50 bps per goal (PriceOracle
 *   BPS_PER_GOAL = 50); the stock contracts MUST be deployed with
 *   BPS_PER_GOAL = 5. The backend does not compute goals (the stock
 *   ResultEngine does, from the snapshots); these constants exist here so
 *   the API, the circuit-breaker review, and the docs all agree.
 *
 * PRICE FEED (locked):
 *   Chainlink NAV primary via the Base Tokenized Stocks API
 *   (https://api.coinbase.com/v1/tokenized-stocks, no key, verified live
 *   2026-11-18: all 12 roster teams carry a nav_price). Dinari is
 *   VERIFIED NOT worthy as a drop-in fallback: rows exist for all
 *   tickers, but the Dinari API is enterprise/key-gated, not a free
 *   public feed, so it is NEVER used automatically. A Dinari tier only
 *   activates when DINARI_API_KEY_ID is supplied by the user AND a
 *   Dinari client is wired in (see stockPriceFeed.ts). CoinGecko is last
 *   resort only when it has a price for the ticker, otherwise the snapshot
 *   is BLOCKED like crypto, never silently fallen back.
 *
 * LAST-NAV FALLBACK (user approved 2026-11-18, see stockPriceFeed.ts):
 *   When the feed is healthy but quiet, the last NAV within the 24h
 *   heartbeat is accepted as the end price instead of forfeiting. Bound:
 *   lastNavFallbackMaxAgeMs (24h) measured at full-time, only when the
 *   poller is healthy, only when the last NAV was published before
 *   kickoff, and never for a team with no NAV at all. Every use is
 *   logged. It does NOT fix teams with no NAV at all, which is why the
 *   roster shrank from 22 to 12.
 *
 * BANDWIDTH (hard cap 1 GB/month, user instruction 2026-11-16):
 *   NAV polling follows the same hot/idle discipline as the crypto feeds.
 *   The list endpoint returns ALL tokens in ONE call (page_size 500), so
 *   one poll covers all 12 teams: hot 60s cadence only inside the daily
 *   hot window (30 min before first kickoff to last full-time + 15 min),
 *   idle 15 min cadence otherwise. Never poll NAV every 60s all day.
 *   RPC reads go through the shared fallback transport in
 *   stockSnapshotSubmitter.ts (createStockPublicClient), never a
 *   single-endpoint client. NOTE: the repo has no
 *   packages/backend/src/lib/rpc.ts, lib/loop.ts, lib/net.ts or
 *   lib/outboundMeter.ts despite the build brief naming them; the fallback
 *   transport and the outbound meter live in the stock files themselves
 *   until the repo gains shared versions.
 */

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = optional(name, String(fallback));
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`[stockConfig] Env var ${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const value = optional(name, fallback ? "true" : "false").toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`[stockConfig] Env var ${name} must be true or false, got: ${value}`);
}

const DEFAULT_MARKET_HOLIDAYS: readonly string[] = [
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
];

function optionalAddress(name: string): `0x${string}` {
  const v = optional(name, "");
  if (v === "") return "" as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`[stockConfig] Env var ${name} must be a 0x address, got: ${v}`);
  }
  return v as `0x${string}`;
}

export const stockConfig = {
  /** Same chain env as crypto: the stock contracts deploy on Base Sepolia
   *  for the build, even though the B20 tokens themselves live on Base
   *  mainnet. The NAV API is chain-agnostic reference data. */
  chainEnv: optional("TICKR_CHAIN_ENV", "testnet") as "testnet" | "mainnet",
  baseSepoliaRpcUrl: optional("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org"),
  baseMainnetRpcUrl: optional("BASE_MAINNET_RPC_URL", "https://mainnet.base.org"),
  /** Extra RPC endpoints for the fallback transport, comma-separated.
   *  Used ONLY when the primary RPC fails; never round-robined per call. */
  rpcFallbackUrls: optional("STOCK_RPC_FALLBACK_URLS", "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean),

  /** Backend signer key. Read here (not from the crypto config) so the
   *  stock submitter fails fast on its own if the key is missing. Only
   *  accessed when a StockSnapshotSubmitter is constructed. */
  backendSignerPrivateKey: optional("BACKEND_SIGNER_PRIVATE_KEY", "") as `0x${string}`,

  /** Stock season id. Crypto Season 2 is seasonId 2; the stock league is
   *  a PARALLEL league, so it gets its own id space starting at 1. The
   *  stock contracts are fresh deployments (one-time setters force a full
   *  fresh stack, cup-style), so this must match the deployed
   *  SeasonRegistry, not the crypto season. */
  seasonId: BigInt(optional("STOCK_SEASON_ID", "1")),

  contracts: {
    teamRegistry: optionalAddress("STOCK_TEAM_REGISTRY_ADDRESS"),
    matchRegistry: optionalAddress("STOCK_MATCH_REGISTRY_ADDRESS"),
    priceOracle: optionalAddress("STOCK_PRICE_ORACLE_ADDRESS"),
    resultEngine: optionalAddress("STOCK_RESULT_ENGINE_ADDRESS"),
    predictionPool: optionalAddress("STOCK_PREDICTION_POOL_ADDRESS"),
    /** Crypto PlayerStats address, read-only, for the unified-TP
     *  aggregator. The stock pool CANNOT write to it (its
     *  setPredictionPool is one-time and already set to the crypto pool),
     *  so this is used for event scans only, never for writes. */
    cryptoPlayerStats: optionalAddress("PLAYER_STATS_ADDRESS"),
    /** Crypto prediction pool, read-only, for the unified-TP aggregator. */
    cryptoPredictionPool: optionalAddress("PREDICTION_POOL_ADDRESS"),
  },

  /** Coinbase onchain oracle registry (multiplier + pause flag), verified
   *  against docs.base.org 2026-11-16. Read-only; the NAV poller does not
   *  need it (the API returns the multiplier), but the stock contracts
   *  and any onchain verification do. */
  oracleRegistry: "0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD" as `0x${string}`,

  /** Locked season window (UTC). 22 rounds, Nov 26 to Dec 16 2026.
   *  Dec 16 is the double-header finale: rounds 21 and 22
   *  (matchdayIndex 20 and 21) share that calendar day in two waves. */
  season: {
    startDate: optional("STOCK_SEASON_START_DATE", "2026-11-26"),
    endDate: optional("STOCK_SEASON_END_DATE", "2026-12-16"),
    teamCount: 12,
    matchdays: 22,
    fixturesPerMatchday: 6,
    totalFixtures: 132,
    /** Calendar day of the double-header finale (UTC date). */
    doubleHeaderDate: optional("STOCK_DOUBLE_HEADER_DATE", "2026-12-16"),
    /** matchdayIndex values that share the double-header day (0-based:
     *  round 21 is index 20, round 22 is index 21). */
    doubleHeaderMatchdays: [20, 21],
  },

  /** 1-hour matches, like crypto. Backend config, NOT on-chain: the
   *  contract's matchDurationSeconds is the on-chain source of truth and
   *  this must stay in sync with it. */
  matchDurationMinutes: optionalInt("STOCK_MATCH_DURATION_MINUTES", 60),

  kickoff: {
    /** Reveal lead bounds enforced on-chain (same as crypto): kickoff
     *  must land 30-120 min after the reveal tx. */
    leadMinutes: optionalInt("STOCK_KICKOFF_LEAD_MINUTES", 60),
    minLeadMinutes: 30,
    maxLeadMinutes: 120,
    /** Kickoff slots are absolute times inside the fixture window (see
     *  stockMatchLifecycle.ts stockKickoffSlotMs): each round's 6
     *  fixtures are spread evenly across the usable window and snapped
     *  to this grid. A restart re-derives the same slots. */
    slotGridMinutes: optionalInt("STOCK_KICKOFF_SLOT_GRID_MINUTES", 15),
    /** Usable window starts this long after windowStart. */
    slotStartPadMinutes: optionalInt("STOCK_KICKOFF_SLOT_START_PAD_MINUTES", 30),
    /** Usable window ends this long before the last legal kickoff
     *  (windowEnd minus match duration minus this pad). */
    slotEndPadMinutes: optionalInt("STOCK_KICKOFF_SLOT_END_PAD_MINUTES", 60),
    /** Weekday session window (user instruction 2026-11-26): on Monday
     *  to Friday matchdays the kickoff slots are NOT spread across the
     *  whole 24h window. Matches played while the US market is shut
     *  finish 0-0 because the NAV barely moves (the Nov 26 opener kicked
     *  off 02:15 UTC and ended 0-0), so weekday slots are confined to
     *  the US session. The bounds are minutes after windowStart
     *  (matchday windows start at 00:00 UTC, so they read as UTC times
     *  of day): 14:15 to 20:15 with the lifecycle's centre formula
     *  gives six hourly kickoffs at 14:45 to 19:45 UTC, every match
     *  inside the 14:30 to 21:00 UTC regular session. Weekend matchdays
     *  keep the full-window spread: the market is shut all day, so
     *  staggering cannot help them this season. US market holidays are
     *  NOT modelled: a holiday weekday still gets session slots. */
    weekdaySessionStartMinutes: optionalInt("STOCK_KICKOFF_SESSION_START_MINUTES", 14 * 60 + 15),
    weekdaySessionEndMinutes: optionalInt("STOCK_KICKOFF_SESSION_END_MINUTES", 20 * 60 + 15),
  },

  marketCalendar: {
    skipNonTradingDays: optionalBool("STOCK_SKIP_NON_TRADING_DAYS", true),
    holidays: (() => {
      const parsed = optional("STOCK_MARKET_HOLIDAYS", "")
        .split(",")
        .map((date) => date.trim())
        .filter(Boolean);
      return parsed.length > 0 ? parsed : [...DEFAULT_MARKET_HOLIDAYS];
    })(),
  },

  nav: {
    /** Base Tokenized Stocks API. Read-only, no key. Verified live
     *  2026-11-18: GET / returns { tokens: [...] } with nav_price,
     *  nav_price_updated_at, multiplier, isin, contract_address, and
     *  all 12 roster teams carry a nav_price. */
    baseUrl: optional("STOCK_NAV_API_URL", "https://api.coinbase.com/v1/tokenized-stocks"),
    /** Hot cadence: one list call covers all 12 teams. Only inside the
     *  daily hot window (30 min before first kickoff to last FT + 15 min).
     *  Chainlink equity feeds update on 0.5% deviation or a 24h heartbeat,
     *  so polling faster than 60s is pure waste. */
    hotPollMs: optionalInt("STOCK_NAV_HOT_POLL_MS", 60_000),
    /** Idle cadence: outside the hot window. Keeps the 1 GB/month budget
     *  intact while still noticing a fresh NAV the next morning. */
    idlePollMs: optionalInt("STOCK_NAV_IDLE_POLL_MS", 15 * 60_000),
    /** A NAV tick older than this is stale for pricing (24h Chainlink
     *  heartbeat + 1h tolerance). A stale NAV blocks the snapshot; it is
     *  never silently replaced by another source. */
    staleAfterMs: optionalInt("STOCK_NAV_STALE_AFTER_MS", 25 * 60 * 60_000),
    /** Max allowed deviation between NAV and a fresh CoinGecko price
     *  (200 bps = 2%, same as crypto). Beyond this the price is REJECTED. */
    maxDeviationBps: optionalInt("STOCK_PRICE_DEVIATION_MAX_BPS", 200),
    /** Forfeit grace: after full-time, a NAV published up to this long
     *  after FT still counts as performance for the match window. */
    forfeitGraceMs: optionalInt("STOCK_FORFEIT_GRACE_MS", 60 * 60_000),
    /** LAST-NAV FALLBACK bound (user approved 2026-11-18): the last NAV
     *  is accepted as the end price only when it is no older than this
     *  at full-time (24h Chainlink heartbeat) AND the feed is healthy
     *  AND the NAV was published before kickoff. A team with no NAV at
     *  all is never covered by this fallback. See stockPriceFeed.ts. */
    lastNavFallbackMaxAgeMs: optionalInt("STOCK_LAST_NAV_FALLBACK_MAX_AGE_MS", 24 * 60 * 60_000),
    /** Feed-health window for the last-NAV fallback: the poller's last
     *  successful poll must be within this long, otherwise the feed is
     *  treated as unhealthy and the fallback does NOT apply (an outage
     *  must never be mistaken for a quiet feed). Idle cadence is 15 min,
     *  so 30 min tolerates one missed idle poll. */
    feedHealthyWithinMs: optionalInt("STOCK_NAV_FEED_HEALTHY_WITHIN_MS", 30 * 60_000),
  },

  /** Dinari fallback is GATED, not automatic. Empty = no Dinari tier at
   *  all (the verified state: Dinari API is enterprise/key-gated, not a
   *  free public feed). A key alone does not enable it: a Dinari client
   *  must also be wired into StockPriceFeed (see stockPriceFeed.ts). */
  dinari: {
    apiKeyId: optional("DINARI_API_KEY_ID", ""),
  },

  coingecko: {
    apiKey: optional("COINGECKO_API_KEY", ""),
    baseUrl: optional("COINGECKO_BASE_URL", "https://api.coingecko.com/api/v3"),
    /** A CoinGecko price older than this is stale (5-min poll cadence). */
    staleAfterMs: 10 * 60 * 1000,
  },

  checkpoints: {
    intervalMinutes: optionalInt("STOCK_CHECKPOINT_INTERVAL_MINUTES", 60),
    /** Max teams per submitCheckpoints tx (gas-bounded). 12 teams = 1 tx. */
    batchSize: optionalInt("STOCK_CHECKPOINT_BATCH_SIZE", 20),
  },

  /** Scoring constants (locked 2026-11-16). Mirrored here for the API and
   *  the circuit-breaker review; the stock ResultEngine is the authority
   *  on-chain and must be deployed with BPS_PER_GOAL = 5. */
  scoring: {
    /** 1 goal = 0.05% = 5 bps (crypto: 50 bps). */
    bpsPerGoal: 5,
    /** Max goals per team per match. A raw move beyond this still scores 10. */
    maxGoalsPerTeam: 10,
    /** Raw volatile cap: a single-team move beyond 3% (300 bps) is capped
     *  at the 10-goal cap AND flagged for circuit-breaker review. */
    rawVolatileCapBps: 300,
    /** +/-30% raw price spike by either team inside the match window
     *  triggers circuit-breaker review: the scoreline is ignored and the
     *  fixture is flagged, never settled on a spike. */
    circuitBreakerBps: 3000,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
  },

  leaderboard: {
    /** First block scanned for OutcomeRecorded / pool events. Base
     *  Sepolia's public RPC caps eth_getLogs at 1,000 blocks per call, so
     *  scans page in 900-block chunks with a watermark. Set to the stock
     *  deployment block once deployed; 0 = genesis (correct, slower). */
    scanStartBlock: BigInt(optional("STOCK_LEADERBOARD_SCAN_START_BLOCK", "0")),
  },

  /** Soft monthly outbound budget guard (bandwidth hard cap 1 GB/month).
   *  The meter counts calls and bytes; breaching the soft cap logs at
   *  ERROR but never blocks a snapshot (a blocked snapshot would lock
   *  stakers' funds; the guard is for ops visibility, not a kill switch). */
  meter: {
    navCallsPerMonthSoftCap: optionalInt("STOCK_METER_NAV_CALLS_SOFT_CAP", 50_000),
  },
} as const;

export type StockConfig = typeof stockConfig;

/** Why the US market is closed on the UTC date containing `ms`, or null
 *  when it trades. Early closes are treated as trading days. */
export function stockMarketClosureReason(ms: number): "weekend" | "holiday" | null {
  const day = new Date(ms).getUTCDay();
  if (day === 0 || day === 6) return "weekend";
  const date = new Date(ms).toISOString().slice(0, 10);
  return stockConfig.marketCalendar.holidays.includes(date) ? "holiday" : null;
}

/** True only when every stock contract address is configured. Until then
 *  every stock service stays idle (league-only deployment), exactly like
 *  the cup's optional addresses. */
export function stockConfigured(): boolean {
  const c = stockConfig.contracts;
  // Empty-string defaults are falsy; a configured address is truthy.
  // (Compared with Boolean() rather than === "" because the fields are
  // typed `0x${string}`.)
  return (
    Boolean(c.teamRegistry) &&
    Boolean(c.matchRegistry) &&
    Boolean(c.priceOracle) &&
    Boolean(c.resultEngine) &&
    Boolean(c.predictionPool)
  );
}
