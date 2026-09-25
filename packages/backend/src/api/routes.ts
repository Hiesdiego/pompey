/**
 * REST API (spec P2.7).
 *
 * Endpoints (all JSON):
 *   GET /health                        — liveness + chain + feed status
 *   GET /api/teams                     — 20-team roster + CoinGecko logos
 *   GET /api/fixtures                  — all Season-1 fixtures w/ kickoff state
 *   GET /api/fixtures/:id              — one fixture
 *   GET /api/fixtures/:id/pool         — live parimutuel pool sizes
 *   GET /api/table                     — league table (points, GD)
 *   GET /api/leaderboard               — players ranked by win rate
 *   GET /api/players/:address          — player profile stats
 *   GET /api/prices                    — latest validated price per team
 *
 * BigInts are serialized as strings throughout — JSON has no BigInt.
 */

import { Router, type Request, type Response } from "express";
import { isAddress } from "viem";
import { TICKR_TEAMS } from "@tickr/shared";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { ChainReader } from "./readClient.js";
import type { MatchLifecycle } from "../services/matchLifecycle.js";
import type { PriceFeed } from "../services/priceFeed.js";
import type { CoingeckoPoller } from "../services/coingecko.js";
import type { BinanceWsFeed } from "../services/binanceWs.js";
import { scaledToPrice } from "../lib/priceMath.js";

export interface ApiDeps {
  reader: ChainReader;
  lifecycle: MatchLifecycle;
  priceFeed: PriceFeed;
  coingecko: CoingeckoPoller;
  binance: BinanceWsFeed;
}

function serializeFixture(f: {
  fixtureId: bigint;
  homeTeamId: number;
  awayTeamId: number;
  matchdayIndex: number;
  windowStartMs: number;
  windowEndMs: number;
  kickoffMs: number;
  kickoffRevealed: boolean;
  settled: boolean;
}) {
  const home = TICKR_TEAMS.find((t) => t.teamId === f.homeTeamId);
  const away = TICKR_TEAMS.find((t) => t.teamId === f.awayTeamId);
  return {
    fixtureId: f.fixtureId.toString(),
    seasonId: config.seasonId.toString(),
    home: home ? { teamId: home.teamId, name: home.name, symbol: home.symbol } : null,
    away: away ? { teamId: away.teamId, name: away.name, symbol: away.symbol } : null,
    matchdayIndex: f.matchdayIndex,
    windowStart: new Date(f.windowStartMs).toISOString(),
    windowEnd: new Date(f.windowEndMs).toISOString(),
    kickoff: f.kickoffMs > 0 ? new Date(f.kickoffMs).toISOString() : null,
    kickoffRevealed: f.kickoffRevealed,
    settled: f.settled,
  };
}

export function buildRouter(deps: ApiDeps): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      chainEnv: config.chainEnv,
      seasonId: config.seasonId.toString(),
      signer: "configured",
    });
  });

  router.get("/api/teams", (_req: Request, res: Response) => {
    const meta = deps.coingecko.getMetadata();
    res.json(
      TICKR_TEAMS.map((t) => ({
        teamId: t.teamId,
        name: t.name,
        symbol: t.symbol,
        imageUrl: meta.get(t.coingeckoId)?.imageUrl ?? null,
      }))
    );
  });

  router.get("/api/fixtures", (_req: Request, res: Response) => {
    res.json(deps.lifecycle.getFixtures().map(serializeFixture));
  });

  router.get("/api/fixtures/:id", (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const f = deps.lifecycle.getFixtures().find((x) => x.fixtureId === id);
    if (!f) {
      res.status(404).json({ error: "fixture not found" });
      return;
    }
    res.json(serializeFixture(f));
  });

  router.get("/api/fixtures/:id/pool", async (req: Request, res: Response) => {
    try {
      const pool = await deps.reader.getPool(config.seasonId, BigInt(String(req.params.id)));
      res.json(pool);
    } catch (err) {
      logger.warn("[api] getPool failed", { error: String(err) });
      res.status(502).json({ error: "failed to read pool from chain" });
    }
  });

  router.get("/api/table", async (_req: Request, res: Response) => {
    try {
      res.json(await deps.reader.getLeagueTable(config.seasonId));
    } catch (err) {
      logger.warn("[api] getLeagueTable failed", { error: String(err) });
      res.status(502).json({ error: "failed to read league table from chain" });
    }
  });

  router.get("/api/leaderboard", async (_req: Request, res: Response) => {
    try {
      res.json(await deps.reader.getLeaderboard());
    } catch (err) {
      logger.warn("[api] getLeaderboard failed", { error: String(err) });
      res.status(502).json({ error: "failed to build leaderboard" });
    }
  });

  router.get("/api/players/:address", async (req: Request, res: Response) => {
    const address = String(req.params.address);
    if (!isAddress(address)) {
      res.status(400).json({ error: "invalid address" });
      return;
    }
    try {
      res.json(await deps.reader.getPlayer(address));
    } catch (err) {
      logger.warn("[api] getPlayer failed", { error: String(err) });
      res.status(502).json({ error: "failed to read player stats from chain" });
    }
  });

  router.get("/api/prices", (_req: Request, res: Response) => {
    const out = TICKR_TEAMS.map((t) => {
      try {
        const q = deps.priceFeed.getValidatedPrice(t.teamId);
        return {
          teamId: t.teamId,
          symbol: t.symbol,
          price: scaledToPrice(q.scaled),
          source: q.source,
          ok: true as const,
        };
      } catch (err) {
        return {
          teamId: t.teamId,
          symbol: t.symbol,
          price: null,
          source: null,
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
    res.json(out);
  });

  return router;
}
