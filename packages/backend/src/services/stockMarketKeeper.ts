/**
 * Stock market keeper: resolver and voider for the stock price target
 * markets.
 *
 * Intended destination: packages/backend/src/services/stockMarketKeeper.ts.
 * Mirrors services/factoryKeeper.ts (the crypto MarketFactory keeper)
 * pattern for pattern:
 *   - A background pass on lib/loop.ts (non-overlapping, backoff on
 *     failure), every STOCK_MARKET_KEEPER_INTERVAL_MINUTES (default
 *     15, mirroring FACTORY_KEEPER_INTERVAL_MINUTES).
 *   - Gas-bounded: at most STOCK_MARKET_KEEPER_MAX_PER_PASS markets
 *     attempted per pass (default 10, mirroring FACTORY_KEEPER_MAX_PER_PASS).
 *   - All writes serialized through one TxQueue per signer, so only
 *     one transaction is in flight at a time.
 *   - It never acts before a market's endTime, and never touches a
 *     market whose state is not Open (the per-market state is re-read
 *     before every write).
 *   - Failed attempts whose revert is expected (AlreadySettled,
 *     MarketNotOpen) are skipped quietly and retried or dropped next
 *     pass; anything else is logged at ERROR.
 *   - Disable with STOCK_MARKET_KEEPER_ENABLED=false if bounty hunters
 *     are reliably covering resolutions (the keeper would just be
 *     spending gas to compete with them for the resolver fee).
 *
 * Deliberate differences from the crypto keeper, all forced by the
 * stock factory's shape:
 *   - RESOLVE CARRIES THE NAV. The crypto factory computes winners
 *     from on-chain oracle data inside resolve(marketId); the stock
 *     factory's resolver submits the final NAV, so this keeper calls
 *     resolve(marketId, finalPrice) with the resolution NAV scaled
 *     1e8. The NAV comes from the same source the league uses: the
 *     Coinbase tokenized stocks API. The keeper reads it through the
 *     StockListService (which polls that API for the full dynamic
 *     list, because stock markets cover every listed stock, not just
 *     the 12 league teams) and, for league-roster tokens, cross-checks
 *     the league StockPriceFeed's last-NAV tick (see resolutionNav).
 *   - VOID IS A REAL PATH. The crypto keeper never voids (voiding
 *     there is a user action after a 7-day window). The locked stock
 *     spec is different: when no NAV qualifies at all, the market
 *     VOIDS instead of resolving (full refunds via claim), so this
 *     keeper calls voidMarket(marketId). See the factory-surface
 *     assumptions flagged in stockMarketReader.ts.
 *   - CANDIDATES COME FROM A BOUNDED ON-CHAIN SCAN, not Supabase. The
 *     crypto keeper prefers the Supabase `markets` index, but that
 *     index is written by the crypto SocialIndexer for the crypto
 *     factory only; no stock market indexer exists. The fallback the
 *     crypto keeper itself uses is copied instead: a rotating scan of
 *     the newest 50 markets per pass (FALLBACK_SCAN_LIMIT), with the
 *     per-market state re-read through the reader's 10s cache. Never
 *     an unbounded scan, never a log scan per cycle. If a stock
 *     market indexer is ever built, prefer it here exactly like the
 *     crypto keeper does.
 *
 * THE RESOLVE/VOID DECISION (stockListService.decideResolutionNav,
 * which see for the full rule): the resolution NAV is the last NAV
 * published at or before the deadline (from the list service's NAV
 * history, so a post-deadline publish can never leak in). Fresh
 * (within 1h before the deadline): resolve. Older but within the
 * league's 24h LAST_NAV_FALLBACK bound and the feed is healthy:
 * resolve with the fallback, logged. No qualifying NAV and the feed
 * is healthy: void. Feed unhealthy and the answer would depend on
 * the fallback or on absence: DEFER, retry next pass, because an
 * outage must never be mistaken for a quiet feed, and voiding a
 * resolvable market on our own downtime would refund a market that
 * should have paid out.
 *
 * RPC AND SIGNING follow the stock stack's pattern, not the crypto
 * one: reads and writes go through the stock fallback transport
 * (createStockPublicClient / createStockFallbackTransport from
 * services/stockSnapshotSubmitter.ts), and the signer key comes from
 * stockConfig (via stockMarketConfig's re-export). Constructing the
 * keeper without a signer key fails fast, exactly like the stock
 * snapshot submitter; read-only services never need it.
 */

import {
  createWalletClient,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { stockConfig } from "../stockConfig.js";
import {
  stockMarketConfig,
  stockMarketConfigured,
  createStockMarketPublicClient,
  stockMarketChain,
  stockMarketSignerPrivateKey,
} from "../stockMarketConfig.js";
import { logger } from "../lib/logger.js";
import { runLoop, type LoopHandle } from "../lib/loop.js";
import { createStockFallbackTransport } from "./stockSnapshotSubmitter.js";
import {
  STOCK_MARKET_FACTORY_ABI,
  type StockMarketReader,
  type StockMarketSummary,
} from "./stockMarketReader.js";
import {
  decideResolutionNav,
  type ResolutionNavDecision,
  type ResolutionNavTick,
  type StockListService,
} from "./stockListService.js";
import { getStockTeamByContract } from "./stockTeams.js";
import type { StockPriceFeed } from "./stockPriceFeed.js";

/** Serializes async work so only one tx is in flight per signer. */
class TxQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

/** Max markets the bounded on-chain scan inspects per pass. Copied
 *  from factoryKeeper.ts (FALLBACK_SCAN_LIMIT). */
const FALLBACK_SCAN_LIMIT = 50n;

export class StockMarketKeeper {
  private readonly listService: StockListService;
  private readonly reader: StockMarketReader;
  private readonly priceFeed: StockPriceFeed | undefined;
  private readonly factory: `0x${string}`;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: PrivateKeyAccount;
  private readonly chain: Chain;
  private static readonly queue = new TxQueue();
  private loop: LoopHandle | null = null;
  private scanCursor: bigint | null = null;

  constructor(
    listService: StockListService,
    reader: StockMarketReader,
    priceFeed?: StockPriceFeed
  ) {
    const signerKey = stockMarketSignerPrivateKey();
    if (!signerKey) {
      throw new Error(
        "[StockMarketKeeper] Missing BACKEND_SIGNER_PRIVATE_KEY (see .env.example)"
      );
    }
    this.listService = listService;
    this.reader = reader;
    this.priceFeed = priceFeed;
    this.factory = stockMarketConfig.factoryAddress;
    this.chain = stockMarketChain();
    this.publicClient = createStockMarketPublicClient();
    this.account = privateKeyToAccount(signerKey);
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: createStockFallbackTransport(),
    }) as WalletClient;
  }

  start(): void {
    if (!stockMarketConfigured()) {
      logger.info("[StockMarketKeeper] STOCK_MARKET_FACTORY_ADDRESS not set, keeper idle");
      return;
    }
    if (!stockMarketConfig.keeper.enabled) {
      logger.info("[StockMarketKeeper] disabled via STOCK_MARKET_KEEPER_ENABLED=false");
      return;
    }
    const intervalMs = stockMarketConfig.keeper.intervalMinutes * 60 * 1000;
    logger.info("[StockMarketKeeper] starting", {
      intervalMinutes: stockMarketConfig.keeper.intervalMinutes,
      maxPerPass: stockMarketConfig.keeper.maxPerPass,
      candidateSource: "on-chain-bounded-scan",
      factory: this.factory,
    });
    this.loop = runLoop("stock-market-keeper", intervalMs, () => this.resolveDueMarkets());
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }

  private async resolveDueMarkets(): Promise<void> {
    const factory = this.factory;
    if (!factory) {
      logger.warn("[StockMarketKeeper] no stock market factory address configured, skipping");
      return;
    }

    const candidates = await this.candidatesFromChain(factory);
    if (candidates.length === 0) return;

    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    let attempted = 0;
    let resolved = 0;
    let voided = 0;
    let deferred = 0;

    for (const id of candidates) {
      if (attempted >= stockMarketConfig.keeper.maxPerPass) break;
      let market: StockMarketSummary;
      try {
        market = await this.reader.getMarket(Number(id));
      } catch (err) {
        logger.warn("[StockMarketKeeper] market read failed", {
          marketId: id.toString(),
          error: String(err),
        });
        continue;
      }
      if (market.state !== 0) continue; // already resolved or voided
      if (market.endTime > nowSec) continue; // deadline not reached yet

      const decision = this.resolutionNav(market, nowMs);
      if (decision.action === "defer") {
        deferred++;
        logger.info("[StockMarketKeeper] decision deferred", {
          marketId: id.toString(),
          symbol: market.symbol,
          reason: decision.reason,
        });
        continue;
      }

      attempted++;
      try {
        if (decision.action === "resolve") {
          const hash = await StockMarketKeeper.queue.enqueue(() =>
            this.walletClient.writeContract({
              address: factory,
              abi: STOCK_MARKET_FACTORY_ABI,
              functionName: "resolve",
              args: [id, decision.scaled as bigint],
              chain: this.chain,
              account: this.account,
            })
          );
          resolved++;
          this.reader.markMarketDirty(id);
          logger.info("[StockMarketKeeper] market resolved", {
            marketId: id.toString(),
            symbol: market.symbol,
            targetPrice: market.targetPrice,
            above: market.above,
            finalPrice: decision.navPrice,
            finalPriceScaled: decision.scaled?.toString(),
            usedLastNavFallback: decision.usedFallback ?? false,
            navAgeAtDeadlineMs: decision.ageAtDeadlineMs ?? null,
            reason: decision.reason,
            txHash: hash,
          });
        } else {
          const hash = await StockMarketKeeper.queue.enqueue(() =>
            this.walletClient.writeContract({
              address: factory,
              abi: STOCK_MARKET_FACTORY_ABI,
              functionName: "voidMarket",
              args: [id],
              chain: this.chain,
              account: this.account,
            })
          );
          voided++;
          this.reader.markMarketDirty(id);
          logger.warn("[StockMarketKeeper] market VOIDED, no qualifying NAV (stakes refund via claim)", {
            marketId: id.toString(),
            symbol: market.symbol,
            reason: decision.reason,
            txHash: hash,
          });
        }
      } catch (err) {
        // AlreadySettled / MarketNotOpen: a bounty hunter (or a
        // concurrent keeper pass) settled it first. Expected, quiet.
        const msg = String(err);
        if (!msg.includes("AlreadySettled") && !msg.includes("MarketNotOpen")) {
          logger.error("[StockMarketKeeper] settlement failed", {
            marketId: id.toString(),
            action: decision.action,
            error: msg,
          });
        }
      }
    }

    if (attempted > 0 || deferred > 0) {
      logger.info("[StockMarketKeeper] pass complete", { attempted, resolved, voided, deferred });
    }
  }

  /**
   * Bounded on-chain candidate scan: the newest FALLBACK_SCAN_LIMIT
   * markets, rotating a cursor so older markets are revisited across
   * passes. Copied from factoryKeeper.candidatesFromChain.
   */
  private async candidatesFromChain(factory: `0x${string}`): Promise<bigint[]> {
    const count = (await this.publicClient.readContract({
      address: factory,
      abi: STOCK_MARKET_FACTORY_ABI,
      functionName: "marketCount",
    })) as bigint;
    if (count === 0n) return [];
    const ids: bigint[] = [];
    let id = this.scanCursor === null || this.scanCursor >= count ? count - 1n : this.scanCursor;
    const limit = count < FALLBACK_SCAN_LIMIT ? count : FALLBACK_SCAN_LIMIT;
    for (let scanned = 0n; scanned < limit; scanned++) {
      ids.push(id);
      id = id === 0n ? count - 1n : id - 1n;
    }
    this.scanCursor = id;
    return ids;
  }

  /**
   * The resolution NAV for one market: the last NAV published at or
   * before the deadline, decided by decideResolutionNav.
   *
   * Sources, in order:
   *   1. The list service's NAV history (the full dynamic list; the
   *      only source that covers non-roster stocks).
   *   2. For league-roster tokens, the league StockPriceFeed's
   *      checkLastNavFallback tick (the league's own NAV poller may
   *      hold a tick this service has not ingested yet, and the two
   *      pollers read the same API). Only a tick published at or
   *      before the deadline is considered, and only when it is newer
   *      than the list service's candidate.
   * Feed health is the list service's (its poller IS the keeper's
   * source); the league poller's health is not consulted separately.
   */
  private resolutionNav(market: StockMarketSummary, nowMs: number): ResolutionNavDecision {
    const deadlineMs = market.endTime * 1000;
    let candidate: ResolutionNavTick | undefined;
    const listTick = this.listService.getNavAtOrBefore(market.token, deadlineMs);
    if (listTick) {
      candidate = {
        navPrice: listTick.navPrice,
        updatedAtMs: listTick.updatedAtMs,
        updatedAtIso: listTick.updatedAtIso,
      };
    }
    if (this.priceFeed) {
      const team = getStockTeamByContract(market.token);
      if (team) {
        // The league check with the deadline as both window bounds:
        // its tick is the league poller's latest NAV, and its
        // conditions (published before the deadline instant, age at
        // the deadline) are exactly the ones this decision needs.
        // Eligibility is NOT reused: decideResolutionNav applies the
        // bounds itself against the merged candidate set.
        const check = this.priceFeed.checkLastNavFallback(team.teamId, deadlineMs, deadlineMs);
        if (check.tick && check.tick.navPriceUpdatedAtMs <= deadlineMs) {
          const leagueTick: ResolutionNavTick = {
            navPrice: check.tick.navPrice,
            updatedAtMs: check.tick.navPriceUpdatedAtMs,
            updatedAtIso: check.tick.navPriceUpdatedAtIso,
          };
          if (!candidate || leagueTick.updatedAtMs > candidate.updatedAtMs) {
            candidate = leagueTick;
          }
        }
      }
    }
    const latest = this.listService.getLatestNav(market.token);
    return decideResolutionNav({
      tickAtDeadline: candidate,
      latestTick: latest
        ? {
            navPrice: latest.navPrice,
            updatedAtMs: latest.updatedAtMs,
            updatedAtIso: latest.updatedAtIso,
          }
        : undefined,
      deadlineMs,
      nowMs,
      feedHealthy: this.listService.isFeedHealthy(stockConfig.nav.feedHealthyWithinMs, nowMs),
    });
  }
}
