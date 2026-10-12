
import { Router, type Request, type Response, type NextFunction } from "express";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
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
import { fetchPriceHistory, type PriceHistoryPoint } from "../services/priceHistory.js";

const priceHistoryCache = new Map<string, { at: number; points: PriceHistoryPoint[] }>();
const gzipAsync = promisify(gzip);

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

    scheduledKickoff:
      scheduledKickoffMs !== null ? new Date(scheduledKickoffMs).toISOString() : null,
    settled: f.settled,
    voided: f.voided,
  };
}

function apiError(
  res: Response,
  status: number,
  code: string,
  message: string
): void {
  res.setHeader("Cache-Control", "no-store");
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

  // Render can cache JSON only when edge caching is set to "All files".
  // Explicitly opt in public reads and keep every other response uncached.
  router.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET" || req.method === "HEAD") {
      const path = req.path;
      const ttl = path === "/api/chain/markets" ? 10
        : /^\/api\/chain\/markets\/\d+$/.test(path) ? 10
        : /^\/api\/chain\/odds-history\/\d+$/.test(path) ? 20
        : path === "/api/fixtures" || /^\/api\/fixtures\/\d+$/.test(path) ? 10
        : /^\/api\/fixtures\/\d+\/(pool|form)$/.test(path) ? 5
        : path === "/api/table" ? 30
        : path === "/api/prices" ? 5
        : path === "/api/teams" ? 3600
        : 0;
      if (ttl > 0) {
        // Browser revalidates; only the shared edge keeps a short copy.
        res.setHeader("Cache-Control", `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl}`);
      }
    }
    next();
  });

  // Never edge-cache an error, including a temporary RPC failure or unknown ID.
  router.use((_req: Request, res: Response, next: NextFunction) => {
    const send = res.send.bind(res);
    res.send = ((body: unknown) => {
      if (res.statusCode >= 400) res.setHeader("Cache-Control", "no-store");
      return send(body);
    }) as typeof res.send;
    next();
  });

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

  router.get("/api/chain/markets", async (req: Request, res: Response) => {
    try {
      const data = await deps.chainCache.getMarkets();
      // The block advances even when market data has not changed. Keep the
      // validator stable so browser revalidation can return a tiny 304.
      const marketsJson = JSON.stringify(data.markets);
      const etag = `W/"${createHash("sha1").update(marketsJson).digest("hex")}"`;
      res.setHeader("ETag", etag);
      res.vary("Accept-Encoding");
      if (req.fresh) {
        res.status(304).end();
        return;
      }
      const body = JSON.stringify({ ok: true, data });
      if (/\bgzip\b/.test(req.headers["accept-encoding"] ?? "") && body.length > 1024) {
        const zipped = await gzipAsync(Buffer.from(body));
        res.setHeader("Content-Encoding", "gzip");
        res.type("json").send(zipped);
      } else {
        res.type("json").send(body);
      }
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

  router.get("/api/fixtures/:id/form", async (req: Request, res: Response) => {
    try {
      const fixtureId = BigInt(String(req.params.id));
      const fixture = deps.lifecycle.getFixtures().find((item) => item.fixtureId === fixtureId);
      if (!fixture) { res.status(404).json({ error: "fixture not found" }); return; }
      res.json(await deps.reader.getRecentForm(config.seasonId, fixture.homeTeamId, fixture.awayTeamId, deps.lifecycle.getFixtures()));
    } catch (err) {
      logger.warn("[api] getRecentForm failed", { error: String(err) });
      res.status(502).json({ error: "recent form unavailable" });
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
    const cacheMs = cached?.points[0]?.source === "CoinGecko" ? 5 * 60_000 : 60_000;
    if (cached && Date.now() - cached.at < cacheMs) { res.json(cached.points); return; }
    try {
      const points = await fetchPriceHistory(team, config.binance.restBaseUrl, config.coingecko.baseUrl, config.coingecko.apiKey);
      priceHistoryCache.set(team.symbol, { at: Date.now(), points });
      res.setHeader("Cache-Control", `public, max-age=${points[0].source === "CoinGecko" ? 300 : 60}`);
      res.json(points);
    } catch (err) {
      if (cached && Date.now() - cached.at < 15 * 60_000) { res.json(cached.points); return; }
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
