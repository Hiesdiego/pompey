/**
 * Stock REST API.
 *
 * Intended destination: packages/backend/src/api/stockRoutes.ts, mounted
 * alongside the crypto router (same Express app, /api/stocks/* prefix).
 * Mirrors the crypto routes.ts patterns (JSON everywhere, BigInts as
 * strings, 400 on a bad address, 404 on a missing fixture, 502 when the
 * chain cannot be read, isAddress validation) with two deliberate
 * deviations, both documented here because the crypto routes do neither:
 *
 *   - CACHE HEADERS. The crypto routes set no Cache-Control. The stock
 *     routes set short-lived ones to protect the 1 GB/month budget
 *     against polling frontends: fixtures/table 15s, teams 1h, prices
 *     no-store (prices are live), players 30s. A CDN or browser may
 *     cache within those bounds; nothing is cached longer than the data
 *     stays true.
 *   - RATE LIMIT. The crypto routes have no rate limiter. The stock
 *     router ships a tiny in-memory per-IP limiter (120 requests/min,
 *     429 beyond) so one aggressive client cannot burn the RPC budget.
 *     It is per-process memory, not Redis: a restart resets it, which is
 *     fine for a limiter. Replace with the shared limiter if the repo
 *     gains one; do not remove it without one.
 *
 * Endpoints (all JSON, canonical /api/stocks/* plural naming everywhere):
 *   GET /api/stocks/teams           , 12-team roster (B20 symbols, ISINs, logos)
 *   GET /api/stocks/fixtures       , all stock fixtures w/ kickoff state
 *   GET /api/stocks/fixtures/:id   , one fixture (+ forfeit flag when settled)
 *   GET /api/stocks/table          , stock league table (locked tiebreak)
 *   GET /api/stocks/prices         , latest validated NAV per team
 *   GET /api/stocks/players/:address, UNIFIED TP row (crypto + stock)
 *
 * The players endpoint is the unified TP surface: crypto TP plus stock
 * TP in one row, no separate stock leaderboard anywhere. A player who
 * only played crypto still gets a row (stockTp 0), and vice versa.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { isAddress } from "viem";
import { stockConfig } from "../stockConfig.js";
import { logger } from "../lib/logger.js";
import { STOCK_TEAMS } from "../services/stockTeams.js";
import type { StockChainReader } from "./stockReadClient.js";
import type { StockMatchLifecycle, StockFixtureView } from "../services/stockMatchLifecycle.js";
import type { StockPriceFeed } from "../services/stockPriceFeed.js";
import type { StockTpAggregator } from "../services/stockTpAggregator.js";
import type { StockNavPoller } from "../services/stockNavPoller.js";
import { scaledToPrice } from "../lib/priceMath.js";

export interface StockApiDeps {
  reader: StockChainReader;
  lifecycle: StockMatchLifecycle;
  priceFeed: StockPriceFeed;
  navPoller: StockNavPoller;
  tpAggregator: StockTpAggregator;
}

/** Short-lived cache headers (see header: crypto routes set none). */
function cache(res: Response, maxAgeSeconds: number): void {
  res.setHeader("Cache-Control", `public, max-age=${maxAgeSeconds}`);
}

/** In-memory per-IP rate limiter: 120 requests per rolling minute. */
function stockRateLimit(maxPerMinute = 120): (req: Request, res: Response, next: NextFunction) => void {
  const hits = new Map<string, { count: number; windowStartMs: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const entry = hits.get(ip);
    if (!entry || now - entry.windowStartMs >= 60_000) {
      hits.set(ip, { count: 1, windowStartMs: now });
      next();
      return;
    }
    entry.count++;
    if (entry.count > maxPerMinute) {
      res.status(429).json({ error: "rate limit exceeded, retry in a minute" });
      return;
    }
    // Bound memory: drop windows older than 2 minutes on every 100th call.
    if (hits.size > 10_000) {
      for (const [key, value] of hits) {
        if (now - value.windowStartMs > 120_000) hits.delete(key);
      }
    }
    next();
  };
}

export interface SerializeStockFixtureOpts {
  forfeitingTeamId?: number | null;
  voided?: boolean;
  homeGoals?: number | null;
  awayGoals?: number | null;
  /** Deterministic kickoff slot (StockMatchLifecycle.getScheduledKickoffs),
   *  published so unrevealed fixtures count down like crypto fixtures.
   *  Null only when the caller has no slot for the fixture. */
  scheduledKickoffMs?: number | null;
}

function serializeStockFixture(f: StockFixtureView, opts: SerializeStockFixtureOpts = {}) {
  const home = STOCK_TEAMS.find((t) => t.teamId === f.homeTeamId);
  const away = STOCK_TEAMS.find((t) => t.teamId === f.awayTeamId);
  const forfeitingTeamId = opts.forfeitingTeamId ?? null;
  // FIX (2026-11-17): the old shape returned forfeit as an object
  // ({ forfeitingTeamId }) or null, while the frontend type is a boolean
  // and StockFixtureCard checks `fixture.forfeit === true`, so the flag
  // never matched. It also sent no scoreline at all, so every settled
  // card rendered "–" instead of the FT score. forfeit is a boolean now,
  // forfeitingTeamId is its own field, and goals ride along.
  let homeGoals = opts.homeGoals ?? null;
  let awayGoals = opts.awayGoals ?? null;
  if (homeGoals === null && awayGoals === null && forfeitingTeamId !== null) {
    // Forfeit recorded but no ResultRecorded yet: the reader reports
    // 0-0 for this case, which is never a real forfeit scoreline.
    // The locked rule is 3-0 to the opponent, so derive it here.
    homeGoals = forfeitingTeamId === f.homeTeamId ? 0 : 3;
    awayGoals = forfeitingTeamId === f.homeTeamId ? 3 : 0;
  }
  return {
    fixtureId: f.fixtureId.toString(),
    seasonId: stockConfig.seasonId.toString(),
    league: "stocks",
    home: home ? { teamId: home.teamId, ticker: home.ticker, name: home.name, symbol: home.tokenSymbol } : null,
    away: away ? { teamId: away.teamId, ticker: away.ticker, name: away.name, symbol: away.tokenSymbol } : null,
    matchdayIndex: f.matchdayIndex,
    // 1-based round number for the UI (round 21 is matchdayIndex 20).
    round: f.matchdayIndex + 1,
    // True for the two Dec 16 finale rounds (matchdayIndex 20 and 21),
    // which share one calendar day in two waves (morning and evening).
    doubleHeader: stockConfig.season.doubleHeaderMatchdays.some((round) => round === f.matchdayIndex),
    windowStart: new Date(f.windowStartMs).toISOString(),
    windowEnd: new Date(f.windowEndMs).toISOString(),
    kickoff: f.kickoffMs > 0 ? new Date(f.kickoffMs).toISOString() : null,
    kickoffRevealed: f.kickoffRevealed,
    scheduledKickoff:
      opts.scheduledKickoffMs !== null && opts.scheduledKickoffMs !== undefined
        ? new Date(opts.scheduledKickoffMs).toISOString()
        : null,
    matchEnd: f.matchEndMs > 0 ? new Date(f.matchEndMs).toISOString() : null,
    settled: f.settled,
    // Forfeit is surfaced, never hidden inside a 3-0 scoreline.
    forfeit: forfeitingTeamId !== null,
    forfeitingTeamId,
    voided: opts.voided ?? false,
    homeGoals,
    awayGoals,
  };
}

export function buildStockRouter(deps: StockApiDeps): Router {
  const router = Router();
  router.use(stockRateLimit());

  router.get("/api/stocks/teams", (_req: Request, res: Response) => {
    cache(res, 3600);
    res.json(
      STOCK_TEAMS.map((t) => ({
        teamId: t.teamId,
        ticker: t.ticker,
        name: t.name,
        symbol: t.tokenSymbol,
        contractAddress: t.contractAddress,
        decimals: t.decimals,
        issuer: t.issuer,
        isin: t.isin,
        logoPath: t.logoPath,
      }))
    );
  });

  router.get("/api/stocks/fixtures", async (_req: Request, res: Response) => {
    cache(res, 15);
    const forfeits = deps.reader.getForfeitMap();
    const fixtures = deps.lifecycle.getFixtures();
    const scheduled = deps.lifecycle.getScheduledKickoffs();
    const out = [];
    for (const f of fixtures) {
      const forfeitingTeamId = forfeits.get(f.fixtureId.toString()) ?? null;
      let homeGoals: number | null = null;
      let awayGoals: number | null = null;
      // Settled fixtures only: attach the recorded scoreline so cards
      // show FT scores instead of "–". Unsettled fixtures need no chain
      // read at all. getStockFixtureResult re-scans are watermarked, so
      // this is cheap after the first call; a failed read falls back to
      // the forfeit map and a null scoreline, never a 502 of the list.
      if (f.settled) {
        try {
          const r = await deps.reader.getStockFixtureResult(stockConfig.seasonId, f.fixtureId);
          if (r) {
            homeGoals = r.homeGoals;
            awayGoals = r.awayGoals;
          }
        } catch (err) {
          logger.warn("[api/stocks] fixture result read failed, serving without scoreline", {
            error: String(err),
          });
        }
      }
      out.push(serializeStockFixture(f, { forfeitingTeamId, voided: f.voided, homeGoals, awayGoals, scheduledKickoffMs: scheduled.get(f.fixtureId) ?? null }));
    }
    res.json(out);
  });

  router.get("/api/stocks/fixtures/:id", async (req: Request, res: Response) => {
    cache(res, 15);
    let id: bigint;
    try {
      id = BigInt(String(req.params.id));
    } catch {
      res.status(400).json({ error: "invalid fixture id" });
      return;
    }
    const f = deps.lifecycle.getFixtures().find((x) => x.fixtureId === id);
    if (!f) {
      res.status(404).json({ error: "fixture not found" });
      return;
    }
    // Forfeit flag and scoreline are best-effort: a failed chain read
    // must not 502 a fixture that the lifecycle cache already knows.
    // Voided starts from the lifecycle cache, which reads the flag from
    // the registry on every refresh, so it survives restarts; the
    // reader result below can only add to it.
    let forfeitingTeamId: number | undefined;
    let voided = f.voided;
    let result: Awaited<ReturnType<typeof deps.reader.getStockFixtureResult>> = null;
    try {
      result = await deps.reader.getStockFixtureResult(stockConfig.seasonId, id);
      if (result?.forfeit) forfeitingTeamId = result.forfeit.forfeitingTeamId;
      if (result?.voided) voided = true;
    } catch (err) {
      logger.warn("[api/stocks] fixture result read failed, serving without forfeit flag", {
        error: String(err),
      });
    }
    if (forfeitingTeamId === undefined) {
      forfeitingTeamId = deps.reader.getForfeitMap().get(id.toString());
    }
    res.json(
      serializeStockFixture(f, {
        forfeitingTeamId: forfeitingTeamId ?? null,
        voided,
        homeGoals: result?.homeGoals ?? null,
        awayGoals: result?.awayGoals ?? null,
        scheduledKickoffMs: deps.lifecycle.getScheduledKickoffs().get(id) ?? null,
      })
    );
  });

  router.get("/api/stocks/fixtures/:id/pool", async (req: Request, res: Response) => {
    cache(res, 15);
    let id: bigint;
    try { id = BigInt(String(req.params.id)); }
    catch { res.status(400).json({ error: "invalid fixture id" }); return; }
    try {
      res.json(await deps.reader.getStockPool(stockConfig.seasonId, id));
    } catch (err) {
      logger.warn("[api/stocks] getStockPool failed", { error: String(err) });
      res.status(502).json({ error: "failed to read stock fixture pool" });
    }
  });

  router.get("/api/stocks/table", async (_req: Request, res: Response) => {
    cache(res, 15);
    try {
      res.json(await deps.reader.getStockLeagueTable(stockConfig.seasonId));
    } catch (err) {
      logger.warn("[api/stocks] getStockLeagueTable failed", { error: String(err) });
      res.status(502).json({ error: "failed to read stock league table from chain" });
    }
  });

  router.get("/api/stocks/prices", (_req: Request, res: Response) => {
    // Live prices: never cache.
    res.setHeader("Cache-Control", "no-store");
    const out = STOCK_TEAMS.map((t) => {
      try {
        const q = deps.priceFeed.getValidatedPrice(t.teamId);
        const tick = deps.navPoller.getLatest(t.teamId);
        return {
          teamId: t.teamId,
          ticker: t.ticker,
          symbol: t.tokenSymbol,
          price: scaledToPrice(q.scaled),
          source: q.source,
          navPriceUpdatedAt: tick?.navPriceUpdatedAtIso ?? null,
          multiplier: tick?.multiplier ?? null,
          // True only when this price was produced by the last-NAV
          // fallback (healthy feed, quiet window). getValidatedPrice
          // never sets it; resolveEndPrice does, at full-time.
          lastNavFallback: q.lastNavFallback,
          lastNavFallbackAgeMs: q.lastNavFallbackAgeMs,
          ok: true as const,
        };
      } catch (err) {
        return {
          teamId: t.teamId,
          ticker: t.ticker,
          symbol: t.tokenSymbol,
          price: null,
          source: null,
          navPriceUpdatedAt: deps.navPoller.getLatest(t.teamId)?.navPriceUpdatedAtIso ?? null,
          multiplier: deps.navPoller.getLatest(t.teamId)?.multiplier ?? null,
          lastNavFallback: false,
          lastNavFallbackAgeMs: null,
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
    res.json(out);
  });

  router.get("/api/stocks/players/:address", async (req: Request, res: Response) => {
    cache(res, 30);
    const address = String(req.params.address);
    if (!isAddress(address)) {
      res.status(400).json({ error: "invalid address" });
      return;
    }
    try {
      const row = await deps.tpAggregator.getUnifiedPlayer(address);
      const rank = await deps.tpAggregator.getPlayerRank(address);
      res.json({ ...row, rank });
    } catch (err) {
      logger.warn("[api/stocks] getUnifiedPlayer failed", { error: String(err) });
      res.status(502).json({ error: "failed to build unified TP row" });
    }
  });

  return router;
}
