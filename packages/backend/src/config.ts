/**
 * TICKR backend configuration — single source of truth for env.
 *
 * Copy `packages/backend/.env.example` to `.env` and fill in the secrets.
 * Fails fast on missing required values so misconfiguration never runs silent.
 */
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the package env file from this module instead of process.cwd().
// This keeps `pnpm --filter @tickr/backend start` and `node
// packages/backend/dist/index.js` behaving identically when launched from
// either the workspace root or packages/backend.
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`[config] Missing required env var: ${name} (see .env.example)`);
  }
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = optional(name, String(fallback));
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`[config] Env var ${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

function optionalBigInt(name: string, fallback: string): bigint {
  const raw = optional(name, fallback);
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`[config] Env var ${name} must be an integer, got: ${raw}`);
  }
}

export const config = {
  port: optionalInt("PORT", 4000),
  corsOrigins: optional("CORS_ORIGIN", "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  chainEnv: optional("TICKR_CHAIN_ENV", "testnet") as "testnet" | "mainnet",
  baseSepoliaRpcUrl: optional("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org"),
  baseMainnetRpcUrl: optional("BASE_MAINNET_RPC_URL", "https://mainnet.base.org"),

  /** Private key of the wallet authorized for PriceOracle submissions + revealKickoff. */
  backendSignerPrivateKey: required("BACKEND_SIGNER_PRIVATE_KEY") as `0x${string}`,

  seasonId: BigInt(optional("SEASON_ID", "1")),

  contracts: {
    tickToken: optional(
      "TICK_TOKEN_ADDRESS",
      "0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b"
    ) as `0x${string}`,
    playerStats: optional(
      "PLAYER_STATS_ADDRESS",
      "0x6c6A1e8AA000527FdA6DEC9Ef3b9Cf77C37C650E"
    ) as `0x${string}`,
    priceOracle: optional(
      "PRICE_ORACLE_ADDRESS",
      "0x8915F4919F6a2031A6aba16D9AAe639BE209b23b"
    ) as `0x${string}`,
    seasonRegistry: optional(
      "SEASON_REGISTRY_ADDRESS",
      "0x38d5C94d2BAB4a40D9663c2042e7ea02388Fc6ab"
    ) as `0x${string}`,
    teamRegistrySeason1: optional(
      "TEAM_REGISTRY_S1_ADDRESS",
      "0xCeF503a73d507Fead4bB090537E884C76692B6eF"
    ) as `0x${string}`,
    matchRegistrySeason1: optional(
      "MATCH_REGISTRY_S1_ADDRESS",
      "0xf7954389d44B2DB3540A53331C1BAf08b70Ca1D6"
    ) as `0x${string}`,
    predictionPool: optional(
      "PREDICTION_POOL_ADDRESS",
      "0x70deB4Cc3002813cEC623d4E289186f2949e7DA0"
    ) as `0x${string}`,
    resultEngine: optional(
      "RESULT_ENGINE_ADDRESS",
      "0xFA974C6ee13F2D38C6a7C56aaF595DB1352730bc"
    ) as `0x${string}`,
    /** v0.2: MarketFactory. Empty default — fill after the v0.2 redeploy. */
    marketFactory: optional(
      "MARKET_FACTORY_ADDRESS",
      "0xb61933b364E65201Ac01C64f51aa29c51b8F5ed2"
    ) as `0x${string}`,
  },

  binance: {
    /** Primary WS host: market-data-only mirror, no geo-block. */
    primaryWsHost: optional("BINANCE_WS_PRIMARY_HOST", "wss://data-stream.binance.vision"),
    /** Fallback WS host if the primary refuses the connection. */
    fallbackWsHost: optional("BINANCE_WS_FALLBACK_HOST", "wss://stream.binance.com:9443"),
    /** REST ticker poll — covers for the WS feed when it can't connect. */
    restBaseUrl: optional("BINANCE_REST_BASE_URL", "https://data-api.binance.vision"),
    restPollMs: optionalInt("BINANCE_REST_POLL_MS", 10_000),
  },

  coingecko: {
    apiKey: optional("COINGECKO_API_KEY", ""),
    baseUrl: optional("COINGECKO_BASE_URL", "https://api.coingecko.com/api/v3"),
    /** Fallback price poll cadence. 5 min ≈ 288 calls/day, inside the 10k/month Demo budget. */
    pollIntervalMs: 5 * 60 * 1000,
  },

  leagues: {
    /**
     * Main league config. v0.2: 60-minute matches (was 20). The contract's
     * matchDurationSeconds is the on-chain source of truth — this must stay
     * in sync with it (the deploy module takes matchDurationSeconds as a
     * parameter, default 3600).
     */
    main: {
      id: "main",
      matchDurationMinutes: optionalInt("MAIN_LEAGUE_MATCH_DURATION_MINUTES", 60),
    },
  },

  kickoff: {
    /**
     * How far ahead of kickoff the reveal tx is sent. Must stay within the
     * contract's 30–120 min lead-time bounds.
     *
     * v0.2 — staggered prime-time kickoff clusters: instead of revealing a
     * whole matchday at once, fixtures are revealed in clusters spread
     * across the window (STAGGER_SLOT_MINUTES apart, up to
     * STAGGER_MAX_SLOTS clusters). Kickoff times are staggered so matches
     * don't all start/end simultaneously — better UX, steadier oracle load.
     */
    leadMinutes: optionalInt("KICKOFF_LEAD_MINUTES", 60),
    /** How often the lifecycle loop runs. */
    tickIntervalMs: 30_000,
    /** Minutes between staggered kickoff clusters within a matchday window. */
    staggerSlotMinutes: optionalInt("KICKOFF_STAGGER_SLOT_MINUTES", 30),
    /** Max kickoff clusters per matchday (extra fixtures share the last slot). */
    staggerMaxSlots: optionalInt("KICKOFF_STAGGER_MAX_SLOTS", 5),
  },

  /**
   * v0.2 — hourly oracle checkpoint submitter. Submits PriceOracle
   * checkpoints (one price per team per hour) that power MarketFactory
   * resolution (TOP_GAINER, H2H, TARGET templates) and the transparency
   * views. Retention is 720h (30 days); the submitter runs every
   * CHECKPOINT_INTERVAL_MINUTES and is idempotent (skips hours already
   * checkpointed).
   */
  checkpoints: {
    intervalMinutes: optionalInt("CHECKPOINT_INTERVAL_MINUTES", 60),
    /** Max teams per submitCheckpoints tx (gas-bounded). */
    batchSize: optionalInt("CHECKPOINT_BATCH_SIZE", 20),
  },

  /**
   * v0.2 — MarketFactory keeper. resolve() is permissionless (anyone may
   * call and earn the resolver bounty), but a keeper guarantees markets
   * resolve even when no bounty hunter shows up. Runs every
   * KEEPER_INTERVAL_MINUTES and resolves any open market past its endTime
   * whose data is available.
   */
  factoryKeeper: {
    enabled: optional("FACTORY_KEEPER_ENABLED", "true") === "true",
    intervalMinutes: optionalInt("FACTORY_KEEPER_INTERVAL_MINUTES", 15),
    /** Max markets to attempt per keeper pass (gas-bounded). */
    maxPerPass: optionalInt("FACTORY_KEEPER_MAX_PER_PASS", 10),
  },

  priceValidation: {
    /** Max allowed |binance − coingecko| / coingecko deviation, in basis points (200 = 2%). */
    maxDeviationBps: optionalInt("PRICE_DEVIATION_MAX_BPS", 200),
    /** A Binance price older than this is treated as stale (miniTicker ticks every 1s). */
    binanceStaleAfterMs: 65_000,
    /** A CoinGecko price older than this is treated as stale. */
    coingeckoStaleAfterMs: 10 * 60 * 1000,
  },

  leaderboard: {
    /**
     * First block scanned for PlayerStats.OutcomeRecorded events.
     * Base Sepolia's public RPC caps eth_getLogs at 1,000 blocks per call,
     * so the reader pages through history in chunks starting here.
     * Set this to the PlayerStats deployment block in production to skip
     * empty history. 0 = genesis (correct but slower on the very first
     * scan; the watermark makes every later scan cheap).
     */
    // Current Season 1 deployment block. Override this for a new deployment.
    scanStartBlock: optionalBigInt("LEADERBOARD_SCAN_START_BLOCK", "47283463"),
  },
} as const;

export type AppConfig = typeof config;
