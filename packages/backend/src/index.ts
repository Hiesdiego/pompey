/**
 * TICKR backend — Phase 2 engine entrypoint.
 *
 * Boot order:
 *   1. config (fails fast on missing env)
 *   2. price feeds: Binance WebSocket (primary) + CoinGecko poller (fallback/meta)
 *   3. price validator/aggregator
 *   4. snapshot submitter (backend signer + serialized tx queue)
 *   5. match lifecycle (kickoff monitor + match timer)
 *   6. REST API + live WebSocket server
 *
 * Copy packages/backend/.env.example → .env and fill in the secrets first.
 */
import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { TICKR_TEAMS } from "@tickr/shared";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { BinanceWsFeed } from "./services/binanceWs.js";
import { BinanceRestPoller } from "./services/binanceRest.js";
import { CoingeckoPoller } from "./services/coingecko.js";
import { PriceFeed, type TeamPriceMap } from "./services/priceFeed.js";
import { SnapshotSubmitter } from "./services/snapshotSubmitter.js";
import { MatchLifecycle } from "./services/matchLifecycle.js";
import { ChainReader } from "./api/readClient.js";
import { buildRouter } from "./api/routes.js";
import { LiveWsServer } from "./api/wsServer.js";

async function main(): Promise<void> {
  logger.info("[backend] booting TICKR Phase 2 engine", {
    chainEnv: config.chainEnv,
    seasonId: config.seasonId.toString(),
    matchDurationMin: config.leagues.main.matchDurationMinutes,
  });

  // --- price feeds -------------------------------------------------------
  const teamMaps: TeamPriceMap[] = TICKR_TEAMS.map((t) => ({
    teamId: t.teamId,
    binanceSymbol: t.binanceSymbol,
    coingeckoId: t.coingeckoId,
  }));

  const binanceWs = new BinanceWsFeed(
    teamMaps.map((t) => t.binanceSymbol),
    config.binance.primaryWsHost,
    config.binance.fallbackWsHost
  );
  // REST poller covers for the WS feed when it can't connect (geo-block,
  // firewall). Paused while the WS is healthy, resumed the moment it drops.
  const binanceRest = new BinanceRestPoller(
    teamMaps.map((t) => t.binanceSymbol),
    config.binance.restBaseUrl,
    config.binance.restPollMs
  );
  const coingecko = new CoingeckoPoller(
    teamMaps.map((t) => t.coingeckoId),
    config.coingecko.baseUrl,
    config.coingecko.apiKey
  );
  // WS + REST count as ONE logical Binance source — freshest tick wins.
  const priceFeed = new PriceFeed([binanceWs, binanceRest], coingecko, teamMaps, {
    maxDeviationBps: config.priceValidation.maxDeviationBps,
    binanceStaleAfterMs: config.priceValidation.binanceStaleAfterMs,
    coingeckoStaleAfterMs: config.priceValidation.coingeckoStaleAfterMs,
  });

  binanceWs.on("status", (status, detail) => {
    logger.info("[backend] binance WS feed status", { status, detail });
    if (status === "connected") binanceRest.pause();
    else binanceRest.resume();
  });
  binanceRest.on("status", (status, detail) =>
    logger.info("[backend] binance REST poller status", { status, detail })
  );
  coingecko.on("error", (err) =>
    logger.warn("[backend] coingecko poller error", { error: err.message })
  );

  binanceWs.start();
  binanceRest.start();
  coingecko.start();

  // --- chain writers -----------------------------------------------------
  const submitter = new SnapshotSubmitter();
  const lifecycle = new MatchLifecycle(priceFeed, submitter);
  const reader = new ChainReader();

  // --- HTTP + WS ----------------------------------------------------------
  const app = express();
  app.use(express.json());
  app.use(buildRouter({ reader, lifecycle, priceFeed, coingecko, binance: binanceWs }));

  const httpServer = createServer(app);
  const liveWs = new LiveWsServer(priceFeed, lifecycle);
  liveWs.attach(httpServer, "/ws");

  // Lifecycle starts after the server is listening so the API is up first.
  httpServer.listen(config.port, async () => {
    logger.info(`[backend] listening on :${config.port}`);
    try {
      await lifecycle.start();
    } catch (err) {
      logger.error("[backend] lifecycle failed to start", { error: String(err) });
    }
  });

  // --- graceful shutdown ---------------------------------------------------
  const shutdown = (signal: string) => {
    logger.info("[backend] shutting down", { signal });
    liveWs.stop();
    lifecycle.stop();
    binanceWs.stop();
    binanceRest.stop();
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
