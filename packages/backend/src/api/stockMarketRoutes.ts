/**
 * Stock price target market REST API.
 *
 * Intended destination: packages/backend/src/api/stockMarketRoutes.ts,
 * mounted alongside the stock league router (same Express app,
 * /api/stocks/* prefix). Built as a SEPARATE router from
 * api/stockRoutes.ts on purpose: the market stack is gated on
 * STOCK_MARKET_FACTORY_ADDRESS alone (see stockMarketConfig.ts), while
 * the league router is gated on the full league contract set, and
 * neither gate may imply the other.
 *
 * Endpoints (the locked API contract):
 *   GET /api/stocks/list          , { stocks: [...] }, the dynamic
 *     stock list from the Coinbase tokenized stocks API, served from
 *     the StockListService in-memory cache. A request NEVER triggers
 *     an upstream call.
 *   GET /api/stocks/markets       , { ok: true, data: { markets,
 *     asOfBlock, refreshedAt } }, the SAME envelope and shape as the
 *     crypto GET /api/chain/markets, plus the decoded stock terms.
 *   GET /api/stocks/markets/:id   , { ok: true, data: { market } },
 *     the SAME envelope as the crypto GET /api/chain/markets/:id. The
 *     crypto endpoint carries no caller stake/claim info (its routes
 *     have no caller identity), so none is attached by default; when
 *     the caller supplies ?address=0x..., data.userPosition is added
 *     with that address's stakes and claimed flag. No address, no
 *     extra field, shape identical to crypto.
 *
 * Mirroring notes (crypto routes.ts and stockRoutes.ts):
 *   - Errors use the crypto chain-endpoint envelope
 *     { ok: false, code, message } with ChainApiError mapped
 *     NOT_FOUND to 404, BAD_REQUEST to 400, everything else to 502,
 *     and errors are never cached (Cache-Control: no-store), exactly
 *     like apiError/chainError in api/routes.ts.
 *   - Cache TTLs mirror the crypto market routes EXACTLY: the markets
 *     list and single market carry
 *     "public, max-age=0, s-maxage=10, stale-while-revalidate=10"
 *     (the crypto router's TTL for /api/chain/markets and
 *     /api/chain/markets/:id), the list endpoint carries the stock
 *     fixtures TTL (public, max-age=15), and the markets list keeps
 *     the crypto ETag + 304 + gzip behaviour so browser revalidation
 *     stays a tiny 304.
 *   - Rate limiting mirrors the stock league router: a tiny in-memory
 *     per-IP limiter (120 requests/min, 429 beyond) so one aggressive
 *     client cannot burn the RPC budget under the 1 GB/month cap.
 *     Replace with the shared limiter if the repo gains one; do not
 *     remove it without one.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { isAddress } from "viem";
import { logger } from "../lib/logger.js";
import { ChainApiError } from "../services/chainCache.js";
import type { StockListService } from "../services/stockListService.js";
import type { StockMarketReader } from "../services/stockMarketReader.js";

const gzipAsync = promisify(gzip);

export interface StockMarketApiDeps {
  listService: StockListService;
  reader: StockMarketReader;
}

/** In-memory per-IP rate limiter: 120 requests per rolling minute.
 *  Copied from api/stockRoutes.ts (same bound, same behaviour). */
function stockMarketRateLimit(maxPerMinute = 120): (req: Request, res: Response, next: NextFunction) => void {
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
  logger.warn("[api/stocks] chain endpoint failed", { error: String(err) });
  apiError(res, 502, "RPC_UNAVAILABLE", "Live market data is refreshing, please try again in a moment.");
}

/** The crypto market routes' cache header for market reads: the
 *  browser revalidates, only the shared edge keeps a 10s copy. */
function marketCache(res: Response): void {
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=10, stale-while-revalidate=10");
}

export function buildStockMarketRouter(deps: StockMarketApiDeps): Router {
  const router = Router();
  router.use(stockMarketRateLimit());

  // Never edge-cache an error (mirrors the crypto router's res.send wrap).
  router.use((_req: Request, res: Response, next: NextFunction) => {
    const send = res.send.bind(res);
    res.send = ((body: unknown) => {
      if (res.statusCode >= 400) res.setHeader("Cache-Control", "no-store");
      return send(body);
    }) as typeof res.send;
    next();
  });

  router.get("/api/stocks/list", (_req: Request, res: Response) => {
    // Served synchronously from the poller's in-memory cache; this
    // handler never triggers an upstream call (bandwidth hard cap).
    res.setHeader("Cache-Control", "public, max-age=15");
    res.json({ stocks: deps.listService.getStocks() });
  });

  router.get("/api/stocks/markets", async (req: Request, res: Response) => {
    try {
      marketCache(res);
      const data = await deps.reader.getMarkets();
      // The block advances even when market data has not changed. Keep
      // the validator stable so browser revalidation can return a
      // tiny 304 (mirrors the crypto markets list handler).
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

  router.get("/api/stocks/markets/:id", async (req: Request, res: Response) => {
    try {
      marketCache(res);
      const market = await deps.reader.getMarket(Number(req.params.id));
      // Optional caller position: only when a valid address is
      // supplied (see header). An invalid one is a client error in
      // the crypto envelope, never a silently ignored parameter.
      const address = typeof req.query.address === "string" ? req.query.address : undefined;
      if (address !== undefined) {
        if (!isAddress(address)) {
          apiError(res, 400, "BAD_REQUEST", "Invalid address.");
          return;
        }
        const userPosition = await deps.reader.getUserPosition(market.id, address);
        res.json({ ok: true, data: { market, userPosition } });
        return;
      }
      res.json({ ok: true, data: { market } });
    } catch (err) {
      chainError(res, err);
    }
  });

  return router;
}
