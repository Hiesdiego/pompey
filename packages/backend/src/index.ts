























import express from "express";
import { createServer } from "node:http";
import { TICKR_TEAMS } from "@tickr/shared";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { installProcessGuards, meter } from "./lib/net.js";
import { installOutboundMeter } from "./lib/outboundMeter.js";
import { getBlockNumberSafe } from "./lib/rpc.js";
import { PriceHeartbeat } from "./services/priceHeartbeat.js";
import { CoinbasePoller } from "./services/coinbase.js";
import { CoingeckoPoller } from "./services/coingecko.js";
import { PriceFeed, type TeamPriceMap } from "./services/priceFeed.js";
import { SnapshotSubmitter } from "./services/snapshotSubmitter.js";
import { MatchLifecycle } from "./services/matchLifecycle.js";
import { CUP_TEAM_PRICE_MAP } from "./services/cupTeams.js";
import { CupSubmitter } from "./services/cupSubmitter.js";
import { CupLifecycle } from "./services/cupLifecycle.js";
import { CheckpointSubmitter } from "./services/checkpointSubmitter.js";
import { FactoryKeeper } from "./services/factoryKeeper.js";
import { ChainCache } from "./services/chainCache.js";
import { ChainReader } from "./api/readClient.js";
import { buildRouter, type HealthReport } from "./api/routes.js";
import { LiveWsServer } from "./api/wsServer.js";
import { createSocialDb } from "./lib/supabase.js";
import { SocialIndexer } from "./services/socialIndexer.js";

async function main(): Promise<void> {

  installProcessGuards();
  installOutboundMeter();

  logger.info("[backend] booting TICKR engine (optimized)", {
    chainEnv: config.chainEnv,
    seasonId: config.seasonId.toString(),
    matchDurationMin: config.leagues.main.matchDurationMinutes,
    fallbackRpcCount: config.fallbackRpcUrls.length,
  });


  const teamMaps: TeamPriceMap[] = TICKR_TEAMS.map((t) => ({
    teamId: t.teamId,
    coinbasePair: t.coinbasePair ?? "",
    binanceSymbol: t.binanceSymbol,
    coingeckoId: t.coingeckoId,
  }));

  const cupConfigured = config.cup.enabled && Boolean(config.cup.registry);
  if (cupConfigured && (!config.cup.engine || !config.cup.ballot)) {
    throw new Error("[config] CUP_ENGINE_ADDRESS and CUP_BALLOT_ADDRESS are required when the cup is enabled");
  }
  const cupTeamMaps: TeamPriceMap[] = cupConfigured ? CUP_TEAM_PRICE_MAP : [];
  const allTeamMaps = [...teamMaps, ...cupTeamMaps];
  const coinbasePairs = [...new Set(allTeamMaps.map((t) => t.coinbasePair).filter(Boolean))];
  const binanceSymbols = [...new Set(allTeamMaps.map((t) => t.binanceSymbol).filter(Boolean))];
  const coingeckoIds = [...new Set(allTeamMaps.map((t) => t.coingeckoId).filter(Boolean))];







  let lifecycle!: MatchLifecycle;
  const coinbase = new CoinbasePoller(coinbasePairs, config.coinbase.baseUrl, config.coinbase.pollMs);
  const priceHeartbeat = new PriceHeartbeat(
    binanceSymbols,
    config.binance.restBaseUrl,
    () => lifecycle.isHotWindow()
  );
  const coingecko = new CoingeckoPoller(
    coingeckoIds,
    config.coingecko.baseUrl,
    config.coingecko.apiKey
  );
  const priceFeed = new PriceFeed(coinbase, [priceHeartbeat], coingecko, teamMaps, {
    maxDeviationBps: config.priceValidation.maxDeviationBps,
    coinbaseStaleAfterMs: config.priceValidation.coinbaseStaleAfterMs,
    binanceStaleAfterMs: config.priceValidation.binanceStaleAfterMs,
    coingeckoStaleAfterMs: config.priceValidation.coingeckoStaleAfterMs,
  });
  const cupPriceFeed = new PriceFeed(coinbase, [priceHeartbeat], coingecko, cupTeamMaps, {
    maxDeviationBps: config.priceValidation.maxDeviationBps,
    coinbaseStaleAfterMs: config.priceValidation.coinbaseStaleAfterMs,
    binanceStaleAfterMs: config.priceValidation.binanceStaleAfterMs,
    coingeckoStaleAfterMs: config.priceValidation.coingeckoStaleAfterMs,
  });

  coingecko.on("error", (err) =>
    logger.warn("[backend] coingecko poller error", { error: err.message })
  );

  coinbase.start();
  priceHeartbeat.start();
  coingecko.start();


  const submitter = new SnapshotSubmitter();
  lifecycle = new MatchLifecycle(priceFeed, submitter);
  const cupLifecycle = cupConfigured ? new CupLifecycle(cupPriceFeed, new CupSubmitter()) : null;
  const checkpointSubmitter = new CheckpointSubmitter(priceFeed);
  const db = createSocialDb();
  const factoryKeeper = new FactoryKeeper(db);
  const reader = new ChainReader();
  const chainCache = new ChainCache();
  const socialIndexer = new SocialIndexer(db, (marketId) => chainCache.markMarketDirty(marketId));
  chainCache.startWarmer();


  const calculateHealth = async (): Promise<HealthReport> => {
    const rpcStart = Date.now();
    const latestBlock = await getBlockNumberSafe();
    const rpcLatencyMs = Date.now() - rpcStart;

    const watermark = await socialIndexer.getWatermarkBlock();
    const lagBlocks =
      latestBlock !== null && watermark !== null
        ? Math.max(0, Number(latestBlock - watermark))
        : null;

    const feedAges = [coinbase.stalenessSec(), priceHeartbeat.stalenessSec()].filter((age): age is number => age !== null);
    const stalenessSec = feedAges.length > 0 ? Math.min(...feedAges) : null;

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

  let cachedHealth: { at: number; report: HealthReport } | null = null;
  let healthInFlight: Promise<HealthReport> | null = null;
  const buildHealth = async (): Promise<HealthReport> => {
    if (cachedHealth && Date.now() - cachedHealth.at < 30_000) {
      return {
        ...cachedHealth.report,
        uptimeSec: Math.round(process.uptime()),
        bandwidth: meter.snapshot(),
      };
    }
    healthInFlight ??= calculateHealth();
    try {
      const report = await healthInFlight;
      cachedHealth = { at: Date.now(), report };
      return report;
    } finally {
      healthInFlight = null;
    }
  };


  const app = express();
  if (process.env.RENDER === "true") app.set("trust proxy", 1);
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


  httpServer.listen(config.port, async () => {
    logger.info(`[backend] listening on :${config.port}`);
    try {
      await lifecycle.start();
    } catch (err) {
      logger.error("[backend] lifecycle failed to start", { error: String(err) });
    }
    if (cupLifecycle) {
      try {
        await cupLifecycle.start();
      } catch (err) {
        logger.error("[backend] cup lifecycle failed to start", { error: String(err) });
      }
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


  const shutdown = (signal: string) => {
    logger.info("[backend] shutting down", { signal });
    liveWs.stop();
    lifecycle.stop();
    cupLifecycle?.stop();
    checkpointSubmitter.stop();
    factoryKeeper.stop();
    socialIndexer.stop();
    chainCache.stop();
    coinbase.stop();
    priceHeartbeat.stop();
    coingecko.stop();
    httpServer.close(() => {
      logger.info("[backend] shutdown complete");
      process.exit(0);
    });

    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("[backend] fatal boot error", { error: String(err) });
  process.exit(1);
});
