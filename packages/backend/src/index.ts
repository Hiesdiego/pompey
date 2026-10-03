/**
 * TICKR backend — Phase 2 engine entrypoint (+ v0.2 services + optimization pass).
 *
 * Boot order:
 *   1. process guards (unhandledRejection / uncaughtException) — first
 *   2. config (fails fast on missing env)
 *   3. price heartbeat (Binance REST: 60s idle / 15s in hot windows) + CoinGecko
 *   4. price validator/aggregator
 *   5. chain cache (the RPC shield) + background odds-history warmer
 *   6. snapshot submitter, match lifecycle, checkpoint submitter, factory keeper
 *   7. social indexer
 *   8. REST API + fixtures WebSocket server
 *
 * Optimization-pass notes:
 * - The 24/7 Binance WebSocket stream is OFF. It moved ~20 msgs/sec
 *   (~8–13 GB/month) for data the backend only needs at submission moments.
 *   Live streaming now happens on each frontend client (direct Binance WS);
 *   the backend polls REST on a heartbeat. The binanceWs / binanceRest
 *   modules are kept in the tree (and still tested) but are not started.
 * - The 5s price broadcast on /ws is gone with it (see api/wsServer.ts).
 * - All background loops run through lib/loop.ts (non-overlapping + backoff).
 * - All chain reads share one resilient transport (lib/rpc.ts); set
 *   FALLBACK_RPC_URL for automatic failover.
 */
import express from "express";
import { createServer } from "node:http";
import { TICKR_TEAMS } from "@tickr/shared";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { installProcessGuards, meter } from "./lib/net.js";
import { getBlockNumberSafe } from "./lib/rpc.js";
import { PriceHeartbeat } from "./services/priceHeartbeat.js";
import { CoingeckoPoller } from "./services/coingecko.js";
import { PriceFeed, type TeamPriceMap } from "./services/priceFeed.js";
import { SnapshotSubmitter } from "./services/snapshotSubmitter.js";
import { MatchLifecycle } from "./services/matchLifecycle.js";
import { CheckpointSubmitter } from "./services/checkpointSubmitter.js";
import { FactoryKeeper } from "./services/factoryKeeper.js";
import { ChainCache } from "./services/chainCache.js";
import { ChainReader } from "./api/readClient.js";
import { buildRouter, type HealthReport } from "./api/routes.js";
import { LiveWsServer } from "./api/wsServer.js";
import { createSocialDb } from "./lib/supabase.js";
import { SocialIndexer } from "./services/socialIndexer.js";

async function main(): Promise<void> {
  // Process-level safety net before anything else can throw.
  installProcessGuards();

  logger.info("[backend] booting TICKR engine (optimized)", {
    chainEnv: config.chainEnv,
    seasonId: config.seasonId.toString(),
    matchDurationMin: config.leagues.main.matchDurationMinutes,
    fallbackRpc: config.fallbackRpcUrl ? "configured" : "not set",
  });

  // --- price feeds -------------------------------------------------------
  const teamMaps: TeamPriceMap[] = TICKR_TEAMS.map((t) => ({
    teamId: t.teamId,
    binanceSymbol: t.binanceSymbol,
    coingeckoId: t.coingeckoId,
  }));

  // Heartbeat, not firehose: the backend only needs prices when it submits
  // (reveals, snapshots, checkpoints). 60s idle / 15s in hot windows.
  // NOTE: the BinanceWsFeed module is intentionally not started anymore —
  // its 24/7 miniTicker stream cost ~8–13 GB/month of backend bandwidth
  // against the 1 GB budget. Frontend clients stream Binance directly now.
  // (lifecycle is assigned below; the closure only runs after boot.)
  let lifecycle!: MatchLifecycle;
  const priceHeartbeat = new PriceHeartbeat(
    teamMaps.map((t) => t.binanceSymbol),
    config.binance.restBaseUrl,
    () => lifecycle.isHotWindow()
  );
  const coingecko = new CoingeckoPoller(
    teamMaps.map((t) => t.coingeckoId),
    config.coingecko.baseUrl,
    config.coingecko.apiKey
  );
  const priceFeed = new PriceFeed([priceHeartbeat], coingecko, teamMaps, {
    maxDeviationBps: config.priceValidation.maxDeviationBps,
    binanceStaleAfterMs: config.priceValidation.binanceStaleAfterMs,
    coingeckoStaleAfterMs: config.priceValidation.coingeckoStaleAfterMs,
  });

  coingecko.on("error", (err) =>
    logger.warn("[backend] coingecko poller error", { error: err.message })
  );

  priceHeartbeat.start();
  coingecko.start();

  // --- chain writers -----------------------------------------------------
  const submitter = new SnapshotSubmitter();
  lifecycle = new MatchLifecycle(priceFeed, submitter);
  const checkpointSubmitter = new CheckpointSubmitter(priceFeed);
  const db = createSocialDb();
  const factoryKeeper = new FactoryKeeper(db);
  const reader = new ChainReader();
  const socialIndexer = new SocialIndexer(db);
  const chainCache = new ChainCache();
  chainCache.startWarmer();

  // --- health assembly ------------------------------------------------------
  const buildHealth = async (): Promise<HealthReport> => {
    const rpcStart = Date.now();
    const latestBlock = await getBlockNumberSafe();
    const rpcLatencyMs = Date.now() - rpcStart;

    const watermark = await socialIndexer.getWatermarkBlock();
    const lagBlocks =
      latestBlock !== null && watermark !== null
        ? Math.max(0, Number(latestBlock - watermark))
        : null;

    const stalenessSec = priceHeartbeat.stalenessSec();

    let supabaseOk = false;
    if (db) {
      try {
        const { error } = await db.from("indexer_state").select("key").limit(1);
        supabaseOk = !error;
      } catch {
        supabaseOk = false;
      }
    }

    const bandwidth = meter.snapshot();
    meter.checkBudget();

    const degraded =
      latestBlock === null ||
      (lagBlocks !== null && lagBlocks > 1_000) ||
      (stalenessSec !== null && stalenessSec > 900);

    return {
      status: degraded ? "degraded" : "ok",
      uptimeSec: Math.round(process.uptime()),
      chainEnv: config.chainEnv,
      seasonId: config.seasonId.toString(),
      signer: "configured",
      subsystems: {
        rpc: { ok: latestBlock !== null, latencyMs: rpcLatencyMs, latestBlock: latestBlock?.toString() ?? null },
        indexer: { ok: lagBlocks === null || lagBlocks <= 1_000, lagBlocks },
        priceFeed: { ok: stalenessSec === null || stalenessSec <= 900, stalenessSec },
        supabase: { ok: !db || supabaseOk, configured: db !== null },
      },
      bandwidth,
    };
  };

  // --- HTTP + WS ----------------------------------------------------------
  const app = express();
  const allowedOrigins = new Set(config.corsOrigins);
  app.use((req, res, next) => {
    const origin = req.header("Origin");
    if (origin && allowedOrigins.has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
    }
    res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json());
  app.use(buildRouter({ reader, lifecycle, priceFeed, coingecko, chainCache, health: buildHealth }));
  // Last resort: a route that throws must never leak a stack or crash.
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      logger.error("[api] unhandled route error", { error: String(err) });
      res
        .status(500)
        .json({ ok: false, code: "INTERNAL", message: "Something hiccuped on our side." });
    }
  );

  const httpServer = createServer(app);
  const liveWs = new LiveWsServer(lifecycle);
  liveWs.attach(httpServer, "/ws");

  // Lifecycle starts after the server is listening so the API is up first.
  httpServer.listen(config.port, async () => {
    logger.info(`[backend] listening on :${config.port}`);
    try {
      await lifecycle.start();
    } catch (err) {
      logger.error("[backend] lifecycle failed to start", { error: String(err) });
    }
    try {
      checkpointSubmitter.start();
    } catch (err) {
      logger.error("[backend] checkpoint submitter failed to start", { error: String(err) });
    }
    try {
      factoryKeeper.start();
    } catch (err) {
      logger.error("[backend] factory keeper failed to start", { error: String(err) });
    }
    try {
      await socialIndexer.start();
    } catch (err) {
      logger.error("[backend] social indexer failed to start", { error: String(err) });
    }
  });

  // --- graceful shutdown ---------------------------------------------------
  const shutdown = (signal: string) => {
    logger.info("[backend] shutting down", { signal });
    liveWs.stop();
    lifecycle.stop();
    checkpointSubmitter.stop();
    factoryKeeper.stop();
    socialIndexer.stop();
    chainCache.stop();
    priceHeartbeat.stop();
    coingecko.stop();
    httpServer.close(() => {
      logger.info("[backend] shutdown complete");
      process.exit(0);
    });
    // Force-exit if something hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("[backend] fatal boot error", { error: String(err) });
  process.exit(1);
});
