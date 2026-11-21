/**
 * Arena keeper: snapshots, resolutions, debut clashes, and the pass
 * that drives the cup seeder and the commentary scope check.
 *
 * Intended destination: packages/backend/src/services/arenaKeeper.ts.
 * Mirrors services/stockMarketKeeper.ts pattern for pattern:
 *   - A background pass on lib/loop.ts (non-overlapping, backoff on
 *     failure), every ARENA_KEEPER_INTERVAL_MINUTES (default 15,
 *     mirroring STOCK_MARKET_KEEPER_INTERVAL_MINUTES).
 *   - Gas-bounded: at most ARENA_KEEPER_MAX_PER_PASS clashes attempted
 *     per pass (default 10).
 *   - All writes serialized through one TxQueue per signer, so only
 *     one transaction is in flight at a time.
 *   - It never acts before a clash's window boundary, and never
 *     touches a clash whose state is not Open (the per-clash state is
 *     re-read through the reader before every write).
 *   - Failed attempts whose revert is expected (AlreadySettled,
 *     ClashNotOpen) are skipped quietly; anything else is logged at
 *     ERROR.
 *   - Disable with ARENA_KEEPER_ENABLED=false.
 *
 * DUTIES:
 *   (a) SNAPSHOTS. At windowStart, record the start prices; at
 *       windowEnd, record the end prices. Meme prices come from the
 *       registry (priceUsd); a stock opponent's price is its NAV from
 *       the stock list service by token address (the same NAV the
 *       stock keeper resolves on; for league-roster tokens the list
 *       service and the league NAV poller read the same API). Prices
 *       are converted with priceToScaled (lib/priceMath.ts, 1e8) and
 *       persisted to Supabase arena_clash_snapshots (clash_id, phase,
 *       meme_price, opp_price, captured_at), so a restart never loses
 *       a start price: resolution reads the persisted pair, never a
 *       re-derived one.
 *   (b) RESOLUTION. After windowEnd, with both snapshot pairs present:
 *       any missing or zero price means voidClash (a clash must never
 *       resolve on a fabricated price). Otherwise the moves are
 *       precomputed locally with the reader's percentMove: an exact
 *       tie on a cupTie clash is detected BEFORE sending (resolve
 *       would revert), and the cup tiebreak applies instead: the two
 *       memes' volume24hUsd as recorded by the registry at window end
 *       (persisted on the end snapshot row), higher volume wins; still
 *       exactly equal, the higher seed (lower seed number, from the
 *       cup tie record) wins; then resolveCupTie. A non-tie clash
 *       goes through resolve(); if the factory voids it via the
 *       breaker (|move| >= 30 percent on either side), that is final
 *       for open clashes, and for cup ties the cup service's replay
 *       hook runs (see (c)).
 *   (c) CUP REPLAY. After any resolution or void of a cup clash, the
 *       outcome is reported to the cup service: onClashResolved for a
 *       settled winner, onClashVoided for a void. The cup service
 *       owns the replay state machine (recreate once, then advance
 *       the higher seed with no rating change). The keeper also calls
 *       the cup service's tick() each pass, which is where the Monday
 *       seeding boundary is detected.
 *   (d) DEBUT LOOP. The keeper subscribes to the registry's "launch"
 *       events. For each new launch with a resolvable paired stock
 *       and liquidity at or above the floor, it creates the debut
 *       clash (opponentKind Stock, 24h, cupTie false, creatorName
 *       "TICKR Arena") from the backend signer, skipping when an
 *       active clash for the same (meme, opponent, duration) already
 *       exists. Every skip is logged with its reason.
 *   (e) FEATURED. Featured flags live in arena_featured_clashes,
 *       managed by TICKR out of band. The keeper only READS them,
 *       through the cup service, for the commentary scope check.
 *
 * RPC AND SIGNING follow the stock stack's pattern: reads and writes
 * go through the stock fallback transport, and the signer key comes
 * from stockConfig (via arenaConfig's re-export). Constructing the
 * keeper without a signer key fails fast; read-only services never
 * need it.
 */

import {
  createWalletClient,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  arenaConfig,
  arenaConfigured,
  createArenaPublicClient,
  arenaChain,
  arenaSignerPrivateKey,
} from "../arenaConfig.js";
import { logger } from "../lib/logger.js";
import { runLoop, type LoopHandle } from "../lib/loop.js";
import { priceToScaled, scaledToPrice } from "../lib/priceMath.js";
import { createStockFallbackTransport } from "./stockSnapshotSubmitter.js";
import {
  MEME_CLASH_FACTORY_ABI,
  percentMove,
  type ArenaClashReader,
  type ArenaClashSummary,
} from "./arenaClashReader.js";
import type { ArenaRegistryService } from "./arenaRegistryService.js";
import type { StockListService } from "./stockListService.js";
import type { ArenaCupService } from "./arenaCupService.js";

/** Serializes async work so only one tx is in flight per signer. */
class TxQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

/** Max clashes the bounded on-chain scan inspects per pass. Copied
 *  from stockMarketKeeper.ts (FALLBACK_SCAN_LIMIT). */
const FALLBACK_SCAN_LIMIT = 50n;

export interface ArenaSnapshotRow {
  clashId: number;
  phase: "start" | "end";
  /** Decimal USD strings, exactly as captured. */
  memePrice: string;
  oppPrice: number | string;
  /** Registry volume24hUsd of both memes at capture (cup tiebreak). */
  memeVolume24hUsd: number | null;
  oppVolume24hUsd: number | null;
  capturedAt: string;
}

export interface ArenaKeeperDeps {
  registry: ArenaRegistryService;
  reader: ArenaClashReader;
  /** The dynamic stock list: stock opponent NAV by token address. */
  stockList: StockListService | null;
  /** Supabase (service role) for snapshots and featured reads. */
  db: SupabaseClient | null;
  /** The cup engine (resolution routing, replays, seeding tick). */
  cupService: ArenaCupService | null;
  /** Optional commentary driver: ticked each pass with the live
   *  clashes (it self-filters to its strict scope). */
  commentary?: { tick(clashes: ArenaClashSummary[]): Promise<void> } | null;
}

export class ArenaKeeper {
  private readonly registry: ArenaRegistryService;
  private readonly reader: ArenaClashReader;
  private readonly stockList: StockListService | null;
  private readonly db: SupabaseClient | null;
  private readonly cupService: ArenaCupService | null;
  private readonly commentary: ArenaKeeperDeps["commentary"];
  private readonly factory: `0x${string}`;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: PrivateKeyAccount;
  private readonly chain: Chain;
  private static readonly queue = new TxQueue();
  private loop: LoopHandle | null = null;
  private scanCursor: bigint | null = null;
  private debutListener: ((entry: import("./arenaRegistryService.js").ArenaRegistryEntry) => void) | null = null;

  constructor(deps: ArenaKeeperDeps) {
    const signerKey = arenaSignerPrivateKey();
    if (!signerKey) {
      throw new Error("[ArenaKeeper] Missing BACKEND_SIGNER_PRIVATE_KEY (see .env.example)");
    }
    this.registry = deps.registry;
    this.reader = deps.reader;
    this.stockList = deps.stockList;
    this.db = deps.db;
    this.cupService = deps.cupService;
    this.commentary = deps.commentary ?? null;
    this.factory = arenaConfig.factoryAddress;
    this.chain = arenaChain();
    this.publicClient = createArenaPublicClient();
    this.account = privateKeyToAccount(signerKey);
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: createStockFallbackTransport(),
    }) as WalletClient;
  }

  start(): void {
    if (!arenaConfigured()) {
      logger.info("[ArenaKeeper] ARENA_CLASH_FACTORY_ADDRESS not set, keeper idle");
      return;
    }
    if (!arenaConfig.keeper.enabled) {
      logger.info("[ArenaKeeper] disabled via ARENA_KEEPER_ENABLED=false");
      return;
    }
    const intervalMs = arenaConfig.keeper.intervalMinutes * 60 * 1000;
    logger.info("[ArenaKeeper] starting", {
      intervalMinutes: arenaConfig.keeper.intervalMinutes,
      maxPerPass: arenaConfig.keeper.maxPerPass,
      factory: this.factory,
    });
    // Debut loop: subscribe once; launches that arrive while the
    // keeper is down are covered by the registry's boot window.
    this.debutListener = (entry) => {
      void this.maybeCreateDebut(entry).catch((err) => {
        logger.error("[ArenaKeeper] debut clash failed", { address: entry.address, error: String(err) });
      });
    };
    this.registry.on("launch", this.debutListener);
    this.loop = runLoop("arena-keeper", intervalMs, () => this.pass());
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
    if (this.debutListener) this.registry.off("launch", this.debutListener);
    this.debutListener = null;
  }

  // ---------------------------------------------------------- prices

  /** Current price for one side of a clash, by token and kind. Memes
   *  read the registry; stocks read the stock list NAV. Returns a
   *  decimal string, or null when no usable price exists. A missing
   *  price is never a zero. */
  currentPrice(tokenAddress: string, kind: "stock" | "meme"): string | null {
    if (kind === "meme") {
      const price = this.registry.getPriceUsd(tokenAddress);
      return price !== null ? String(price) : null;
    }
    const stock = this.stockList?.getStockByAddress(tokenAddress);
    return stock && stock.hasNav ? stock.navPrice : null;
  }

  /** The live price provider the reader uses for in-play moves:
   *  start snapshots from the persisted snapshot rows. */
  async getStartSnapshots(clashId: number): Promise<{ memePrice: number; oppPrice: number } | null> {
    const row = await this.loadSnapshot(clashId, "start");
    if (!row) return null;
    const memePrice = Number(row.memePrice);
    const oppPrice = Number(row.oppPrice);
    if (!(memePrice > 0) || !(oppPrice > 0)) return null;
    return { memePrice, oppPrice };
  }

  // ---------------------------------------------------------- snapshots

  private async loadSnapshot(clashId: number, phase: "start" | "end"): Promise<ArenaSnapshotRow | null> {
    if (!this.db) return null;
    const { data, error } = await this.db
      .from("arena_clash_snapshots")
      .select("clash_id,phase,meme_price,opp_price,meme_volume24h_usd,opp_volume24h_usd,captured_at")
      .eq("clash_id", clashId)
      .eq("phase", phase)
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return null;
    const row = data[0];
    return {
      clashId: Number(row.clash_id),
      phase: row.phase as "start" | "end",
      memePrice: String(row.meme_price),
      oppPrice: String(row.opp_price),
      memeVolume24hUsd: row.meme_volume24h_usd === null ? null : Number(row.meme_volume24h_usd),
      oppVolume24hUsd: row.opp_volume24h_usd === null ? null : Number(row.opp_volume24h_usd),
      capturedAt: String(row.captured_at),
    };
  }

  /** Capture one phase's prices for a clash if not already recorded.
   *  Returns the persisted row, or null when a price is missing (the
   *  caller decides: a missing start retries next pass, a missing end
   *  at resolution time voids). */
  private async captureSnapshot(clash: ArenaClashSummary, phase: "start" | "end"): Promise<ArenaSnapshotRow | null> {
    const existing = await this.loadSnapshot(clash.id, phase);
    if (existing) return existing;
    const memePrice = this.currentPrice(clash.memeToken, "meme");
    const oppPrice = this.currentPrice(clash.opponentToken, clash.opponentKind);
    if (memePrice === null || oppPrice === null) {
      logger.warn("[ArenaKeeper] snapshot price missing", {
        clashId: clash.id,
        phase,
        memePrice,
        oppPrice,
      });
      return null;
    }
    const memeEntry = this.registry.getMemeByAddress(clash.memeToken);
    const oppEntry = clash.opponentKind === "meme" ? this.registry.getMemeByAddress(clash.opponentToken) : undefined;
    const row: ArenaSnapshotRow = {
      clashId: clash.id,
      phase,
      memePrice,
      oppPrice,
      memeVolume24hUsd: memeEntry?.volume24hUsd ?? null,
      oppVolume24hUsd: oppEntry?.volume24hUsd ?? null,
      capturedAt: new Date().toISOString(),
    };
    if (this.db) {
      const { error } = await this.db.from("arena_clash_snapshots").upsert(
        {
          clash_id: row.clashId,
          phase: row.phase,
          meme_price: row.memePrice,
          opp_price: row.oppPrice,
          meme_volume24h_usd: row.memeVolume24hUsd,
          opp_volume24h_usd: row.oppVolume24hUsd,
          captured_at: row.capturedAt,
        },
        { onConflict: "clash_id,phase" }
      );
      if (error) throw error;
    }
    logger.info("[ArenaKeeper] snapshot captured", {
      clashId: clash.id,
      phase,
      memePrice,
      oppPrice,
    });
    return row;
  }

  // ---------------------------------------------------------- the pass

  private async pass(): Promise<void> {
    const factory = this.factory;
    if (!factory) return;

    // Cup seeding boundary: checked every pass (idempotent).
    if (this.cupService) {
      await this.cupService.tick().catch((err) => {
        logger.error("[ArenaKeeper] cup seeding tick failed", { error: String(err) });
      });
    }

    const candidates = await this.candidatesFromChain(factory);
    if (candidates.length === 0) return;

    const nowSec = Math.floor(Date.now() / 1000);
    let attempted = 0;

    for (const id of candidates) {
      let clash: ArenaClashSummary;
      try {
        clash = await this.reader.getClash(Number(id));
      } catch (err) {
        logger.warn("[ArenaKeeper] clash read failed", { clashId: id.toString(), error: String(err) });
        continue;
      }

      // Commentary scope check runs on every live clash regardless of
      // the write budget (it self-filters to SF/F and featured).
      if (this.commentary && clash.state === 0) {
        await this.commentary.tick([clash]).catch((err) => {
          logger.warn("[ArenaKeeper] commentary tick failed", { clashId: clash.id, error: String(err) });
        });
      }

      if (clash.state !== 0) {
        // A settled cup clash the cup service has not heard about yet
        // (for example a bounty hunter resolved it): route it once.
        // The cup service dedupes by tie status.
        if (clash.cupTie && this.cupService) {
          if (clash.state === 1 && clash.winner !== null) {
            await this.cupService.onClashResolved(clash.id, clash.winner).catch(() => {});
          } else if (clash.state === 2) {
            await this.cupService.onClashVoided(clash.id).catch(() => {});
          }
        }
        continue;
      }
      if (attempted >= arenaConfig.keeper.maxPerPass) continue;

      // (a) Start snapshot at windowStart.
      if (nowSec >= clash.windowStart && nowSec < clash.windowEnd) {
        await this.captureSnapshot(clash, "start").catch((err) => {
          logger.error("[ArenaKeeper] start snapshot failed", { clashId: clash.id, error: String(err) });
        });
        continue;
      }
      if (nowSec < clash.windowEnd) continue;

      // Window over: end snapshot, then resolution.
      attempted++;
      try {
        await this.captureSnapshot(clash, "start");
        const end = await this.captureSnapshot(clash, "end");
        const start = await this.loadSnapshot(clash.id, "start");
        await this.resolveClash(clash, start, end);
      } catch (err) {
        const msg = String(err);
        if (!msg.includes("AlreadySettled") && !msg.includes("ClashNotOpen")) {
          logger.error("[ArenaKeeper] resolution failed", { clashId: clash.id, error: msg });
        }
      }
    }
  }

  /** Bounded on-chain candidate scan, copied from the stock market
   *  keeper: the newest FALLBACK_SCAN_LIMIT clashes, rotating. */
  private async candidatesFromChain(factory: `0x${string}`): Promise<bigint[]> {
    const count = (await this.publicClient.readContract({
      address: factory,
      abi: MEME_CLASH_FACTORY_ABI,
      functionName: "clashCount",
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

  // ---------------------------------------------------------- resolution

  private async resolveClash(
    clash: ArenaClashSummary,
    start: ArenaSnapshotRow | null,
    end: ArenaSnapshotRow | null
  ): Promise<void> {
    const factory = this.factory;
    const id = BigInt(clash.id);

    // Missing or zero price on any side: void, never fabricate.
    const prices = [start?.memePrice, start?.oppPrice, end?.memePrice, end?.oppPrice];
    if (!start || !end || prices.some((p) => p === undefined || p === null || Number(p) <= 0)) {
      const hash = await ArenaKeeper.queue.enqueue(() =>
        this.walletClient.writeContract({
          address: factory,
          abi: MEME_CLASH_FACTORY_ABI,
          functionName: "voidClash",
          args: [id],
          chain: this.chain,
          account: this.account,
        })
      );
      this.reader.markClashDirty(id);
      logger.warn("[ArenaKeeper] clash VOIDED, missing snapshot price (stakes refund via claim)", {
        clashId: clash.id,
        hasStart: Boolean(start),
        hasEnd: Boolean(end),
        txHash: hash,
      });
      if (clash.cupTie && this.cupService) await this.cupService.onClashVoided(clash.id);
      return;
    }

    const memeStart = priceToScaled(start.memePrice);
    const memeEnd = priceToScaled(end.memePrice);
    const oppStart = priceToScaled(String(start.oppPrice));
    const oppEnd = priceToScaled(String(end.oppPrice));
    const memeMove = percentMove(memeStart, memeEnd);
    const oppMove = percentMove(oppStart, oppEnd);

    // Cup tie on an exact move tie: resolve() would revert, so apply
    // the cup tiebreak and call resolveCupTie instead.
    if (clash.cupTie && memeMove === oppMove) {
      const memeWins = await this.cupTiebreakWinner(clash, end);
      const hash = await ArenaKeeper.queue.enqueue(() =>
        this.walletClient.writeContract({
          address: factory,
          abi: MEME_CLASH_FACTORY_ABI,
          functionName: "resolveCupTie",
          args: [id, memeStart, memeEnd, oppStart, oppEnd, memeWins],
          chain: this.chain,
          account: this.account,
        })
      );
      this.reader.markClashDirty(id);
      logger.info("[ArenaKeeper] cup tie resolved by tiebreak", {
        clashId: clash.id,
        memeMove,
        oppMove,
        memeWins,
        txHash: hash,
      });
      if (this.cupService) await this.cupService.onClashResolved(clash.id, memeWins ? 0 : 1);
      return;
    }

    const hash = await ArenaKeeper.queue.enqueue(() =>
      this.walletClient.writeContract({
        address: factory,
        abi: MEME_CLASH_FACTORY_ABI,
        functionName: "resolve",
        args: [id, memeStart, memeEnd, oppStart, oppEnd],
        chain: this.chain,
        account: this.account,
      })
    );
    this.reader.markClashDirty(id);
    logger.info("[ArenaKeeper] clash resolved", {
      clashId: clash.id,
      memeMovePct: memeMove,
      oppMovePct: oppMove,
      memeStart: scaledToPrice(memeStart),
      memeEnd: scaledToPrice(memeEnd),
      txHash: hash,
    });

    // Report the outcome: the factory may have voided via the breaker
    // instead of resolving, so re-read the settled state.
    if (clash.cupTie && this.cupService) {
      const settled = await this.reader.getClash(clash.id).catch(() => null);
      if (settled && settled.state === 2) {
        await this.cupService.onClashVoided(clash.id);
      } else if (settled && settled.state === 1 && settled.winner !== null) {
        await this.cupService.onClashResolved(clash.id, settled.winner);
      }
    }
  }

  /**
   * The cup tiebreak for an exact move tie: higher registry
   * volume24hUsd at window end wins (read from the end snapshot row,
   * which recorded both memes' volumes at capture); still exactly
   * equal, the higher seed (lower seed number) advances.
   * Returns true when the clash's meme (tie side A) wins.
   */
  private async cupTiebreakWinner(clash: ArenaClashSummary, end: ArenaSnapshotRow): Promise<boolean> {
    const memeVolume = end.memeVolume24hUsd ?? this.registry.getMemeByAddress(clash.memeToken)?.volume24hUsd ?? 0;
    const oppVolume = end.oppVolume24hUsd ?? this.registry.getMemeByAddress(clash.opponentToken)?.volume24hUsd ?? 0;
    if (memeVolume !== oppVolume) {
      logger.info("[ArenaKeeper] cup tiebreak by window-end volume", {
        clashId: clash.id,
        memeVolume,
        oppVolume,
      });
      return memeVolume > oppVolume;
    }
    if (this.cupService) {
      const tie = await this.cupService.getTieForClash(clash.id).catch(() => null);
      if (tie && tie.seedA !== null && tie.seedB !== null) {
        logger.info("[ArenaKeeper] cup tiebreak by seed (volumes equal)", {
          clashId: clash.id,
          seedA: tie.seedA,
          seedB: tie.seedB,
        });
        return tie.seedA < tie.seedB;
      }
    }
    // No tie record and equal volumes: the clash meme is side A of
    // its tie by construction, so defaulting to A matches the
    // higher-seed convention whenever A was seeded first.
    return true;
  }

  // ---------------------------------------------------------- debut loop

  /**
   * Debut clash for one new launch. Skips, each logged with its
   * reason: no resolvable paired stock, liquidity below the floor, no
   * live price, or an active clash already exists for the same
   * (meme, opponent, duration).
   */
  private async maybeCreateDebut(entry: import("./arenaRegistryService.js").ArenaRegistryEntry): Promise<void> {
    const skip = (reason: string) => {
      logger.info("[ArenaKeeper] debut clash skipped", { address: entry.address, symbol: entry.symbol, reason });
    };
    if (!entry.pairedStock) return skip("no resolvable paired stock");
    if (entry.priceUsd === null) return skip("no live price");
    if (entry.liquidityUsd < arenaConfig.creation.minLiquidityUsd) {
      return skip(`liquidity ${Math.round(entry.liquidityUsd)} below floor ${arenaConfig.creation.minLiquidityUsd}`);
    }
    const { clashes } = await this.reader.getClashes();
    const duplicate = clashes.some(
      (c) =>
        c.state === 0 &&
        c.memeToken.toLowerCase() === entry.address.toLowerCase() &&
        c.opponentToken.toLowerCase() === entry.pairedStock!.address.toLowerCase() &&
        c.windowDuration === arenaConfig.windows.standardSeconds
    );
    if (duplicate) return skip("active clash already exists for this meme, opponent and duration");

    const id = BigInt(
      Number(
        (await this.publicClient.readContract({
          address: this.factory,
          abi: MEME_CLASH_FACTORY_ABI,
          functionName: "clashCount",
        })) as bigint
      )
    );
    const hash = await ArenaKeeper.queue.enqueue(() =>
      this.walletClient.writeContract({
        address: this.factory,
        abi: MEME_CLASH_FACTORY_ABI,
        functionName: "createClash",
        args: [
          entry.address as `0x${string}`,
          entry.symbol,
          0,
          entry.pairedStock!.address as `0x${string}`,
          entry.pairedStock!.symbol,
          BigInt(arenaConfig.windows.standardSeconds),
          false,
          "TICKR Arena",
        ],
        chain: this.chain,
        account: this.account,
      })
    );
    this.reader.markClashDirty(id);
    logger.info("[ArenaKeeper] debut clash created", {
      clashId: id.toString(),
      meme: entry.symbol,
      opponent: entry.pairedStock.symbol,
      txHash: hash,
    });
  }

  /** Featured clash ids, read for the reader and commentary. The
   *  flags are managed out of band; the keeper never writes them. */
  async getFeaturedClashIds(): Promise<Set<number>> {
    if (this.cupService) return this.cupService.getFeaturedClashIds();
    if (!this.db) return new Set();
    const { data, error } = await this.db.from("arena_featured_clashes").select("clash_id");
    if (error) throw error;
    return new Set((data ?? []).map((r) => Number(r.clash_id)));
  }
}
