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
      "0x9284ae11bFA0616177462D149fF3C6E803053FED"
    ) as `0x${string}`,
    playerStats: optional(
      "PLAYER_STATS_ADDRESS",
      "0x7bEE9463A80Db25528548981a6FecfEC4942E789"
    ) as `0x${string}`,
    priceOracle: optional(
      "PRICE_ORACLE_ADDRESS",
      "0xC439Fc957041990E3CEBC7e327d4a135450A5DB6"
    ) as `0x${string}`,
    seasonRegistry: optional(
      "SEASON_REGISTRY_ADDRESS",
      "0x9150456181e1EcAD4989e6A4aEAFaD6af184f0B6"
    ) as `0x${string}`,
    teamRegistrySeason1: optional(
      "TEAM_REGISTRY_S1_ADDRESS",
      "0x5090FD25f46791a217153C3b10Cc0d850CEbA756"
    ) as `0x${string}`,
    matchRegistrySeason1: optional(
      "MATCH_REGISTRY_S1_ADDRESS",
      "0x08F2929F2BA4a60c2b5485b4CC2c1881dE7C903c"
    ) as `0x${string}`,
    predictionPool: optional(
      "PREDICTION_POOL_ADDRESS",
      "0x008d64439DD189480EDc9b74983db6D87fD8F48A"
    ) as `0x${string}`,
    resultEngine: optional(
      "RESULT_ENGINE_ADDRESS",
      "0xA02Be4BDb0FF7E774FA3CFAa8D879bDbd06AF5D6"
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
    /** Main league config. Duration is backend-side only — the contracts never enforce it. */
    main: {
      id: "main",
      matchDurationMinutes: optionalInt("MAIN_LEAGUE_MATCH_DURATION_MINUTES", 20),
    },
  },

  kickoff: {
    /**
     * How far ahead of kickoff the reveal tx is sent. Must stay within the
     * contract's 30–120 min lead-time bounds. All of a matchday's fixtures
     * are revealed in the same monitor pass → they kick off together,
     * like a real football matchday.
     */
    leadMinutes: optionalInt("KICKOFF_LEAD_MINUTES", 60),
    /** How often the lifecycle loop runs. */
    tickIntervalMs: 30_000,
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
