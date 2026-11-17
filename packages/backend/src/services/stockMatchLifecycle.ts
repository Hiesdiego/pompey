/**
 * Stock match lifecycle — kickoff monitor + match timer for the stock league.
 *
 * Intended destination: packages/backend/src/services/stockMatchLifecycle.ts.
 * Mirrors the crypto MatchLifecycle (reveal -> start snapshot -> end
 * snapshot, idempotency pre-checks, per-fixture exponential backoff, one
 * fixture failing never blocks the others, TxQueue serializes writes) with
 * four stock differences:
 *
 *   1. EVENT-DRIVEN, not a 30s tick loop. The crypto loop ticks every
 *      30s all day; the stock loop sleeps until the next event (next
 *      window opening, next kickoff, next full-time), capped at 15 min
 *      idle / 60s hot so the NAV hot window still turns over. A 30s
 *      tick would burn RPC reads and log noise for 21 matchdays with
 *      nothing happening between them. Sleep is via a single setTimeout
 *      that is re-armed after every pass; stop() clears it.
 *   2. RANDOM STAGGER, restart-safe. A matchday lasts 1 day and its 11
 *      fixtures kick off at random slots across the day (1-hour matches,
 *      all ending the same day). The slot is a stable hash of
 *      (seasonId, matchdayIndex, fixtureId), NOT Math.random() and NOT
 *      fixture order: a restart re-derives the exact same kickoff times
 *      instead of double-scheduling, while the spread still looks random
 *      to users. Legal reveal still requires kickoff within [now+30min,
 *      now+120min] AND inside the fixture's window; an illegal slot is
 *      flagged for manual review, never sent as a doomed tx.
 *   3. HOT-ONLY REFRESH. The fixture cache re-reads only fixtures that
 *      can still change (unrevealed or unsettled), in multicall chunks
 *      of 50, and only on passes that do work. Revealed+settled fixtures
 *      are immutable and cached forever. Idle passes do not re-read the
 *      chain at all.
 *   4. FORFEIT, decided at FULL-TIME. At kickoff the lifecycle submits
 *      the start snapshot from the latest NAV (25h pricing bound). If
 *      NAV is stale at kickoff, the snapshot is BLOCKED (like crypto)
 *      and the fixture waits; nothing is fabricated. At FT the lifecycle
 *      checks, per team, whether a NAV was published inside the match
 *      window [kickoff, FT + grace] (StockPriceFeed.isWindowFresh):
 *        - one team with no performance -> submitter.recordForfeit,
 *          opponent wins 3-0, marked FORFEIT. Never a silent normal 3-0.
 *        - both teams with no performance -> submitter.voidFixture,
 *          stakes refunded 1:1.
 *        - both performed -> normal end snapshot (with late-start
 *          recovery if the start was missed while the backend was down).
 *      A forfeit/void failure is logged at ERROR and the fixture is
 *      retried with backoff; it is never settled as a normal result.
 *
 * NAV hot window: the lifecycle owns it. Hot from 30 min before the
 * first kickoff of the day until the last full-time + 15 min, idle
 * otherwise (StockNavPoller.setHot). The NAV poller must be hot while
 * any match is live, or the FT freshness check reads a cold map.
 *
 * Circuit breaker: a raw +/-30% NAV spike is quarantined by the poller
 * (last good tick kept). If the feed reports a suspect tick for either
 * team at FT, the fixture is flagged for manual review and NOT settled
 * on the spike.
 */

import { stockConfig } from "../stockConfig.js";
import { logger } from "../lib/logger.js";
import type { StockPriceFeed, StockPriceSource } from "./stockPriceFeed.js";
import {
  StockPriceUnavailableError,
  StockPriceValidationError,
} from "./stockPriceFeed.js";
import { StockSnapshotSubmitter, createStockPublicClient } from "./stockSnapshotSubmitter.js";
import type { StockNavPoller } from "./stockNavPoller.js";
import type { PublicClient } from "viem";

const STOCK_REGISTRY_READ_ABI = [
  {
    type: "function",
    name: "fixtureCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getFixture",
    stateMutability: "view",
    inputs: [{ name: "fixtureId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "homeTeamId", type: "uint16" },
          { name: "awayTeamId", type: "uint16" },
          { name: "matchdayIndex", type: "uint8" },
          { name: "windowStart", type: "uint64" },
          { name: "windowEnd", type: "uint64" },
          { name: "kickoffTimestamp", type: "uint64" },
          { name: "kickoffRevealed", type: "bool" },
          { name: "settled", type: "bool" },
          { name: "matchEndTimestamp", type: "uint64" },
        ],
      },
    ],
  },
] as const;

export interface StockFixtureView {
  fixtureId: bigint;
  homeTeamId: number;
  awayTeamId: number;
  matchdayIndex: number;
  windowStartMs: number;
  windowEndMs: number;
  kickoffMs: number; // 0 until revealed
  kickoffRevealed: boolean;
  matchEndMs: number; // 0 until revealed, then kickoff + matchDuration
  settled: boolean;
  /** Set once the lifecycle records a forfeit/void (in-memory; chain is truth). */
  forfeitTeamId?: number;
  voided?: boolean;
}

/** In-memory fixture cache. Revealed+settled fixtures are immutable, cached forever. */
class StockFixtureCache {
  private fixtures = new Map<bigint, StockFixtureView>();

  constructor(private readonly publicClient: PublicClient) {}

  async loadAll(): Promise<void> {
    const count = (await this.publicClient.readContract({
      address: stockConfig.contracts.matchRegistry,
      abi: STOCK_REGISTRY_READ_ABI,
      functionName: "fixtureCount",
    })) as bigint;
    logger.info("[StockFixtureCache] loading fixtures", { count: count.toString() });

    // Multicall in chunks of 50: one RPC request per chunk, kind to
    // public RPC rate limits and to the 1 GB/month budget.
    const CHUNK = 50;
    for (let start = 0n; start < count; start += BigInt(CHUNK)) {
      const end = start + BigInt(CHUNK) > count ? count : start + BigInt(CHUNK);
      const ids: bigint[] = [];
      for (let i = start; i < end; i++) ids.push(i);
      const results = (await this.publicClient.multicall({
        contracts: ids.map((id) => ({
          address: stockConfig.contracts.matchRegistry,
          abi: STOCK_REGISTRY_READ_ABI,
          functionName: "getFixture",
          args: [id],
        })),
        allowFailure: false,
      }) as unknown) as Array<{
        homeTeamId: number;
        awayTeamId: number;
        matchdayIndex: number;
        windowStart: bigint;
        windowEnd: bigint;
        kickoffTimestamp: bigint;
        kickoffRevealed: boolean;
        settled: boolean;
        matchEndTimestamp: bigint;
      }>;
      results.forEach((f, idx) => {
        this.fixtures.set(ids[idx], this.toView(ids[idx], f));
      });
    }
    logger.info("[StockFixtureCache] loaded", { fixtures: this.fixtures.size });
  }

  /** Re-read every fixture that can still change (unrevealed or unsettled). */
  async refresh(): Promise<void> {
    const mutable = [...this.fixtures.values()].filter((f) => !f.settled);
    if (mutable.length === 0) return;
    const CHUNK = 50;
    for (let i = 0; i < mutable.length; i += CHUNK) {
      const chunk = mutable.slice(i, i + CHUNK);
      const results = (await this.publicClient.multicall({
        contracts: chunk.map((f) => ({
          address: stockConfig.contracts.matchRegistry,
          abi: STOCK_REGISTRY_READ_ABI,
          functionName: "getFixture",
          args: [f.fixtureId],
        })),
        allowFailure: false,
      }) as unknown) as Array<{
        homeTeamId: number;
        awayTeamId: number;
        matchdayIndex: number;
        windowStart: bigint;
        windowEnd: bigint;
        kickoffTimestamp: bigint;
        kickoffRevealed: boolean;
        settled: boolean;
        matchEndTimestamp: bigint;
      }>;
      results.forEach((f, idx) => {
        const prev = this.fixtures.get(chunk[idx].fixtureId);
        const view = this.toView(chunk[idx].fixtureId, f);
        // Keep in-memory forfeit/void flags across refreshes.
        if (prev?.forfeitTeamId !== undefined) view.forfeitTeamId = prev.forfeitTeamId;
        if (prev?.voided) view.voided = true;
        this.fixtures.set(chunk[idx].fixtureId, view);
      });
    }
  }

  private toView(
    fixtureId: bigint,
    f: {
      homeTeamId: number;
      awayTeamId: number;
      matchdayIndex: number;
      windowStart: bigint;
      windowEnd: bigint;
      kickoffTimestamp: bigint;
      kickoffRevealed: boolean;
      settled: boolean;
      matchEndTimestamp: bigint;
    }
  ): StockFixtureView {
    const matchEndTimestamp =
      f.matchEndTimestamp > 0n
        ? f.matchEndTimestamp
        : f.kickoffTimestamp > 0n
          ? f.kickoffTimestamp + BigInt(stockConfig.matchDurationMinutes * 60)
          : 0n;
    return {
      fixtureId,
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
      matchdayIndex: f.matchdayIndex,
      windowStartMs: Number(f.windowStart) * 1000,
      windowEndMs: Number(f.windowEnd) * 1000,
      kickoffMs: Number(f.kickoffTimestamp) * 1000,
      kickoffRevealed: f.kickoffRevealed,
      matchEndMs: Number(matchEndTimestamp) * 1000,
      settled: f.settled,
    };
  }

  all(): StockFixtureView[] {
    return [...this.fixtures.values()].sort((a, b) =>
      a.fixtureId < b.fixtureId ? -1 : 1
    );
  }

  get size(): number {
    return this.fixtures.size;
  }
}

/**
 * Stable pseudo-random slot for a fixture: a 32-bit FNV-1a hash of
 * (seasonId, matchdayIndex, fixtureId) mod maxSlots. Deterministic per
 * fixture, uniformly spread across slots, and identical after a restart,
 * so the "random stagger" never double-schedules. Do NOT replace with
 * Math.random(): a restart would re-roll slots and reveal a second,
 * different kickoff for the same fixture.
 */
export function staggerSlotFor(
  fixtureId: bigint,
  matchdayIndex: number,
  maxSlots: number,
  seasonId: bigint = stockConfig.seasonId
): number {
  const key = `${seasonId.toString()}:${matchdayIndex}:${fixtureId.toString()}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return maxSlots > 0 ? hash % maxSlots : 0;
}

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;
/** Longest sleep between passes when nothing is due (idle). */
const IDLE_SLEEP_CAP_MS = 15 * 60_000;
/** Longest sleep between passes while matches are live (hot). */
const HOT_SLEEP_CAP_MS = 60_000;
/** Hot window opens this long before the first kickoff of the day. */
const HOT_LEAD_MS = 30 * 60_000;
/** Hot window closes this long after the last full-time of the day. */
const HOT_TAIL_MS = 15 * 60_000;

interface FailureState {
  count: number;
  nextRetryAtMs: number;
}

export class StockMatchLifecycle {
  private readonly cache: StockFixtureCache;
  private readonly durationMs: number;
  private readonly leadMs: number;
  private readonly failures = new Map<bigint, FailureState>();
  private readonly startSources = new Map<string, { home: StockPriceSource; away: StockPriceSource }>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private running = false;

  constructor(
    private readonly feed: StockPriceFeed,
    private readonly submitter: StockSnapshotSubmitter,
    private readonly navPoller: StockNavPoller,
    publicClient?: PublicClient
  ) {
    this.cache = new StockFixtureCache(publicClient ?? createStockPublicClient());
    this.durationMs = stockConfig.matchDurationMinutes * 60 * 1000;
    this.leadMs = stockConfig.kickoff.leadMinutes * 60 * 1000;
  }

  async start(): Promise<void> {
    await this.cache.loadAll();
    if (this.cache.size === 0) {
      logger.warn(
        "[StockMatchLifecycle] no fixtures on-chain yet — the schedule has not been generated. " +
          "Lifecycle loop running idle until fixtures exist."
      );
    }
    this.running = true;
    logger.info("[StockMatchLifecycle] starting (event-driven)", {
      matchDurationMin: stockConfig.matchDurationMinutes,
      kickoffLeadMin: stockConfig.kickoff.leadMinutes,
      staggerSlotMin: stockConfig.kickoff.staggerSlotMinutes,
      staggerMaxSlots: stockConfig.kickoff.staggerMaxSlots,
    });
    this.armTimer(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Read-only fixture list for the REST API. */
  getFixtures(): StockFixtureView[] {
    return this.cache.all();
  }

  private armTimer(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick().catch((err) =>
        logger.error("[StockMatchLifecycle] tick failed", { error: String(err) })
      );
    }, Math.max(0, delayMs));
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      this.armTimer(HOT_SLEEP_CAP_MS);
      return;
    }
    this.ticking = true;
    try {
      await this.cache.refresh();
      this.updateNavHotWindow(Date.now());
      await this.revealDueKickoffs();
      await this.processLiveMatches();
    } catch (err) {
      logger.error("[StockMatchLifecycle] tick failed", { error: String(err) });
    } finally {
      this.ticking = false;
      if (this.running) this.armTimer(this.msUntilNextEvent());
    }
  }

  /**
   * Sleep until the next thing that can happen: the next window opening
   * (reveal), the next kickoff (start snapshot), or the next full-time
   * (end snapshot / forfeit). Capped so an idle backend still wakes
   * periodically (NAV hot-window turnover) and a hot backend never
   * sleeps past a 60s granularity.
   */
  private msUntilNextEvent(): number {
    const now = Date.now();
    const hot = this.isHotWindow(now);
    const cap = hot ? HOT_SLEEP_CAP_MS : IDLE_SLEEP_CAP_MS;
    let next = Number.POSITIVE_INFINITY;
    for (const f of this.cache.all()) {
      if (f.settled) continue;
      if (!f.kickoffRevealed) {
        if (f.windowStartMs > now) next = Math.min(next, f.windowStartMs - now);
        else if (f.windowEndMs > now) next = Math.min(next, 0);
      } else {
        if (f.kickoffMs > now) next = Math.min(next, f.kickoffMs - now);
        else if (f.matchEndMs > now) next = Math.min(next, f.matchEndMs - now);
        else next = Math.min(next, 0); // past FT, unsettled: act now
      }
    }
    if (!Number.isFinite(next)) return cap;
    return Math.min(Math.max(0, next), cap);
  }

  /** Hot while any fixture is live, about to kick off, or just finished. */
  private isHotWindow(now: number): boolean {
    for (const f of this.cache.all()) {
      if (f.settled) continue;
      const kickoff = f.kickoffRevealed ? f.kickoffMs : f.windowStartMs;
      const end = f.kickoffRevealed && f.matchEndMs > 0 ? f.matchEndMs : f.windowEndMs;
      if (now >= kickoff - HOT_LEAD_MS && now <= end + HOT_TAIL_MS) return true;
    }
    return false;
  }

  private updateNavHotWindow(now: number): void {
    this.navPoller.setHot(this.isHotWindow(now));
  }

  // ------------------------------------------------------------- reveal

  private async revealDueKickoffs(): Promise<void> {
    const now = Date.now();
    const due = this.cache
      .all()
      .filter(
        (f) => !f.kickoffRevealed && !f.settled && f.windowStartMs <= now && now < f.windowEndMs
      );
    if (due.length === 0) return;

    const slotMs = stockConfig.kickoff.staggerSlotMinutes * 60 * 1000;
    const maxSlots = Math.max(1, stockConfig.kickoff.staggerMaxSlots);

    const byMatchday = new Map<number, StockFixtureView[]>();
    for (const f of due) {
      const list = byMatchday.get(f.matchdayIndex) ?? [];
      list.push(f);
      byMatchday.set(f.matchdayIndex, list);
    }

    let revealed = 0;
    for (const [, fixtures] of byMatchday) {
      fixtures.sort((a, b) => (a.fixtureId < b.fixtureId ? -1 : 1));
      for (const f of fixtures) {
        const slot = staggerSlotFor(f.fixtureId, f.matchdayIndex, maxSlots);
        const kickoffMs = now + this.leadMs + slot * slotMs;
        // Legal reveal requires kickoff within [now+30min, now+120min] AND inside the window.
        if (
          kickoffMs > f.windowEndMs ||
          this.leadMs + slot * slotMs < stockConfig.kickoff.minLeadMinutes * 60 * 1000 ||
          this.leadMs + slot * slotMs > stockConfig.kickoff.maxLeadMinutes * 60 * 1000
        ) {
          logger.error("[StockMatchLifecycle] MISSED reveal window — manual review required", {
            fixtureId: f.fixtureId.toString(),
            matchday: f.matchdayIndex,
            staggerSlot: slot,
            windowEnd: new Date(f.windowEndMs).toISOString(),
          });
          continue;
        }
        try {
          const kickoffSec = BigInt(Math.floor(kickoffMs / 1000));
          await this.submitter.revealKickoff(f.fixtureId, kickoffSec);
          f.kickoffRevealed = true;
          f.kickoffMs = kickoffMs;
          f.matchEndMs = kickoffMs + this.durationMs;
          revealed++;
          logger.info("[StockMatchLifecycle] kickoff revealed (random stagger)", {
            fixtureId: f.fixtureId.toString(),
            matchday: f.matchdayIndex,
            staggerSlot: slot,
            kickoff: new Date(kickoffMs).toISOString(),
          });
        } catch (err) {
          logger.error("[StockMatchLifecycle] revealKickoff failed", {
            fixtureId: f.fixtureId.toString(),
            error: String(err),
          });
        }
      }
    }
    logger.info("[StockMatchLifecycle] reveal pass complete", { due: due.length, revealed });
  }

  // ------------------------------------------------------------- match timer

  private async processLiveMatches(): Promise<void> {
    const now = Date.now();
    const live = this.cache
      .all()
      .filter((f) => f.kickoffRevealed && !f.settled && f.kickoffMs <= now);
    for (const f of live) {
      const failure = this.failures.get(f.fixtureId);
      if (failure && now < failure.nextRetryAtMs) continue; // backing off
      try {
        await this.processFixture(f, now);
        if (failure) this.failures.delete(f.fixtureId);
      } catch (err) {
        const count = (failure?.count ?? 0) + 1;
        const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS);
        this.failures.set(f.fixtureId, { count, nextRetryAtMs: now + backoffMs });
        logger.error("[StockMatchLifecycle] fixture processing failed", {
          fixtureId: f.fixtureId.toString(),
          attempt: count,
          nextRetryInMin: Math.round(backoffMs / 60_000),
          error: String(err),
        });
      }
    }
  }

  private async processFixture(f: StockFixtureView, now: number): Promise<void> {
    const matchEndMs = f.matchEndMs > 0 ? f.matchEndMs : f.kickoffMs + this.durationMs;
    const wantEnd = now >= matchEndMs;

    if (wantEnd) {
      await this.processFullTime(f, matchEndMs);
      return;
    }

    // Kickoff: submit the start snapshot from the latest NAV. A stale or
    // missing NAV BLOCKS the snapshot (like crypto); the fixture waits
    // and retries. Nothing is fabricated, and no forfeit is decided yet:
    // the match period has not happened.
    const sourceKey = f.fixtureId.toString();
    let home;
    let away;
    try {
      home = this.feed.getValidatedPrice(f.homeTeamId);
      away = this.feed.getValidatedPrice(f.awayTeamId);
    } catch (err) {
      if (err instanceof StockPriceValidationError || err instanceof StockPriceUnavailableError) {
        logger.warn("[StockMatchLifecycle] start snapshot blocked by price validation", {
          fixtureId: f.fixtureId.toString(),
          error: err.message,
        });
        return;
      }
      throw err;
    }

    logger.info("[StockMatchLifecycle] submitting start snapshot", {
      fixtureId: f.fixtureId.toString(),
      home: this.feed.describeQuote(home),
      away: this.feed.describeQuote(away),
    });
    const audit = await this.submitter.submitStartPrice(
      f.fixtureId, home.scaled, away.scaled, home.source, away.source
    );
    if (!audit.skipped) {
      this.startSources.set(sourceKey, { home: home.source, away: away.source });
    }
  }

  /**
   * Full-time: forfeit is decided FIRST, before any end snapshot.
   * A team counts as having performed only if a NAV was published inside
   * [kickoff, FT + grace]. One team missing -> 0-3 forfeit to the
   * opponent. Both missing -> void, stakes refunded 1:1. Only when both
   * performed does the normal end snapshot run.
   */
  private async processFullTime(f: StockFixtureView, matchEndMs: number): Promise<void> {
    const sourceKey = f.fixtureId.toString();
    const stored = this.startSources.get(sourceKey);

    const homePerformed = this.feed.isWindowFresh(f.homeTeamId, f.kickoffMs, matchEndMs);
    const awayPerformed = this.feed.isWindowFresh(f.awayTeamId, f.kickoffMs, matchEndMs);

    if (!homePerformed || !awayPerformed) {
      if (!homePerformed && !awayPerformed) {
        logger.error("[StockMatchLifecycle] VOID — neither team performed in the match window", {
          fixtureId: f.fixtureId.toString(),
          homeTeamId: f.homeTeamId,
          awayTeamId: f.awayTeamId,
          kickoff: new Date(f.kickoffMs).toISOString(),
          matchEnd: new Date(matchEndMs).toISOString(),
        });
        await this.submitter.voidFixture(f.fixtureId);
        f.voided = true;
        this.startSources.delete(sourceKey);
        return;
      }
      const forfeitingTeamId = !homePerformed ? f.homeTeamId : f.awayTeamId;
      logger.error("[StockMatchLifecycle] FORFEIT — team had no NAV performance in the match window, opponent wins 3-0", {
        fixtureId: f.fixtureId.toString(),
        forfeitingTeamId,
        homePerformed,
        awayPerformed,
        kickoff: new Date(f.kickoffMs).toISOString(),
        matchEnd: new Date(matchEndMs).toISOString(),
      });
      await this.submitter.recordForfeit(f.fixtureId, forfeitingTeamId);
      f.forfeitTeamId = forfeitingTeamId;
      this.startSources.delete(sourceKey);
      return;
    }

    // Both performed: a suspect (quarantined +/-30% spike) NAV for either
    // team blocks settlement for manual review. Never settle on a spike.
    const homeSuspect = this.navPoller.getSuspect(f.homeTeamId);
    const awaySuspect = this.navPoller.getSuspect(f.awayTeamId);
    if (homeSuspect || awaySuspect) {
      logger.error("[StockMatchLifecycle] CIRCUIT BREAKER REVIEW — suspect NAV quarantined, settlement blocked", {
        fixtureId: f.fixtureId.toString(),
        homeSuspect: homeSuspect?.navPrice ?? null,
        awaySuspect: awaySuspect?.navPrice ?? null,
      });
      return;
    }

    let home;
    let away;
    try {
      home = this.feed.getValidatedPrice(f.homeTeamId, stored?.home);
      away = this.feed.getValidatedPrice(f.awayTeamId, stored?.away);
    } catch (err) {
      if (err instanceof StockPriceValidationError || err instanceof StockPriceUnavailableError) {
        logger.warn("[StockMatchLifecycle] end snapshot blocked by price validation", {
          fixtureId: f.fixtureId.toString(),
          error: err.message,
        });
        return;
      }
      throw err;
    }

    logger.info("[StockMatchLifecycle] submitting end snapshot", {
      fixtureId: f.fixtureId.toString(),
      home: this.feed.describeQuote(home),
      away: this.feed.describeQuote(away),
    });
    await this.submitter.submitEndPrice(
      f.fixtureId, home.scaled, away.scaled, home.source, away.source
    );
    this.startSources.delete(sourceKey);
  }
}
