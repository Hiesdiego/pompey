/**
 * Stock Meme Arena REST API.
 *
 * Intended destination: packages/backend/src/api/arenaRoutes.ts,
 * mounted alongside the stock market router (same Express app,
 * /api/arena/* prefix). Built as a SEPARATE router from
 * api/stockMarketRoutes.ts on purpose: the Arena stack is gated on
 * ARENA_CLASH_FACTORY_ADDRESS alone (see arenaConfig.ts), while the
 * stock market router is gated on the stock market factory, and
 * neither gate may imply the other.
 *
 * Endpoints (the locked API contract):
 *   GET /api/arena/registry        , { memes: [...] }, the dynamic
 *     BaseStonk registry from the ArenaRegistryService in-memory
 *     cache. A request NEVER triggers an upstream call.
 *   GET /api/arena/clashes         , { ok: true, data: { clashes,
 *     asOfBlock, refreshedAt } }, the SAME envelope as the stock
 *     markets list, with ETag, 304 and gzip behaviour.
 *   GET /api/arena/clashes/:id     , { ok: true, data: { clash,
 *     userPosition? } }, the SAME envelope as the stock market
 *     detail. No caller info by default; when the caller supplies
 *     ?address=0x..., data.userPosition is added with that address's
 *     stakes and claimed flag. Featured and cup-late clashes also
 *     carry data.commentary (the arena commentary lines) when a
 *     commentary service is wired.
 *   GET /api/arena/rankings        , { ok: true, data: { rankings,
 *     updatedAt } }, the Elo board (cup matches only, top 140).
 *   GET /api/arena/cups            , { ok: true, data: { cups } },
 *     cup history, newest first, each with champion and runnerUp.
 *   GET /api/arena/cups/current    , { ok: true, data: { cup } },
 *     the live cup with its full bracket (rounds, ties, seeds,
 *     clashIds, winners), or cup: null when no cup is live. Ties are
 *     grouped under cup.rounds: [{ round, ties: [...] }].
 *
 * Mirroring notes (api/stockMarketRoutes.ts):
 *   - Errors use the chain-endpoint envelope { ok: false, code,
 *     message } with ChainApiError mapped NOT_FOUND to 404,
 *     BAD_REQUEST to 400, everything else to 502, and errors are
 *     never cached (Cache-Control: no-store).
 *   - Cache TTLs mirror the stock market routes EXACTLY: clash reads
 *     carry "public, max-age=0, s-maxage=10,
 *     stale-while-revalidate=10", the registry carries the fixtures
 *     TTL (public, max-age=15), and the clashes list keeps the ETag
 *     plus 304 plus gzip behaviour.
 *   - Rate limiting mirrors the stock market router: a tiny in-memory
 *     per-IP limiter (120 requests/min, 429 beyond) so one aggressive
 *     client cannot burn the RPC budget under the 1 GB/month cap.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { isAddress } from "viem";
import { logger } from "../lib/logger.js";
import { ChainApiError } from "../services/chainCache.js";
import type { ArenaRegistryService } from "../services/arenaRegistryService.js";
import type { ArenaClashReader, ArenaClashSummary } from "../services/arenaClashReader.js";
import type { ArenaRatings } from "../services/arenaRatings.js";
import type { ArenaCupService, ArenaCupTieRecord } from "../services/arenaCupService.js";
import type { ArenaCommentary, ArenaCommentaryLine } from "../services/arenaCommentary.js";

const gzipAsync = promisify(gzip);

export interface ArenaApiDeps {
  registry: ArenaRegistryService;
  reader: ArenaClashReader;
  ratings: ArenaRatings | null;
  cupService: ArenaCupService | null;
  commentary?: ArenaCommentary | null;
}

/** In-memory per-IP rate limiter: 120 requests per rolling minute.
 *  Copied from api/stockMarketRoutes.ts (same bound, same behaviour). */
function arenaRateLimit(maxPerMinute = 120): (req: Request, res: Response, next: NextFunction) => void {
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
    if (hits.size > 10_000) {
      for (const [key, value] of hits) {
        if (now - value.windowStartMs > 120_000) hits.delete(key);
      }
    }
    next();
  };
}

function apiError(res: Response, status: number, code: string, message: string): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ ok: false, code, message });
}

function chainError(res: Response, err: unknown): void {
  if (err instanceof ChainApiError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "BAD_REQUEST" ? 400 : 502;
    apiError(res, status, err.code, err.message);
    return;
  }
  logger.warn("[api/arena] chain endpoint failed", { error: String(err) });
  apiError(res, 502, "RPC_UNAVAILABLE", "Live clash data is refreshing, please try again in a moment.");
}

/** The stock market routes' cache header for market reads. */
function clashCache(res: Response): void {
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=10, stale-while-revalidate=10");
}

/** Commentary attaches only to clashes inside the commentary scope:
 *  cup semi-finals and finals, and featured clashes. */
function commentaryInScope(clash: ArenaClashSummary): boolean {
  return clash.featured || (clash.cup !== null && (clash.cup.round === "SF" || clash.cup.round === "F"));
}

export function buildArenaRouter(deps: ArenaApiDeps): Router {
  const router = Router();
  router.use(arenaRateLimit());

  // Never edge-cache an error (mirrors the stock market router).
  router.use((_req: Request, res: Response, next: NextFunction) => {
    const send = res.send.bind(res);
    res.send = ((body: unknown) => {
      if (res.statusCode >= 400) res.setHeader("Cache-Control", "no-store");
      return send(body);
    }) as typeof res.send;
    next();
  });

  router.get("/api/arena/registry", (_req: Request, res: Response) => {
    // Served synchronously from the registry's in-memory cache; this
    // handler never triggers an upstream call (bandwidth hard cap).
    res.setHeader("Cache-Control", "public, max-age=15");
    res.json({ memes: deps.registry.getMemes() });
  });

  router.get("/api/arena/clashes", async (req: Request, res: Response) => {
    try {
      clashCache(res);
      const data = await deps.reader.getClashes();
      // Keep the validator stable so browser revalidation can return
      // a tiny 304 (mirrors the stock markets list handler).
      const clashesJson = JSON.stringify(data.clashes);
      const etag = `W/"${createHash("sha1").update(clashesJson).digest("hex")}"`;
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

  router.get("/api/arena/clashes/:id", async (req: Request, res: Response) => {
    try {
      clashCache(res);
      const clash = await deps.reader.getClash(Number(req.params.id));
      let commentary: ArenaCommentaryLine[] | undefined;
      if (deps.commentary && commentaryInScope(clash)) {
        commentary = await deps.commentary.getLines(clash.id).catch(() => undefined);
      }
      // Optional caller position: only when a valid address is
      // supplied. An invalid one is a client error in the chain
      // envelope, never a silently ignored parameter.
      const address = typeof req.query.address === "string" ? req.query.address : undefined;
      if (address !== undefined) {
        if (!isAddress(address)) {
          apiError(res, 400, "BAD_REQUEST", "Invalid address.");
          return;
        }
        const userPosition = await deps.reader.getUserPosition(clash.id, address);
        res.json({ ok: true, data: { clash, userPosition, ...(commentary ? { commentary } : {}) } });
        return;
      }
      res.json({ ok: true, data: { clash, ...(commentary ? { commentary } : {}) } });
    } catch (err) {
      chainError(res, err);
    }
  });

  router.get("/api/arena/rankings", async (_req: Request, res: Response) => {
    try {
      clashCache(res);
      if (!deps.ratings) {
        res.json({ ok: true, data: { rankings: [], updatedAt: new Date().toISOString() } });
        return;
      }
      const data = await deps.ratings.getRankings();
      res.json({ ok: true, data });
    } catch (err) {
      chainError(res, err);
    }
  });

  router.get("/api/arena/cups", async (_req: Request, res: Response) => {
    try {
      clashCache(res);
      const cups = deps.cupService ? await deps.cupService.getCups() : [];
      res.json({
        ok: true,
        data: {
          cups: cups.map((cup) => ({
            ...cup,
            champion: cup.champion ? { address: cup.champion, symbol: cup.championSymbol } : null,
            runnerUp: cup.runnerUp ? { address: cup.runnerUp, symbol: cup.runnerUpSymbol } : null,
          })),
        },
      });
    } catch (err) {
      chainError(res, err);
    }
  });

  router.get("/api/arena/cups/current", async (_req: Request, res: Response) => {
    try {
      clashCache(res);
      const current = deps.cupService ? await deps.cupService.getCurrentCup() : null;
      if (!current) {
        res.json({ ok: true, data: { cup: null } });
        return;
      }
      const roundOrder = ["R32", "R16", "QF", "SF", "F"];
      const byRound = new Map<string, ArenaCupTieRecord[]>();
      for (const tie of current.ties) {
        const list = byRound.get(tie.round) ?? [];
        list.push(tie);
        byRound.set(tie.round, list);
      }
      const rounds = roundOrder
        .filter((round) => byRound.has(round))
        .map((round) => ({
          round,
          ties: (byRound.get(round) ?? []).sort((a, b) => a.tieIndex - b.tieIndex),
        }));
      res.json({ ok: true, data: { cup: { ...current.cup, rounds } } });
    } catch (err) {
      chainError(res, err);
    }
  });

  return router;
}
