/**
 * REST API (spec P2.7).
 *
 * Endpoints (all JSON):
 *   GET /health                        — liveness + subsystem status + bandwidth
 *   GET /api/teams                     — 20-team roster + CoinGecko logos
 *   GET /api/fixtures                  — all Season-1 fixtures w/ kickoff state
 *     (+ scheduledKickoff: the deterministic slot, visible well before the
 *      on-chain reveal — the contract only accepts reveals 30–120 min
 *      before kickoff, but each slot is fixed for the season)
 *   GET /api/fixtures/:id              — one fixture
 *   GET /api/fixtures/:id/pool         — live parimutuel pool sizes
 *   GET /api/table                     — league table (points, GD)
 *   GET /api/leaderboard               — players ranked by win rate
 *   GET /api/players/:address          — player profile stats
 *   GET /api/prices                    — latest validated price per team
 *   GET /api/chain/markets             — cached market catalogue (RPC shield)
 *   GET /api/chain/markets/:id         — one cached market
 *   GET /api/chain/odds-history/:id    — incremental stake-driven odds history
 *
 * BigInts are serialized as strings throughout — JSON has no BigInt.
 *
 * Optimization pass changes:
 * - /health is REAL now: RPC latency, indexer lag, price-feed staleness,
 *   Supabase reachability and the bandwidth projection (was a stub).
 * - /api/* is rate-limited (100 req/min per IP) and request-logged.
 * - The three previously unguarded routes (/api/teams, /api/fixtures,
 *   /api/prices) have try/catch — an exception no longer hits Express's
 *   default HTML error handler.
 * - New /api/chain/* endpoints served by ChainCache (10s TTL + coalescing),
 *   so hundreds of frontend clients share a handful of upstream RPC calls.
 * - Error bodies are { ok:false, code, message } with calm, human messages —
 *   never stacks, RPC URLs or "check the server logs".
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { isAddress } from "viem";
import { TICKR_TEAMS } from "@tickr/shared";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { ChainReader } from "./readClient.js";
import type { MatchLifecycle } from "../services/matchLifecycle.js";
import type { PriceFeed } from "../services/priceFeed.js";
import type { CoingeckoPoller } from "../services/coingecko.js";
import { ChainCache, ChainApiError } from "../services/chainCache.js";
import { scaledToPrice } from "../lib/priceMath.js";

const priceHistoryCache = new Map<string, { at: number; points: Array<{ t: number; p: number }> }>();

export interface HealthReport {
  status: "ok" | "degraded";
  uptimeSec: number;
  chainEnv: string;
  seasonId: string;
  signer: "configured";
  subsystems: {
    rpc: { ok: boolean; latencyMs: number; latestBlock: string | null };
    indexer: { ok: boolean; lagBlocks: number | null };
    priceFeed: { ok: boolean; stalenessSec: number | null };
    supabase: { ok: boolean; configured: boolean };
  };
  bandwidth: {
    counts: Record<string, number>;
    projectedMonthly: Record<string, number>;
  };
}

export interface ApiDeps {
  reader: ChainReader;
  lifecycle: MatchLifecycle;
  priceFeed: PriceFeed;
  coingecko: CoingeckoPoller;
  chainCache: ChainCache;
  /** Assembled in index.ts — reads every subsystem without throwing. */
  health: () => Promise<HealthReport>;
}

function serializeFixture(
  f: {
    fixtureId: bigint;
    homeTeamId: number;
    awayTeamId: number;
    matchdayIndex: number;
    windowStartMs: number;
    windowEndMs: number;
    kickoffMs: number;
    kickoffRevealed: boolean;
    settled: boolean;
    voided: boolean;
  },
  scheduledKickoffMs: number | null
) {
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
    // Deterministic slot, visible well before the on-chain reveal (the
    // contract only accepts reveals 30–120 min before kickoff). Null once
    // settled or when the window can't fit the schedule.
    scheduledKickoff:
      scheduledKickoffMs !== null ? new Date(scheduledKickoffMs).toISOString() : null,
    settled: f.settled,
    voided: f.voided,
  };
}

/** Calm API error body — no stacks, hosts or jargon. */
function apiError(
  res: Response,
  status: number,
  code: string,
  message: string
): void {
  res.status(status).json({ ok: false, code, message });
}

function chainError(res: Response, err: unknown): void {
  if (err instanceof ChainApiError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "BAD_REQUEST" ? 400 : 502;
    apiError(res, status, err.code, err.message);
    return;
  }
  logger.warn("[api] chain endpoint failed", { error: String(err) });
  apiError(
    res,
    502,
    "RPC_UNAVAILABLE",
    "Live market data is refreshing — please try again in a moment."
  );
}

export function buildRouter(deps: ApiDeps): Router {
  const router = Router();

  // --- request logging -------------------------------------------------------
  router.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const fields = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
      };
      if (res.statusCode >= 500) logger.warn("[api] request", fields);
      else logger.debug("[api] request", fields);
    });
    next();
  });

  // --- rate limiting (all /api/*, /health stays open for monitors) -----------
  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      ok: false,
      code: "RATE_LIMITED",
      message: "Too many requests — please slow down and try again.",
    },
  });
  router.use("/api", apiLimiter);

  // --- health ------------------------------------------------------------------
  // Always 200: the process is alive; subsystem trouble is reported in the
  // body (a 503 here would make a load balancer kill us over an RPC blip).
  router.get("/health", async (_req: Request, res: Response) => {
    try {
      const report = await deps.health();
      res.status(200).json(report);
    } catch (err) {
      logger.warn("[api] health assembly failed", { error: String(err) });
      res.json({
        status: "degraded",
        uptimeSec: Math.round(process.uptime()),
        chainEnv: config.chainEnv,
        seasonId: config.seasonId.toString(),
        signer: "configured" as const,
      });
    }
  });

  // --- chain-cache (RPC shield) --------------------------------------------------
  router.get("/api/chain/markets", async (_req: Request, res: Response) => {
    try {
      const data = await deps.chainCache.getMarkets();
      res.json({ ok: true, data });
    } catch (err) {
      chainError(res, err);
    }
  });

  router.get("/api/chain/markets/:id", async (req: Request, res: Response) => {
    try {
      const data = await deps.chainCache.getMarket(Number(req.params.id));
      res.json({ ok: true, data: { market: data } });
    } catch (err) {
      chainError(res, err);
    }
  });

  router.get("/api/chain/odds-history/:id", async (req: Request, res: Response) => {
    try {
      const data = await deps.chainCache.getOddsHistory(Number(req.params.id));
      res.json({ ok: true, data });
    } catch (err) {
      chainError(res, err);
    }
  });

  // --- existing endpoints (shapes unchanged) ---------------------------------------
  router.get("/api/teams", (_req: Request, res: Response) => {
    try {
      const meta = deps.coingecko.getMetadata();
      res.json(
        TICKR_TEAMS.map((t) => ({
          teamId: t.teamId,
          name: t.name,
          symbol: t.symbol,
          cmcId: t.cmcId,
          imageUrl: meta.get(t.coingeckoId)?.imageUrl ?? null,
        }))
      );
    } catch (err) {
      logger.warn("[api] getTeams failed", { error: String(err) });
      apiError(res, 502, "INTERNAL", "Team list is refreshing — please try again in a moment.");
    }
  });

  router.get("/api/fixtures", (_req: Request, res: Response) => {
    try {
      const fixtures = deps.lifecycle.getFixtures();
      const scheduled = deps.lifecycle.getScheduledKickoffs();
      res.json(
        fixtures.map((f) => serializeFixture(f, scheduled.get(f.fixtureId) ?? null))
      );
    } catch (err) {
      logger.warn("[api] getFixtures failed", { error: String(err) });
      apiError(res, 502, "INTERNAL", "Fixtures are refreshing — please try again in a moment.");
    }
  });

  router.get("/api/fixtures/:id", (req: Request, res: Response) => {
    try {
      const id = BigInt(String(req.params.id));
      const f = deps.lifecycle.getFixtures().find((x) => x.fixtureId === id);
      if (!f) {
        res.status(404).json({ error: "fixture not found" });
        return;
      }
      const scheduled = deps.lifecycle.getScheduledKickoffs().get(id) ?? null;
      res.json(serializeFixture(f, scheduled));
    } catch {
      res.status(404).json({ error: "fixture not found" });
    }
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

  router.get("/api/price-history/:symbol", async (req: Request, res: Response) => {
    const team = TICKR_TEAMS.find((t) => t.symbol === String(req.params.symbol).toUpperCase());
    if (!team) { res.status(404).json({ error: "unknown team" }); return; }
    const cached = priceHistoryCache.get(team.symbol);
    if (cached && Date.now() - cached.at < 60_000) { res.json(cached.points); return; }
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${team.binanceSymbol}&interval=5m&limit=288`;
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`history source ${response.status}`);
      const rows = await response.json() as unknown;
      if (!Array.isArray(rows)) throw new Error("invalid history response");
      const points = rows.map((row) => {
        const candle = row as unknown[];
        return { t: Number(candle[0]), p: Number(candle[4]) };
      }).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.p) && p.p > 0);
      if (!points.length) throw new Error("empty history response");
      priceHistoryCache.set(team.symbol, { at: Date.now(), points });
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(points);
    } catch (err) {
      if (cached && Date.now() - cached.at < 5 * 60_000) { res.json(cached.points); return; }
      logger.warn("[api] price history unavailable", { symbol: team.symbol, error: String(err) });
      res.status(502).json({ error: "price history unavailable" });
    }
  });

  router.get("/api/prices", (_req: Request, res: Response) => {
    try {
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
    } catch (err) {
      logger.warn("[api] getPrices failed", { error: String(err) });
      apiError(res, 502, "STALE_PRICES", "Prices are refreshing — please try again in a moment.");
    }
  });

  return router;
}
